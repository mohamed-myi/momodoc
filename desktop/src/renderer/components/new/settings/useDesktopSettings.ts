import { useEffect, useRef, useState } from "react";
import type { DesktopSettings } from "../../../../shared/desktop-settings";
import type {
  DiagnosticsActionResult,
  DiagnosticsSnapshot,
  CopyDiagnosticReportResult,
} from "../../../../shared/diagnostics";
import type { UpdaterStatusPayload } from "../../../../shared/updater-status";
import {
  createDesktopSettingsController,
  type DesktopSettingsController,
} from "./desktopSettingsController";

export interface UseDesktopSettingsResult {
  settings: DesktopSettings | null;
  loading: boolean;
  saving: boolean;
  restartNeeded: boolean;
  restarting: boolean;
  updateAvailable: string | null;
  updateDownloaded: string | null;
  updaterStatus: UpdaterStatusPayload | null;
  checkingForUpdates: boolean;
  diagnosticsSnapshot: DiagnosticsSnapshot | null;
  diagnosticsRefreshing: boolean;
  diagnosticsNotice: { kind: "success" | "error"; message: string } | null;
  updateSettings: (partial: Partial<DesktopSettings>) => void;
  restartBackend: () => Promise<void>;
  selectDataDirectory: () => Promise<void>;
  selectDirectories: () => Promise<string[] | null>;
  refreshDiagnostics: () => Promise<void>;
  openLogsFolder: () => Promise<void>;
  openDataFolder: () => Promise<void>;
  copyDiagnosticReport: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  quitAndInstall: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
}

export function useDesktopSettings(): UseDesktopSettingsResult {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState<string | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload | null>(null);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsRefreshing, setDiagnosticsRefreshing] = useState(false);
  const [diagnosticsNotice, setDiagnosticsNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);

  const controllerRef = useRef<DesktopSettingsController | null>(null);

  const getController = (): DesktopSettingsController => {
    if (controllerRef.current) {
      return controllerRef.current;
    }

    controllerRef.current = createDesktopSettingsController({
      save: async (partial) => {
        if (!window.momodoc) {
          return;
        }
        setSaving(true);
        try {
          await window.momodoc.updateSettings(partial);
        } catch (error) {
          console.error("Failed to save settings:", error);
        } finally {
          setSaving(false);
        }
      },
      onRestartRequiredChange: setRestartNeeded,
      onError: (error) => {
        console.error("Failed to flush settings:", error);
      },
    });

    return controllerRef.current;
  };

  useEffect(() => {
    let cancelled = false;
    let unsubscribeUpdateAvailable: (() => void) | undefined;
    let unsubscribeUpdateDownloaded: (() => void) | undefined;
    let unsubscribeUpdaterStatus: (() => void) | undefined;

    const loadSettings = async () => {
      if (!window.momodoc) {
        if (!cancelled) {
          setLoading(false);
        }
        return;
      }

      try {
        const loadedSettings = await window.momodoc.getSettings();
        const initialUpdaterStatus = await window.momodoc.getUpdaterStatus();
        const initialDiagnostics = await window.momodoc.getDiagnosticsSnapshot();
        if (!cancelled) {
          setSettings(loadedSettings);
          setUpdaterStatus(initialUpdaterStatus);
          setDiagnosticsSnapshot(initialDiagnostics);
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }

      if (cancelled) {
        return;
      }

      unsubscribeUpdateAvailable = window.momodoc.onUpdateAvailable((version) => {
        setUpdateAvailable(version);
      });
      unsubscribeUpdateDownloaded = window.momodoc.onUpdateDownloaded((version) => {
        setUpdateDownloaded(version);
      });
      unsubscribeUpdaterStatus = window.momodoc.onUpdaterStatus((status) => {
        setUpdaterStatus(status);
      });
    };

    void loadSettings();

    return () => {
      cancelled = true;
      unsubscribeUpdateAvailable?.();
      unsubscribeUpdateDownloaded?.();
      unsubscribeUpdaterStatus?.();
      if (controllerRef.current) {
        void controllerRef.current.dispose();
      }
    };
  }, []);

  const updateSettings = (partial: Partial<DesktopSettings>) => {
    if (!settings) {
      return;
    }

    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
    getController().update(partial);
  };

  const restartBackend = async () => {
    if (!window.momodoc) {
      return;
    }

    await getController().flush();

    setRestarting(true);
    try {
      const restarted = await window.momodoc.restartBackend();
      if (restarted) {
        getController().clearRestartRequired();
        try {
          const snapshot = await window.momodoc.getDiagnosticsSnapshot();
          setDiagnosticsSnapshot(snapshot);
        } catch {}
      }
    } catch (error) {
      console.error("Failed to restart backend:", error);
    } finally {
      setRestarting(false);
    }
  };

  const selectDataDirectory = async () => {
    if (!window.momodoc) {
      return;
    }

    const directory = await window.momodoc.selectDirectory();
    if (directory) {
      updateSettings({ dataDir: directory });
    }
  };

  const selectDirectories = async (): Promise<string[] | null> => {
    if (!window.momodoc) {
      return null;
    }
    return window.momodoc.selectDirectories();
  };

  const refreshDiagnostics = async () => {
    if (!window.momodoc) {
      return;
    }
    setDiagnosticsRefreshing(true);
    setDiagnosticsNotice(null);
    try {
      const snapshot = await window.momodoc.getDiagnosticsSnapshot();
      setDiagnosticsSnapshot(snapshot);
    } catch (error) {
      console.error("Failed to refresh diagnostics:", error);
      setDiagnosticsNotice({
        kind: "error",
        message: "Failed to refresh diagnostics.",
      });
    } finally {
      setDiagnosticsRefreshing(false);
    }
  };

  const applyDiagnosticsActionResult = (
    result: DiagnosticsActionResult | CopyDiagnosticReportResult,
    successMessage: string,
    failureFallback: string
  ) => {
    if (result.ok) {
      setDiagnosticsNotice({ kind: "success", message: successMessage });
      return;
    }
    setDiagnosticsNotice({
      kind: "error",
      message: result.error || failureFallback,
    });
  };

  const openLogsFolder = async () => {
    if (!window.momodoc) return;
    const result = await window.momodoc.openLogsFolder();
    applyDiagnosticsActionResult(result, "Opened logs folder.", "Failed to open logs folder.");
  };

  const openDataFolder = async () => {
    if (!window.momodoc) return;
    const result = await window.momodoc.openDataFolder();
    applyDiagnosticsActionResult(result, "Opened data folder.", "Failed to open data folder.");
  };

  const copyDiagnosticReport = async () => {
    if (!window.momodoc) return;
    const result = await window.momodoc.copyDiagnosticReport();
    applyDiagnosticsActionResult(
      result,
      `Copied redacted diagnostic report (${result.bytes} bytes).`,
      "Failed to copy diagnostic report."
    );
  };

  const checkForUpdates = async () => {
    setUpdaterStatus((prev) =>
      prev?.state === "checking"
        ? prev
        : {
            state: "checking",
            message: "Checking for updates...",
            version: prev?.version ?? null,
            percent: prev?.percent ?? null,
            timestamp: new Date().toISOString(),
          }
    );
    await window.momodoc?.checkForUpdates();
  };

  const quitAndInstall = async () => {
    await window.momodoc?.quitAndInstall();
  };

  const downloadUpdate = async () => {
    await window.momodoc?.downloadUpdate();
  };

  return {
    settings,
    loading,
    saving,
    restartNeeded,
    restarting,
    updateAvailable,
    updateDownloaded,
    updaterStatus,
    checkingForUpdates: updaterStatus?.state === "checking",
    diagnosticsSnapshot,
    diagnosticsRefreshing,
    diagnosticsNotice,
    updateSettings,
    restartBackend,
    selectDataDirectory,
    selectDirectories,
    refreshDiagnostics,
    openLogsFolder,
    openDataFolder,
    copyDiagnosticReport,
    checkForUpdates,
    quitAndInstall,
    downloadUpdate,
  };
}
