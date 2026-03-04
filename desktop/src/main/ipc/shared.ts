import { BrowserWindow } from "electron";
import { ConfigStore } from "../config-store";
import { OverlayManager } from "../overlay";
import { SidecarManager } from "../sidecar";
import { UpdateManager } from "../updater";

export interface IpcDeps {
  mainWindow: BrowserWindow;
  sidecar: SidecarManager;
  configStore: ConfigStore;
  overlay: OverlayManager;
  updater: UpdateManager | null;
}

export function sendToWindow(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!win.isDestroyed()) {
    win.webContents.send(channel, ...args);
  }
}
