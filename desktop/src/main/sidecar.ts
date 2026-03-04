import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { app } from "electron";
import { getDataDir, readPid, readPort, readToken } from "./platform";
import { ConfigStore } from "./config-store";
import { SidecarLifecycleCore } from "../../../extension/src/shared/sidecarLifecycleCore";
import { resolveBackendLaunchCommand } from "./backend-launch";

export type SidecarStartupState =
  | "idle"
  | "starting"
  | "ready"
  | "failed"
  | "stopped";

export type SidecarStartupErrorCategory =
  | "spawn-error"
  | "timeout"
  | "port-conflict"
  | "runtime-error"
  | "unknown"
  | null;

/**
 * Manages the momodoc backend process lifecycle.
 *
 * Can detect an already-running server (started via CLI) or spawn its own
 * instance using a packaged backend launcher (preferred in production) or
 * `momodoc serve` fallback. Only stops what it started.
 *
 * The backend is spawned detached so that vite-plugin-electron's treeKillSync()
 * during dev restarts only kills Electron, not the backend. On next startup,
 * the sidecar detects the still-running backend and reuses it.
 */
export class SidecarManager {
  private core: SidecarLifecycleCore;
  private configStore: ConfigStore;
  private logPath: string;
  private startupState: SidecarStartupState = "idle";
  private lastStartupError: string | null = null;
  private lastStartupErrorCategory: SidecarStartupErrorCategory = null;

  constructor(configStore: ConfigStore) {
    this.configStore = configStore;
    this.logPath = path.join(getDataDir(), "sidecar.log");
    this.core = new SidecarLifecycleCore({
      readPort,
      readToken,
      log: (message) => this.log(message),
    });
  }

  /**
   * Start the momodoc backend if not already running.
   * Returns true if the server is ready after this call.
   */
  async start(): Promise<boolean> {
    this.startupState = "starting";
    this.lastStartupError = null;
    this.lastStartupErrorCategory = null;

    if (await this.core.isRunning()) {
      this.log("[sidecar] momodoc backend is already running.");
      this.core.markUsingExternalProcess();
      this.startupState = "ready";
      return true;
    }

    const existingPid = readPid();
    if (existingPid !== null) {
      if (this.isProcessAlive(existingPid)) {
        // Process alive — wait for it to become healthy (likely still starting
        // from a previous Electron instance during vite dev restarts)
        this.log(
          `[sidecar] Backend (PID ${existingPid}) is alive, waiting for health...`
        );
        const healthy = await this.core.pollHealth(20_000);
        if (healthy) {
          this.log("[sidecar] Existing backend is ready.");
          this.core.markUsingExternalProcess();
          this.startupState = "ready";
          return true;
        }
        // Not healthy after 20s — kill and start fresh
        this.log(
          `[sidecar] Backend (PID ${existingPid}) unresponsive after 20s, killing.`
        );
        this.recordStartupFailure(
          "Previous backend instance was unresponsive during startup recovery.",
          "timeout"
        );
        try {
          process.kill(existingPid, "SIGKILL");
        } catch {}
        await this.sleep(1000);
      } else {
        this.log(
          `[sidecar] Found stale PID file (${existingPid}), process not alive.`
        );
      }
      this.cleanupPidFiles();
    }

    this.log("[sidecar] Starting momodoc backend...");

    try {
      const envVars = this.configStore.toEnvVars();
      const launch = resolveBackendLaunchCommand({
        isPackaged: app.isPackaged,
        resourcesPath: process.resourcesPath,
      });
      this.log(
        `[sidecar] Launch strategy: ${launch.source} (${launch.command} ${launch.args.join(" ")})`
      );

      const child = spawn(launch.command, launch.args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        cwd: launch.cwd,
        env: { ...process.env, ...envVars },
      });
      child.unref();

      this.core.attachChild(child, {
        onStdout: (data) => {
          this.log(`[backend] ${data.toString().trimEnd()}`);
        },
        onStderr: (data) => {
          const message = data.toString().trimEnd();
          this.log(`[backend:err] ${message}`);
          if (/port .*already in use/i.test(message)) {
            this.recordStartupFailure(message, "port-conflict");
          } else if (/error/i.test(message)) {
            this.recordStartupFailure(message, "runtime-error");
          }
        },
        formatErrorLog: (err) => `[sidecar] Failed to start momodoc: ${err.message}`,
        formatExitLog: (code, signal) =>
          `[sidecar] momodoc exited (code=${code}, signal=${signal})`,
      });

      const ready = await this.core.waitForReady(30_000);
      if (ready) {
        this.log("[sidecar] momodoc backend is ready.");
        this.startupState = "ready";
        this.lastStartupError = null;
        this.lastStartupErrorCategory = null;
      } else {
        this.log(
          "[sidecar] momodoc backend failed to start within timeout."
        );
        this.recordStartupFailure(
          "Backend did not become ready within 30 seconds.",
          "timeout"
        );
      }
      return ready;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[sidecar] Error starting momodoc: ${message}`);
      this.recordStartupFailure(message, "spawn-error");
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
    this.log("[sidecar] Stopping momodoc backend...");
    await this.core.stop({
      sigkillAfterMs: 5000,
      hardDeadlineMs: 7000,
      onSigtermError: (err) => {
        this.log(`[sidecar] SIGTERM failed: ${err}`);
      },
    });
    this.log("[sidecar] momodoc backend stopped.");
    this.startupState = "stopped";
  }

  /**
   * Restart the backend (stop then start).
   */
  async restart(): Promise<boolean> {
    const port = this.resolveRestartPort();
    await this.stop();
    // Wait for port to be released before attempting to start
    const portFree = await this.waitForPortFree(port, 5000);
    if (!portFree) {
      this.log(
        `[sidecar] Port ${port} still in use after 5s, attempting start anyway...`
      );
    }
    return this.start();
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

  getPort(): number | null {
    return this.core.getPort();
  }

  getToken(): string | null {
    return this.core.getToken();
  }

  get ownedByUs(): boolean {
    return this.core.ownedByUs;
  }

  getStartupState(): SidecarStartupState {
    return this.startupState;
  }

  getLastStartupError(): string | null {
    return this.lastStartupError;
  }

  getLastStartupErrorCategory(): SidecarStartupErrorCategory {
    return this.lastStartupErrorCategory;
  }

  private resolveRestartPort(): number {
    const runtimePort = this.getPort();
    if (runtimePort !== null) {
      return runtimePort;
    }

    const configuredPort = this.configStore.get("port");
    if (Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65535) {
      return configuredPort;
    }

    return 8000;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private cleanupPidFiles(): void {
    const dataDir = getDataDir();
    for (const file of ["momodoc.pid", "momodoc.port"]) {
      try {
        fs.unlinkSync(path.join(dataDir, file));
      } catch {}
    }
    this.log("[sidecar] Cleaned up stale PID/port files.");
  }

  private log(message: string): void {
    const line = `${new Date().toISOString()} ${message}\n`;
    console.log(message);
    try {
      fs.appendFileSync(this.logPath, line);
    } catch {}
  }

  private recordStartupFailure(
    message: string,
    category: SidecarStartupErrorCategory
  ): void {
    if (this.startupState === "ready") {
      return;
    }
    this.startupState = "failed";
    this.lastStartupError = message;
    this.lastStartupErrorCategory = category ?? "unknown";
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Check if a port is free for binding.
   */
  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require("net");
      const server = net.createServer();

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, "127.0.0.1");
    });
  }

  /**
   * Poll until a port becomes free or timeout expires.
   */
  private async waitForPortFree(
    port: number,
    timeoutMs: number
  ): Promise<boolean> {
    const start = Date.now();
    const interval = 200;

    while (Date.now() - start < timeoutMs) {
      if (await this.isPortFree(port)) {
        return true;
      }
      await this.sleep(interval);
    }

    return false;
  }
}
