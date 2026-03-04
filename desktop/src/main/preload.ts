import { contextBridge, ipcRenderer } from "electron";
import type { DesktopSettings } from "../shared/desktop-settings";
import type {
  BackendDiagnosticsStatus,
  CopyDiagnosticReportResult,
  DiagnosticsActionResult,
  DiagnosticsSnapshot,
  ProviderDiagnosticsStatus,
} from "../shared/diagnostics";
import type { UpdaterStatusPayload } from "../shared/updater-status";

const momodocApi = {
  // Backend
  getBackendUrl: (): Promise<string> => ipcRenderer.invoke("get-backend-url"),
  getToken: (): Promise<string> => ipcRenderer.invoke("get-token"),
  getBackendStatus: (): Promise<{
    running: boolean;
    port: number | null;
    startupState?: string;
    startupError?: string | null;
    startupErrorCategory?: string | null;
  }> =>
    ipcRenderer.invoke("get-backend-status"),
  restartBackend: (): Promise<boolean> => ipcRenderer.invoke("restart-backend"),

  // Settings
  getSettings: (): Promise<DesktopSettings> =>
    ipcRenderer.invoke("get-settings"),
  updateSettings: (partial: Partial<DesktopSettings>): Promise<void> =>
    ipcRenderer.invoke("update-settings", partial),

  // Overlay
  toggleOverlay: (): Promise<void> => ipcRenderer.invoke("toggle-overlay"),
  expandOverlay: (): Promise<void> => ipcRenderer.invoke("expand-overlay"),
  collapseOverlay: (): Promise<void> => ipcRenderer.invoke("collapse-overlay"),

  // Window controls
  openMainWindow: (): Promise<void> => ipcRenderer.invoke("open-main-window"),
  selectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("select-directory"),
  selectDirectories: (): Promise<string[] | null> =>
    ipcRenderer.invoke("select-directories"),
  openWebUi: (): Promise<string> => ipcRenderer.invoke("open-web-ui"),
  minimize: (): void => ipcRenderer.send("window-minimize"),
  maximize: (): void => ipcRenderer.send("window-maximize"),
  close: (): void => ipcRenderer.send("window-close"),

  // Event listeners
  onBackendReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("backend-ready", listener);
    return () => ipcRenderer.removeListener("backend-ready", listener);
  },
  onBackendStopped: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("backend-stopped", listener);
    return () => ipcRenderer.removeListener("backend-stopped", listener);
  },
  onSettingsChanged: (callback: (settings: DesktopSettings) => void) => {
    const listener = (_event: unknown, settings: DesktopSettings) =>
      callback(settings);
    ipcRenderer.on("settings-changed", listener as any);
    return () => ipcRenderer.removeListener("settings-changed", listener as any);
  },
  onNavigate: (callback: (view: string) => void) => {
    const listener = (_event: unknown, view: string) => callback(view);
    ipcRenderer.on("navigate", listener as any);
    return () => ipcRenderer.removeListener("navigate", listener as any);
  },
  onOverlayExpanded: (callback: (expanded: boolean) => void) => {
    const listener = (_event: unknown, expanded: boolean) => callback(expanded);
    ipcRenderer.on("overlay-expanded", listener as any);
    return () => ipcRenderer.removeListener("overlay-expanded", listener as any);
  },
  onUpdateAvailable: (callback: (version: string) => void) => {
    const listener = (_event: unknown, version: string) => callback(version);
    ipcRenderer.on("update-available", listener as any);
    return () => ipcRenderer.removeListener("update-available", listener as any);
  },
  onUpdateDownloaded: (callback: (version: string) => void) => {
    const listener = (_event: unknown, version: string) => callback(version);
    ipcRenderer.on("update-downloaded", listener as any);
    return () => ipcRenderer.removeListener("update-downloaded", listener as any);
  },
  onUpdaterStatus: (callback: (status: UpdaterStatusPayload) => void) => {
    const listener = (_event: unknown, status: UpdaterStatusPayload) =>
      callback(status);
    ipcRenderer.on("updater-status", listener as any);
    return () => ipcRenderer.removeListener("updater-status", listener as any);
  },

  // Updater
  getUpdaterStatus: (): Promise<UpdaterStatusPayload> =>
    ipcRenderer.invoke("get-updater-status"),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke("check-for-updates"),
  quitAndInstall: (): Promise<void> => ipcRenderer.invoke("quit-and-install"),

  // Diagnostics
  getDiagnosticsSnapshot: (): Promise<DiagnosticsSnapshot> =>
    ipcRenderer.invoke("get-diagnostics-snapshot"),
  openLogsFolder: (): Promise<DiagnosticsActionResult> =>
    ipcRenderer.invoke("open-logs-folder"),
  openDataFolder: (): Promise<DiagnosticsActionResult> =>
    ipcRenderer.invoke("open-data-folder"),
  testBackendConnection: (): Promise<BackendDiagnosticsStatus> =>
    ipcRenderer.invoke("test-backend-connection"),
  testProviderConfig: (): Promise<ProviderDiagnosticsStatus[]> =>
    ipcRenderer.invoke("test-provider-config"),
  copyDiagnosticReport: (): Promise<CopyDiagnosticReportResult> =>
    ipcRenderer.invoke("copy-diagnostic-report"),
};

contextBridge.exposeInMainWorld("momodoc", momodocApi);

export type MomodocApi = typeof momodocApi;
