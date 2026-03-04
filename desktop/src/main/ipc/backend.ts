import { ipcMain } from "electron";
import type { IpcDeps } from "./shared";
import { sendToWindow } from "./shared";

export const BACKEND_IPC_CHANNELS = [
  "get-backend-url",
  "get-token",
  "get-backend-status",
  "restart-backend",
] as const;

export function registerBackendIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("get-backend-url", () => {
    const port = deps.sidecar.getPort();
    return port ? `http://127.0.0.1:${port}` : "";
  });

  ipcMain.handle("get-token", () => {
    return deps.sidecar.getToken() || "";
  });

  ipcMain.handle("get-backend-status", async () => {
    return {
      running: await deps.sidecar.isRunning(),
      port: deps.sidecar.getPort(),
      startupState: deps.sidecar.getStartupState(),
      startupError: deps.sidecar.getLastStartupError(),
      startupErrorCategory: deps.sidecar.getLastStartupErrorCategory(),
    };
  });

  ipcMain.handle("restart-backend", async () => {
    const result = await deps.sidecar.restart();
    if (result) {
      sendToWindow(deps.mainWindow, "backend-ready");
    }
    return result;
  });
}
