import { ipcMain } from "electron";
import type { IpcDeps } from "./shared";

export const OVERLAY_IPC_CHANNELS = [
  "toggle-overlay",
  "expand-overlay",
  "collapse-overlay",
] as const;

export function registerOverlayIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("toggle-overlay", () => {
    deps.overlay.toggle();
  });

  ipcMain.handle("expand-overlay", () => {
    deps.overlay.expand();
  });

  ipcMain.handle("collapse-overlay", () => {
    deps.overlay.collapse();
  });
}
