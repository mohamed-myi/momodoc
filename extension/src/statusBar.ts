import * as vscode from "vscode";
import { SidecarManager } from "./sidecar";

/**
 * Manages a status bar item that shows the current state of the momodoc backend.
 *
 * Displays:
 *   $(check) Momodoc   — when the server is running
 *   $(circle-slash) Momodoc — when the server is stopped
 *
 * Clicking the status bar item toggles the server state.
 */
export class StatusBar {
    private item: vscode.StatusBarItem;
    private sidecar: SidecarManager;
    private updateInterval: ReturnType<typeof setInterval> | null = null;

    constructor(sidecar: SidecarManager) {
        this.sidecar = sidecar;

        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = "momodoc.startServer";
        this.item.show();

        // Set initial state
        this.setStopped();

        // Poll every 10 seconds to update status
        this.updateInterval = setInterval(() => {
            this.refresh().catch(() => {});
        }, 10_000);

        // Do an immediate async refresh
        this.refresh().catch(() => {});
    }

    /**
     * Set the status bar to the "running" state.
     */
    setRunning(): void {
        this.item.text = "$(check) Momodoc";
        this.item.tooltip = "Momodoc server is running. Click to open Web UI.";
        this.item.command = "momodoc.openUI";
        this.item.backgroundColor = undefined;
    }

    /**
     * Set the status bar to the "stopped" state.
     */
    setStopped(): void {
        this.item.text = "$(circle-slash) Momodoc";
        this.item.tooltip = "Momodoc server is stopped. Click to start.";
        this.item.command = "momodoc.startServer";
        this.item.backgroundColor = undefined;
    }

    /**
     * Set the status bar to a "starting" transitional state.
     */
    setStarting(): void {
        this.item.text = "$(sync~spin) Momodoc";
        this.item.tooltip = "Momodoc server is starting...";
        this.item.command = undefined;
    }

    /**
     * Probe the sidecar and update the status bar accordingly.
     */
    async refresh(): Promise<void> {
        const running = await this.sidecar.isRunning();
        if (running) {
            this.setRunning();
        } else {
            this.setStopped();
        }
    }

    /**
     * Dispose of the status bar item and stop polling.
     */
    dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        this.item.dispose();
    }
}
