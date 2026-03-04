import { useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";
import { ProjectView } from "./ProjectView";
import { SettingsPanel } from "./new/SettingsPanel";
import { MetricsDashboard } from "./new/MetricsDashboard";
import { OnboardingWizard } from "./OnboardingWizard";
import { Settings, BarChart3, Home, Info } from "lucide-react";
import type { DesktopSettings } from "../../shared/desktop-settings";
import type { DiagnosticsSnapshot } from "../../shared/diagnostics";
import type { UpdaterStatusPayload } from "../../shared/updater-status";
import { resolveStartupProfileTargets } from "../../shared/app-config";
import {
  markOnboardingOpened,
  shouldAutoOpenOnboarding,
} from "../../shared/onboarding";
import {
  getReleaseNotesForVersion,
  type ReleaseNotesEntry,
} from "../../shared/release-notes";

type View = "dashboard" | "project" | "settings" | "metrics";
type BackendStatus = Awaited<ReturnType<NonNullable<typeof window.momodoc>["getBackendStatus"]>>;
type PersistedLastSession = {
  view: View;
  projectId: string | null;
  projectName: string;
};

const LAST_SESSION_STORAGE_KEY = "momodoc-desktop-last-session-v1";
const LAST_SEEN_VERSION_STORAGE_KEY = "momodoc-last-seen-version";

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [backendReady, setBackendReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [updaterStatus, setUpdaterStatus] = useState<UpdaterStatusPayload | null>(null);
  const [checking, setChecking] = useState(true);
  const [startupActionNotice, setStartupActionNotice] = useState<string | null>(null);
  const [showStartupDetails, setShowStartupDetails] = useState(false);
  const [whatsNewEntry, setWhatsNewEntry] = useState<ReleaseNotesEntry | null>(null);
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  const refreshBackendStatus = async () => {
    try {
      if (window.momodoc) {
        const status = await window.momodoc.getBackendStatus();
        setBackendStatus(status);
        setBackendReady(status.running);
      } else {
        setBackendReady(true);
        setBackendStatus(null);
      }
    } catch {
      setBackendReady(false);
    }
  };

  const refreshDiagnosticsSnapshot = async () => {
    if (!window.momodoc) return;
    try {
      const snapshot = await window.momodoc.getDiagnosticsSnapshot();
      setDiagnosticsSnapshot(snapshot);
    } catch {
      // Diagnostics are best-effort in the shell.
    }
  };

  useEffect(() => {
    const check = async () => {
      try {
        if (window.momodoc) {
          const [status, initialSettings] = await Promise.all([
            window.momodoc.getBackendStatus(),
            window.momodoc.getSettings(),
          ]);
          setBackendStatus(status);
          setBackendReady(status.running);
          setSettings(initialSettings);
          try {
            const [initialUpdaterStatus, initialDiagnostics] = await Promise.all([
              window.momodoc.getUpdaterStatus(),
              window.momodoc.getDiagnosticsSnapshot(),
            ]);
            setUpdaterStatus(initialUpdaterStatus);
            setDiagnosticsSnapshot(initialDiagnostics);
          } catch {
            // Leave shell status cards in "unknown" state if these calls fail.
          }
        } else {
          setBackendReady(true);
          setBackendStatus(null);
        }
      } catch {
        setBackendReady(false);
      } finally {
        setChecking(false);
      }
    };
    check();

    if (window.momodoc) {
      const unsub1 = window.momodoc.onBackendReady(() => {
        void refreshBackendStatus();
        void refreshDiagnosticsSnapshot();
      });
      const unsub2 = window.momodoc.onBackendStopped(() => {
        void refreshBackendStatus();
        void refreshDiagnosticsSnapshot();
      });
      const unsubSettings = window.momodoc.onSettingsChanged((nextSettings) => {
        setSettings(nextSettings);
        void refreshDiagnosticsSnapshot();
      });
      const unsubUpdater = window.momodoc.onUpdaterStatus((status) => {
        setUpdaterStatus(status);
      });
      const unsub3 = window.momodoc.onNavigate((v: string) => {
        if (v === "settings" || v === "metrics" || v === "dashboard") {
          setView(v as View);
        }
      });
      return () => {
        unsub1();
        unsub2();
        unsubSettings();
        unsubUpdater();
        unsub3();
      };
    }
  }, []);

  const handleSelectProject = (id: string, name?: string) => {
    setProjectId(id);
    setProjectName(name || "");
    setView("project");
  };

  const handleBack = () => {
    setView("dashboard");
    setProjectId(null);
    setProjectName("");
  };

  const updateSettings = async (partial: Partial<DesktopSettings>) => {
    if (!window.momodoc || !settings) return;
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      await window.momodoc.updateSettings(partial);
      await refreshDiagnosticsSnapshot();
    } catch {
      // Settings panel remains the source of truth for detailed save feedback.
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload: PersistedLastSession = {
      view,
      projectId,
      projectName,
    };
    try {
      localStorage.setItem(LAST_SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore persistence failures.
    }
  }, [view, projectId, projectName]);

  useEffect(() => {
    if (!settings || checking) return;

    const restoreTargets = resolveStartupProfileTargets({
      startupProfilePreset: settings.startupProfilePreset,
      startupProfileCustom: settings.startupProfileCustom,
    });

    if (!restoreTargets.restoreLastSession) {
      try {
        localStorage.removeItem(LAST_SESSION_STORAGE_KEY);
      } catch {
        // Ignore storage failures.
      }
      return;
    }

    if (view !== "dashboard" || projectId !== null) {
      return;
    }

    try {
      const raw = localStorage.getItem(LAST_SESSION_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<PersistedLastSession>;
      if (parsed.view === "project" && typeof parsed.projectId === "string") {
        setProjectId(parsed.projectId);
        setProjectName(typeof parsed.projectName === "string" ? parsed.projectName : "");
        setView("project");
      } else if (
        parsed.view === "settings" ||
        parsed.view === "metrics" ||
        parsed.view === "dashboard"
      ) {
        setView(parsed.view);
      }
    } catch {
      // Ignore malformed persisted session payloads.
    }
    // Only run on initial settings load / profile changes; avoid fighting manual navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, settings?.startupProfilePreset, settings?.startupProfileCustom]);

  useEffect(() => {
    if (!diagnosticsSnapshot?.isPackaged) return;
    const currentVersion = diagnosticsSnapshot.appVersion;
    if (!currentVersion) return;

    try {
      const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_STORAGE_KEY);
      if (!lastSeen) {
        localStorage.setItem(LAST_SEEN_VERSION_STORAGE_KEY, currentVersion);
        return;
      }
      if (lastSeen === currentVersion) {
        return;
      }
      const notes =
        getReleaseNotesForVersion(currentVersion) ??
        ({
          version: currentVersion,
          title: `What’s New in v${currentVersion}`,
          highlights: [
            "This version includes desktop app improvements and usability fixes.",
            "Review Settings and Diagnostics for any new options.",
          ],
        } satisfies ReleaseNotesEntry);
      setWhatsNewEntry(notes);
      setShowWhatsNew(true);
    } catch {
      // Ignore local storage failures.
    }
  }, [diagnosticsSnapshot]);

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-fg-tertiary border-t-fg-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-fg-secondary text-sm">Starting momodoc...</p>
        </div>
      </div>
    );
  }

  const startupState = backendStatus?.startupState ?? "stopped";
  const startupError = backendStatus?.startupError ?? null;
  const startupErrorCategory = backendStatus?.startupErrorCategory ?? null;
  const inferredStartupErrorCategory =
    startupErrorCategory ??
    (startupError && /token|auth|unauthorized|forbidden/i.test(startupError)
      ? "auth-mismatch"
      : startupError && /migrat|sqlite|database schema|db/i.test(startupError)
        ? "migration-error"
        : null);

  const startupTitle =
    startupState === "starting"
      ? "Starting backend..."
      : startupState === "failed"
        ? "Backend failed to start"
        : "Backend not running";

  const startupMessage =
    inferredStartupErrorCategory === "port-conflict"
      ? "The configured backend port is already in use. Stop the conflicting process or change the port in Settings."
      : inferredStartupErrorCategory === "timeout"
        ? "The backend did not become ready in time. You can retry or open diagnostics and logs."
        : inferredStartupErrorCategory === "spawn-error"
          ? "Momodoc could not launch the backend process. Open logs or diagnostics for details."
          : inferredStartupErrorCategory === "auth-mismatch"
            ? "The desktop app could not authenticate to the local backend. Retry first, then open diagnostics if it persists."
            : inferredStartupErrorCategory === "migration-error"
              ? "The backend reported a data or migration issue during startup. Open diagnostics and logs for guidance."
              : inferredStartupErrorCategory === "runtime-error"
            ? "The backend reported an error during startup. Open logs or diagnostics for details."
            : startupState === "starting"
              ? "Momodoc is waiting for the backend to become ready..."
              : "Waiting for the momodoc backend to start...";

  const showOnboarding =
    Boolean(settings) &&
    backendReady &&
    shouldAutoOpenOnboarding(settings!.onboarding);
  const selectedProviderStatus =
    diagnosticsSnapshot?.providers.find((provider) => provider.selected) ?? null;
  const homeStatus = {
    backend: {
      state:
        backendStatus?.startupState === "ready"
          ? "ready"
          : backendStatus?.startupState === "starting"
            ? "starting"
            : backendStatus?.startupState === "failed"
              ? "failed"
              : "stopped",
      detail: startupMessage,
    },
    provider: selectedProviderStatus
      ? {
          label: selectedProviderStatus.provider,
          configured: selectedProviderStatus.configured,
          detail: selectedProviderStatus.detail,
        }
      : diagnosticsSnapshot
        ? {
            label: diagnosticsSnapshot.selectedProvider || "none",
            configured: false,
            detail: "No selected provider status found.",
          }
        : null,
    watcher: settings
      ? {
          configured: settings.allowedIndexPaths.length > 0,
          folderCount: settings.allowedIndexPaths.length,
        }
      : null,
    updater: updaterStatus
      ? {
          state: updaterStatus.state,
          message: updaterStatus.message,
        }
      : null,
    onboardingStatus: settings?.onboarding.status ?? null,
  } as const;

  if (!backendReady && view !== "settings") {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-primary">
        <div className="w-full max-w-lg mx-4 rounded-default border border-border bg-bg-secondary/40 p-5">
          <div className="mb-4">
            <p className="text-fg-primary text-lg mb-2">{startupTitle}</p>
            <p className="text-fg-secondary text-sm">{startupMessage}</p>
            {startupError ? (
              <div className="mt-2">
                <button
                  onClick={() => setShowStartupDetails((prev) => !prev)}
                  className="text-xs text-fg-secondary hover:text-fg-primary transition-colors"
                >
                  {showStartupDetails ? "Hide details" : "Show details"}
                </button>
                {showStartupDetails ? (
                  <p className="text-xs text-fg-tertiary mt-2 break-words whitespace-pre-wrap">
                    {startupError}
                  </p>
                ) : null}
              </div>
            ) : null}
            {startupActionNotice ? (
              <p className="text-xs text-fg-secondary mt-2">{startupActionNotice}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={async () => {
                setStartupActionNotice(null);
                if (window.momodoc) {
                  const ok = await window.momodoc.restartBackend();
                  await refreshBackendStatus();
                  if (ok) setBackendReady(true);
                }
              }}
              className="px-4 py-2 bg-bg-elevated text-fg-primary text-sm rounded-default border border-border hover:bg-bg-tertiary transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => setView("settings")}
              className="px-4 py-2 bg-bg-primary text-fg-primary text-sm rounded-default border border-border hover:bg-hover transition-colors"
            >
              Open Settings
            </button>
            <button
              onClick={async () => {
                if (!window.momodoc) return;
                const result = await window.momodoc.openLogsFolder();
                setStartupActionNotice(
                  result.ok ? "Opened logs folder." : result.error || "Failed to open logs folder."
                );
              }}
              className="px-4 py-2 bg-bg-primary text-fg-primary text-sm rounded-default border border-border hover:bg-hover transition-colors"
            >
              Open Logs
            </button>
            <button
              onClick={async () => {
                if (!window.momodoc) return;
                const result = await window.momodoc.openDataFolder();
                setStartupActionNotice(
                  result.ok ? "Opened data folder." : result.error || "Failed to open data folder."
                );
              }}
              className="px-4 py-2 bg-bg-primary text-fg-primary text-sm rounded-default border border-border hover:bg-hover transition-colors"
            >
              Open Data Folder
            </button>
            <button
              onClick={async () => {
                if (!window.momodoc) return;
                const result = await window.momodoc.copyDiagnosticReport();
                setStartupActionNotice(
                  result.ok
                    ? `Copied redacted diagnostic report (${result.bytes} bytes).`
                    : result.error || "Failed to copy diagnostic report."
                );
              }}
              className="px-4 py-2 bg-bg-primary text-fg-primary text-sm rounded-default border border-border hover:bg-hover transition-colors"
            >
              Copy Diagnostics
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg-primary">
      {/* Titlebar */}
      <nav className="shrink-0 flex items-center h-10 px-4 bg-bg-primary/80 backdrop-blur-md border-b border-border titlebar-drag z-50">
        <div className="w-[72px] shrink-0" />

        <div className="flex items-center gap-1 titlebar-no-drag">
          <button
            onClick={() => { setView("dashboard"); setProjectId(null); setProjectName(""); }}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-default transition-colors ${
              view === "dashboard" || view === "project"
                ? "text-fg-primary bg-bg-elevated"
                : "text-fg-secondary hover:text-fg-primary hover:bg-hover"
            }`}
          >
            <Home size={13} />
            Projects
          </button>
          <button
            onClick={() => setView("metrics")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-default transition-colors ${
              view === "metrics"
                ? "text-fg-primary bg-bg-elevated"
                : "text-fg-secondary hover:text-fg-primary hover:bg-hover"
            }`}
          >
            <BarChart3 size={13} />
            Metrics
          </button>
          <button
            onClick={() => setView("settings")}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-default transition-colors ${
              view === "settings"
                ? "text-fg-primary bg-bg-elevated"
                : "text-fg-secondary hover:text-fg-primary hover:bg-hover"
            }`}
          >
            <Settings size={13} />
            Settings
          </button>
        </div>
      </nav>

      {/* Content fills remaining height */}
      <main className="flex-1 min-h-0">
        {view === "project" && projectId ? (
          <ProjectView projectId={projectId} onBack={handleBack} />
        ) : view === "settings" ? (
          <SettingsPanel />
        ) : view === "metrics" ? (
          <MetricsDashboard />
        ) : (
          <Dashboard
            onSelectProject={handleSelectProject}
            onOpenOverlay={async () => {
              await window.momodoc?.toggleOverlay();
            }}
            onOpenWebUi={async () => {
              await window.momodoc?.openWebUi();
            }}
            onOpenDiagnostics={() => setView("settings")}
            onResumeOnboarding={async () => {
              if (!settings) return;
              await updateSettings({
                onboarding: markOnboardingOpened(settings.onboarding),
              });
            }}
            homeStatus={homeStatus}
          />
        )}
      </main>

      {settings && showOnboarding ? (
        <OnboardingWizard
          settings={settings}
          onUpdateSettings={updateSettings}
          onOpenSettings={() => setView("settings")}
          onOpenDiagnostics={() => setView("settings")}
          onOpenOverlay={async () => {
            await window.momodoc?.toggleOverlay();
          }}
          onOpenProject={handleSelectProject}
        />
      ) : null}

      {showWhatsNew && whatsNewEntry ? (
        <div className="absolute inset-0 z-[75] bg-bg-primary/70 backdrop-blur-sm">
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-2xl px-4 py-12">
              <div className="rounded-[var(--radius-default)] border border-border bg-bg-primary shadow-2xl">
                <div className="border-b border-border px-5 py-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Info size={14} className="text-fg-secondary" />
                      <span className="text-xs text-fg-secondary">What’s New</span>
                    </div>
                    <h2 className="mt-2 text-lg font-semibold tracking-[-0.03em] text-fg-primary">
                      {whatsNewEntry.title}
                    </h2>
                    <p className="mt-1 text-sm text-fg-secondary">
                      Installed version: v{whatsNewEntry.version}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setShowWhatsNew(false);
                      try {
                        localStorage.setItem(
                          LAST_SEEN_VERSION_STORAGE_KEY,
                          whatsNewEntry.version
                        );
                      } catch {
                        // Ignore storage failures.
                      }
                    }}
                    className="px-2 py-1 text-xs rounded-default border border-border text-fg-secondary hover:text-fg-primary hover:bg-hover transition-colors"
                  >
                    Close
                  </button>
                </div>
                <div className="px-5 py-4">
                  <ul className="space-y-2">
                    {whatsNewEntry.highlights.map((highlight) => (
                      <li key={highlight} className="text-sm text-fg-primary flex gap-2">
                        <span className="text-fg-tertiary">•</span>
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="border-t border-border px-5 py-4 flex flex-wrap gap-2 justify-end">
                  <button
                    onClick={() => setView("settings")}
                    className="px-3 py-2 text-sm rounded-default border border-border text-fg-primary hover:bg-hover transition-colors"
                  >
                    Open Settings
                  </button>
                  <button
                    onClick={() => {
                      setShowWhatsNew(false);
                      try {
                        localStorage.setItem(
                          LAST_SEEN_VERSION_STORAGE_KEY,
                          whatsNewEntry.version
                        );
                      } catch {
                        // Ignore storage failures.
                      }
                    }}
                    className="px-3 py-2 text-sm rounded-default border border-border bg-bg-elevated text-fg-primary hover:bg-bg-tertiary transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
