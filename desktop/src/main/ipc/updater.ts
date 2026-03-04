import { ipcMain } from "electron";
import type { IpcDeps } from "./shared";
import { sendToWindow } from "./shared";
import { makeUpdaterStatus } from "../../shared/updater-status";

export const UPDATER_IPC_CHANNELS = [
  "get-updater-status",
  "check-for-updates",
  "quit-and-install",
] as const;

export function registerUpdaterIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("get-updater-status", async () => {
    if (!deps.updater) {
      return makeUpdaterStatus(
        "unsupported",
        "Updates are only available in packaged desktop builds."
      );
    }
    return deps.updater.getStatus();
  });

  // deps.updater is set after registration, so access via deps at call time.
  ipcMain.handle("check-for-updates", async () => {
    if (!deps.updater) {
      const status = makeUpdaterStatus(
        "unsupported",
        "Updates are only available in packaged desktop builds."
      );
      sendToWindow(deps.mainWindow, "updater-status", status);
      return;
    }
    await deps.updater.check();
  });

  ipcMain.handle("quit-and-install", () => {
    deps.updater?.quitAndInstall();
  });
}
