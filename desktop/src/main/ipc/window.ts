import { dialog, ipcMain, shell } from "electron";
import type { IpcDeps } from "./shared";

export const WINDOW_IPC_CHANNELS = [
  "open-main-window",
  "select-directory",
  "select-directories",
  "open-web-ui",
  "window-minimize",
  "window-maximize",
  "window-close",
] as const;

export function registerWindowIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("open-main-window", () => {
    if (deps.mainWindow.isDestroyed()) return;
    if (deps.mainWindow.isMinimized()) deps.mainWindow.restore();
    deps.mainWindow.show();
    deps.mainWindow.focus();
  });

  ipcMain.handle("select-directory", async () => {
    if (deps.mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(deps.mainWindow, {
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });

  ipcMain.handle("select-directories", async () => {
    if (deps.mainWindow.isDestroyed()) return null;
    const result = await dialog.showOpenDialog(deps.mainWindow, {
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle("open-web-ui", async () => {
    const port = deps.sidecar.getPort() ?? deps.configStore.get("port");
    const host = deps.configStore.get("host") || "127.0.0.1";
    const url = `http://${host}:${port}/`;
    await shell.openExternal(url);
    return url;
  });

  ipcMain.on("window-minimize", () => {
    if (!deps.mainWindow.isDestroyed()) deps.mainWindow.minimize();
  });

  ipcMain.on("window-maximize", () => {
    if (deps.mainWindow.isDestroyed()) return;
    if (deps.mainWindow.isMaximized()) {
      deps.mainWindow.unmaximize();
    } else {
      deps.mainWindow.maximize();
    }
  });

  ipcMain.on("window-close", () => {
    if (!deps.mainWindow.isDestroyed()) deps.mainWindow.close();
  });
}
