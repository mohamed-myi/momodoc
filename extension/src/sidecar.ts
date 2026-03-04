import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { getDataDir, readPid, readPort, readToken } from "./config";
import { SidecarLifecycleCore } from "./shared/sidecarLifecycleCore";

/**
 * Manages the momodoc backend process lifecycle.
 *
 * The sidecar manager can detect an already-running server (started via CLI)
 * or spawn its own instance using `momodoc serve`. It tracks whether it owns
 * the process so it only stops what it started.
 */
export class SidecarManager {
    private outputChannel: vscode.OutputChannel;
    private core: SidecarLifecycleCore;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.core = new SidecarLifecycleCore({
            readPort,
            readToken,
            log: (message) => this.outputChannel.appendLine(message),
        });
    }

    /**
     * Start the momodoc backend if not already running.
     * Returns true if the server is ready after this call.
     *
     * NOTE: There is a race condition between the isRunning() check and spawn().
     * Another process (CLI, another VS Code window) could start the server between
     * these operations. The spawned process will fail with EADDRINUSE, which we
     * handle by reporting the error to the user.
     */
    async start(): Promise<boolean> {
        // Check if already running
        if (await this.core.isRunning()) {
            this.outputChannel.appendLine("momodoc backend is already running.");
            this.core.markUsingExternalProcess();
            return true;
        }

        // Check for a stale PID (process file exists but health fails)
        const existingPid = readPid();
        if (existingPid !== null) {
            this.outputChannel.appendLine(
                `Found stale PID file (${existingPid}), server not responding. Starting fresh.`
            );
            // Clean up stale PID file
            try {
                fs.unlinkSync(path.join(getDataDir(), "momodoc.pid"));
                this.outputChannel.appendLine("Cleaned up stale PID file.");
            } catch (err) {
                this.outputChannel.appendLine(`Failed to cleanup stale PID: ${err}`);
            }
        }

        this.outputChannel.appendLine("Starting momodoc backend...");

        try {
            const child = spawn("momodoc", ["serve"], {
                stdio: ["ignore", "pipe", "pipe"],
                detached: false,
                env: { ...process.env },
            });

            this.core.attachChild(child, {
                onStdout: (data) => {
                    this.outputChannel.append(data.toString());
                },
                onStderr: (data) => {
                    this.outputChannel.append(data.toString());
                },
                formatErrorLog: (err) => `Failed to start momodoc: ${err.message}`,
                formatExitLog: (code, signal) =>
                    `momodoc exited (code=${code}, signal=${signal})`,
            });

            // Wait for the server to become ready
            const ready = await this.core.waitForReady(30_000);
            if (ready) {
                this.outputChannel.appendLine("momodoc backend is ready.");
            } else {
                this.outputChannel.appendLine("momodoc backend failed to start within timeout.");
            }
            return ready;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.outputChannel.appendLine(`Error starting momodoc: ${message}`);
            return false;
        }
    }

    /**
     * Stop the momodoc backend, but only if we started it.
     */
    async stop(): Promise<void> {
        if (!this.core.ownedByUs || !this.core.hasManagedChild) {
            return;
        }
        this.outputChannel.appendLine("Stopping momodoc backend...");
        await this.core.stop({
            sigkillAfterMs: 5000,
            hardDeadlineMs: 5000,
            onSigtermError: (err) => {
                this.outputChannel.appendLine(`SIGTERM failed: ${err}`);
            },
            onSigkillError: (err) => {
                this.outputChannel.appendLine(`SIGKILL failed: ${err}`);
            },
        });
        this.outputChannel.appendLine("momodoc backend stopped.");
    }

    /**
     * Check whether the backend is running by probing the health endpoint.
     */
    async isRunning(): Promise<boolean> {
        return this.core.isRunning();
    }

    /**
     * Poll the health endpoint until the server is ready.
     */
    async waitForReady(timeoutMs: number = 30_000): Promise<boolean> {
        return this.core.waitForReady(timeoutMs);
    }

    /**
     * Read the port from the data directory file.
     */
    getPort(): number | null {
        return this.core.getPort();
    }

    /**
     * Read the session token from the data directory file.
     */
    getToken(): string | null {
        return this.core.getToken();
    }

    /**
     * Whether this manager instance started the current backend process.
     */
    get ownedByUs(): boolean {
        return this.core.ownedByUs;
    }
}
