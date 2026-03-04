import { app } from "electron";
import { bootstrapDesktopApp, showMainWindow, type DesktopMainRuntime } from "./app-runtime";
import { handleBeforeQuit, handleWillQuit } from "./shutdown";

const isDev = !app.isPackaged;

// Single instance lock — prevent multiple app windows
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let runtime: DesktopMainRuntime | null = null;
const quitState = { value: false };

app.whenReady().then(async () => {
  runtime = await bootstrapDesktopApp({
    isDev,
    getIsQuitting: () => quitState.value,
  });

  // macOS: re-show window when dock icon clicked
  app.on("activate", () => {
    showMainWindow(runtime?.mainWindow);
  });
});

// Show existing window when second instance is launched
app.on("second-instance", () => {
  showMainWindow(runtime?.mainWindow);
});

// Graceful shutdown: stop sidecar before quitting.
// Electron does not await async before-quit handlers, so we prevent quit,
// perform cleanup, then explicitly call app.quit() when done.
app.on("before-quit", (event) => {
  handleBeforeQuit(event, runtime, quitState);
});

app.on("will-quit", () => {
  handleWillQuit(runtime);
});

// Quit when all windows closed (Windows/Linux)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
