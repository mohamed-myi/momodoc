import { spawn } from "child_process";
import { app, BrowserWindow, shell } from "electron";
import { ConfigStore } from "./config-store";
import { SidecarManager } from "./sidecar";
import { TrayManager } from "./tray";
import { OverlayManager } from "./overlay";
import { ShortcutManager } from "./shortcuts";
import { UpdateManager } from "./updater";
import { registerIpcHandlers, IpcDeps } from "./ipc";
import { createMainWindow } from "./window-factory";
import { resolveEffectiveStartupProfile } from "./startup-profile-runtime";

export interface DesktopMainRuntime {
  mainWindow: BrowserWindow;
  configStore: ConfigStore;
  sidecar: SidecarManager;
  tray: TrayManager;
  overlay: OverlayManager;
  shortcuts: ShortcutManager;
  updater: UpdateManager | null;
  ipcDeps: IpcDeps;
  clearBoundsSaveTimer: () => void;
}

export interface BootstrapDesktopAppOptions {
  isDev: boolean;
  getIsQuitting: () => boolean;
}

export function showMainWindow(mainWindow: BrowserWindow | null | undefined): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function notifyBackendStatus(mainWindow: BrowserWindow, backendReady: boolean): void {
  if (mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(backendReady ? "backend-ready" : "backend-stopped");
}

function logStartup(message: string): void {
  console.log(`[startup] ${message}`);
}

function applyStartupWindowBehavior(
  mainWindow: BrowserWindow,
  options: {
    openMainWindowOnLaunch: boolean;
    startMinimizedToTray: boolean;
  }
): void {
  if (mainWindow.isDestroyed()) {
    return;
  }

  if (options.startMinimizedToTray) {
    logStartup("Starting minimized to tray.");
    mainWindow.hide();
    return;
  }

  if (options.openMainWindowOnLaunch) {
    logStartup("Opening main window on launch.");
    showMainWindow(mainWindow);
    return;
  }

  logStartup("Leaving main window hidden on launch.");
  mainWindow.hide();
}

async function openWebUiOnLaunch(
  configStore: ConfigStore,
  sidecar: SidecarManager,
  backendReady: boolean
): Promise<void> {
  if (!backendReady) {
    logStartup("Skipping web UI launch: backend not ready.");
    return;
  }
  const port = sidecar.getPort() ?? configStore.get("port");
  const host = configStore.get("host") || "127.0.0.1";
  const url = `http://${host}:${port}/`;
  logStartup(`Opening web UI in browser: ${url}`);
  await shell.openExternal(url);
}

function openVsCodeOnLaunch(): void {
  logStartup("Launching VS Code (best effort).");
  const child = spawn("code", [], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.on("error", (err) => {
    logStartup(`VS Code launch failed: ${err.message}`);
  });
  child.unref();
}

export async function bootstrapDesktopApp(
  options: BootstrapDesktopAppOptions
): Promise<DesktopMainRuntime> {
  const { isDev, getIsQuitting } = options;

  // Initialize config
  const configStore = new ConfigStore();
  const startup = resolveEffectiveStartupProfile({
    startupProfilePreset: configStore.get("startupProfilePreset"),
    startupProfileCustom: configStore.get("startupProfileCustom"),
    showInTray: configStore.get("showInTray"),
  });
  for (const warning of startup.warnings) {
    logStartup(`Conflict resolved: ${warning}`);
  }
  logStartup(
    `Launch profile=${configStore.get("startupProfilePreset")} tray=${configStore.get("showInTray")} backend=${startup.targets.startBackendOnLaunch}`
  );

  // Initialize sidecar
  const sidecar = new SidecarManager(configStore);

  const mainWindowHandle = createMainWindow({
    configStore,
    isDev,
    getIsQuitting,
    showOnReady: false,
  });
  const mainWindow = mainWindowHandle.window;

  // Initialize overlay
  const overlay = new OverlayManager(isDev);

  // Register IPC handlers — keep deps reference so we can mutate updater later
  const ipcDeps: IpcDeps = {
    mainWindow,
    sidecar,
    configStore,
    overlay,
    updater: null,
  };
  registerIpcHandlers(ipcDeps);

  // Start sidecar (if enabled by startup profile)
  let backendReady = false;
  if (startup.targets.startBackendOnLaunch) {
    logStartup("Starting backend sidecar.");
    backendReady = await sidecar.start();
  } else {
    logStartup("Backend start disabled by startup profile.");
  }
  notifyBackendStatus(mainWindow, backendReady);

  // Apply main window startup visibility after backend startup attempt.
  applyStartupWindowBehavior(mainWindow, {
    openMainWindowOnLaunch: startup.targets.openMainWindowOnLaunch,
    startMinimizedToTray: startup.targets.startMinimizedToTray,
  });

  // Initialize tray
  const tray = new TrayManager(
    mainWindow,
    () => overlay.toggle(),
    () => {
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send("navigate", "settings");
      }
      showMainWindow(mainWindow);
    }
  );
  if (configStore.get("showInTray")) {
    tray.create();
    logStartup("Tray icon created.");
  } else {
    logStartup("Tray icon disabled.");
  }

  // Register global shortcuts
  const shortcuts = new ShortcutManager(() => overlay.toggle());
  shortcuts.register(configStore.get("globalHotkey"));
  logStartup(`Global shortcut registered: ${configStore.get("globalHotkey")}`);

  // Auto-updater (production only)
  let updater: UpdateManager | null = null;
  if (!isDev) {
    updater = new UpdateManager(mainWindow);
    ipcDeps.updater = updater; // Make updater accessible to IPC handlers
    updater.start();
    logStartup("Auto-updater started (packaged build).");
  }

  // Auto-launch
  if (configStore.get("autoLaunch")) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: startup.targets.startMinimizedToTray,
    });
    logStartup("OS auto-launch enabled.");
  }

  // Optional startup launch actions (best effort; do not block core app)
  if (startup.targets.openOverlayOnLaunch) {
    try {
      logStartup("Opening overlay on launch.");
      overlay.toggle();
    } catch (err) {
      logStartup(
        `Overlay launch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (startup.targets.openWebUiOnLaunch) {
    try {
      await openWebUiOnLaunch(configStore, sidecar, backendReady);
    } catch (err) {
      logStartup(
        `Web UI launch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (startup.targets.openVsCodeOnLaunch) {
    try {
      openVsCodeOnLaunch();
    } catch (err) {
      logStartup(
        `VS Code launch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (!startup.targets.restoreLastSession) {
    logStartup("restoreLastSession=false (runtime behavior not yet implemented; no-op).");
  }

  return {
    mainWindow,
    configStore,
    sidecar,
    tray,
    overlay,
    shortcuts,
    updater,
    ipcDeps,
    clearBoundsSaveTimer: mainWindowHandle.clearBoundsSaveTimer,
  };
}
