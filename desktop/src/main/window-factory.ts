import { BrowserWindow } from "electron";
import * as path from "path";
import { ConfigStore } from "./config-store";

export interface MainWindowFactoryOptions {
  configStore: ConfigStore;
  isDev: boolean;
  getIsQuitting: () => boolean;
  showOnReady?: boolean;
}

export interface MainWindowHandle {
  window: BrowserWindow;
  clearBoundsSaveTimer: () => void;
}

export function createMainWindow(options: MainWindowFactoryOptions): MainWindowHandle {
  const { configStore, isDev, getIsQuitting, showOnReady = true } = options;
  const savedBounds = configStore.get("windowBounds");
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;

  const win = new BrowserWindow({
    width: savedBounds?.width || 1200,
    height: savedBounds?.height || 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#09090b",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Save window bounds on move/resize (debounced to avoid excessive disk I/O)
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMaximized() && !win.isMinimized()) {
        configStore.set("windowBounds", win.getBounds());
      }
    }, 500);
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);

  // Show when ready to avoid white flash
  win.once("ready-to-show", () => {
    if (showOnReady) {
      win.show();
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // macOS: hide to tray on close instead of quitting
  win.on("close", (event) => {
    if (process.platform === "darwin" && !getIsQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });

  return {
    window: win,
    clearBoundsSaveTimer: () => {
      if (boundsTimer) {
        clearTimeout(boundsTimer);
        boundsTimer = null;
      }
    },
  };
}
