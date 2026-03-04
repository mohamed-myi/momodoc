import * as fs from "fs";
import * as path from "path";
import { autoUpdater } from "electron-updater";
import { BrowserWindow, app } from "electron";
import {
  makeUpdaterStatus,
  type UpdaterStatusPayload,
} from "../shared/updater-status";

export class UpdateManager {
  private mainWindow: BrowserWindow;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private checking = false;
  private status: UpdaterStatusPayload = makeUpdaterStatus(
    "idle",
    "Updates enabled (stable channel)."
  );
  private logPath: string;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logPath = path.join(app.getPath("userData"), "updater.log");

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on("checking-for-update", () => {
      this.checking = true;
      this.log("[updater] Checking for update...");
      this.publishStatus(makeUpdaterStatus("checking", "Checking for updates..."));
    });

    autoUpdater.on("update-available", (info) => {
      this.log(`[updater] Update available: ${info.version}`);
      this.publishStatus(
        makeUpdaterStatus("available", `Update v${info.version} is available.`, {
          version: info.version,
        })
      );
      this.sendToRenderer("update-available", info.version);
    });

    autoUpdater.on("update-not-available", (info) => {
      this.checking = false;
      this.log("[updater] No update available.");
      this.publishStatus(
        makeUpdaterStatus("not-available", "You already have the latest version.", {
          version: info?.version ?? null,
        })
      );
    });

    autoUpdater.on("download-progress", (progress) => {
      const percent = Number.isFinite(progress.percent) ? Number(progress.percent) : 0;
      this.publishStatus(
        makeUpdaterStatus("downloading", `Downloading update... ${percent.toFixed(0)}%`, {
          percent,
          version: this.status.version,
        })
      );
    });

    autoUpdater.on("update-downloaded", (info) => {
      this.checking = false;
      this.log(`[updater] Update downloaded: ${info.version}`);
      this.publishStatus(
        makeUpdaterStatus("downloaded", `Update v${info.version} is ready to install.`, {
          version: info.version,
          percent: 100,
        })
      );
      this.sendToRenderer("update-downloaded", info.version);
    });

    autoUpdater.on("error", (err) => {
      this.checking = false;
      const message = err?.message || String(err);
      this.log(`[updater] Error: ${message}`);
      this.publishStatus(makeUpdaterStatus("error", `Update check failed: ${message}`));
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.publishStatus(makeUpdaterStatus("idle", "Updates enabled (stable channel)."));

    this.initialTimeout = setTimeout(() => {
      this.initialTimeout = null;
      this.check();
    }, 10_000);

    // Then every 4 hours
    this.checkInterval = setInterval(() => this.check(), 4 * 60 * 60 * 1000);
  }

  async check(): Promise<void> {
    if (this.checking) {
      this.publishStatus(makeUpdaterStatus("checking", "Update check already in progress..."));
      return;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      this.checking = false;
      const message = err instanceof Error ? err.message : String(err);
      this.log(`[updater] Check failed: ${message}`);
      this.publishStatus(makeUpdaterStatus("error", `Update check failed: ${message}`));
    }
  }

  quitAndInstall(): void {
    this.publishStatus(
      makeUpdaterStatus("downloaded", "Installing update and restarting...", {
        version: this.status.version,
        percent: 100,
      })
    );
    autoUpdater.quitAndInstall();
  }

  async downloadUpdate(): Promise<void> {
    await autoUpdater.downloadUpdate();
  }

  stop(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.started = false;
    this.checking = false;
  }

  getStatus(): UpdaterStatusPayload {
    return this.status;
  }

  publishUnsupportedStatus(message: string): void {
    this.publishStatus(makeUpdaterStatus("unsupported", message));
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (!this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args);
    }
  }

  private publishStatus(status: UpdaterStatusPayload): void {
    this.status = status;
    this.sendToRenderer("updater-status", status);
  }

  private log(message: string): void {
    console.log(message);
    const line = `${new Date().toISOString()} ${message}\n`;
    try {
      fs.appendFileSync(this.logPath, line);
    } catch {}
  }
}
