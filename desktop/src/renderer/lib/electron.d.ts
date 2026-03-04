import type { DesktopSettings } from "../../shared/desktop-settings";
import type {
  BackendDiagnosticsStatus,
  CopyDiagnosticReportResult,
  DiagnosticsActionResult,
  DiagnosticsSnapshot,
  ProviderDiagnosticsStatus,
} from "../../shared/diagnostics";
import type { UpdaterStatusPayload } from "../../shared/updater-status";

interface MomodocApi {
  // Backend
  getBackendUrl(): Promise<string>;
  getToken(): Promise<string>;
  getBackendStatus(): Promise<{
    running: boolean;
    port: number | null;
    startupState?: string;
    startupError?: string | null;
    startupErrorCategory?: string | null;
  }>;
  restartBackend(): Promise<boolean>;

  // Settings
  getSettings(): Promise<DesktopSettings>;
  updateSettings(partial: Partial<DesktopSettings>): Promise<void>;

  // Overlay
  toggleOverlay(): Promise<void>;
  expandOverlay(): Promise<void>;
  collapseOverlay(): Promise<void>;

  // Window controls
  openMainWindow(): Promise<void>;
  selectDirectory(): Promise<string | null>;
  selectDirectories(): Promise<string[] | null>;
  openWebUi(): Promise<string>;
  minimize(): void;
  maximize(): void;
  close(): void;

  // Event listeners (return unsubscribe function)
  onBackendReady(callback: () => void): () => void;
  onBackendStopped(callback: () => void): () => void;
  onSettingsChanged(callback: (settings: DesktopSettings) => void): () => void;
  onNavigate(callback: (view: string) => void): () => void;
  onOverlayExpanded(callback: (expanded: boolean) => void): () => void;
  onUpdateAvailable(callback: (version: string) => void): () => void;
  onUpdateDownloaded(callback: (version: string) => void): () => void;
  onUpdaterStatus(callback: (status: UpdaterStatusPayload) => void): () => void;

  // Updater
  getUpdaterStatus(): Promise<UpdaterStatusPayload>;
  checkForUpdates(): Promise<void>;
  quitAndInstall(): Promise<void>;
  downloadUpdate(): Promise<void>;

  // Diagnostics
  getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshot>;
  openLogsFolder(): Promise<DiagnosticsActionResult>;
  openDataFolder(): Promise<DiagnosticsActionResult>;
  testBackendConnection(): Promise<BackendDiagnosticsStatus>;
  testProviderConfig(): Promise<ProviderDiagnosticsStatus[]>;
  copyDiagnosticReport(): Promise<CopyDiagnosticReportResult>;
}

declare global {
  interface Window {
    momodoc: MomodocApi | undefined;
  }
}

export {};
