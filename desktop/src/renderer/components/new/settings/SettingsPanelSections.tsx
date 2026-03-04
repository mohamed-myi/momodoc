import { useCallback, useEffect, useState } from "react";
import type { LLMSettings } from "../../../../../../frontend/src/shared/renderer/lib/types";
import {
  resolveStartupProfileTargets,
  type StartupProfilePreset,
  type StartupProfileLaunchTargets,
} from "../../../../shared/app-config";
import type { DiagnosticsSnapshot } from "../../../../shared/diagnostics";
import type { DesktopSettings } from "../../../../shared/desktop-settings";
import type { UpdaterStatusPayload } from "../../../../shared/updater-status";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Download,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import {
  markOnboardingOpened,
  resetOnboardingState,
} from "../../../../shared/onboarding";
import { ModelSelector } from "../../../../../../frontend/src/shared/renderer/components/ModelSelector";
import { api } from "../../../lib/api";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Toggle } from "../../ui/toggle";

const PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "openai", label: "OpenAI" },
  { value: "gemini", label: "Gemini (Google)" },
  { value: "ollama", label: "Ollama (Local)" },
];

const LOG_LEVELS = ["DEBUG", "INFO", "WARNING", "ERROR"] as const;

type UpdateSettings = (partial: Partial<DesktopSettings>) => void;

interface SettingsSectionProps {
  settings: DesktopSettings;
  updateSettings: UpdateSettings;
}

interface ServerSettingsSectionProps extends SettingsSectionProps {
  onSelectDirectory: () => Promise<void>;
}

interface IndexingSettingsSectionProps extends SettingsSectionProps {
  onSelectDirectories: () => Promise<string[] | null>;
}

interface StartupLaunchSettingsSectionProps extends SettingsSectionProps {}

interface DiagnosticsSettingsSectionProps {
  diagnosticsSnapshot: DiagnosticsSnapshot | null;
  diagnosticsRefreshing: boolean;
  diagnosticsNotice: { kind: "success" | "error"; message: string } | null;
  onRefreshDiagnostics: () => Promise<void>;
  onOpenLogsFolder: () => Promise<void>;
  onOpenDataFolder: () => Promise<void>;
  onRestartBackend: () => Promise<void>;
  onCopyDiagnosticReport: () => Promise<void>;
}

interface UpdatesSettingsSectionProps {
  appVersion?: string | null;
  updateAvailable: string | null;
  updateDownloaded: string | null;
  updaterStatus: UpdaterStatusPayload | null;
  checkingForUpdates: boolean;
  onCheckForUpdates: () => Promise<void>;
  onQuitAndInstall: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
}

const STARTUP_PROFILE_OPTIONS: Array<{ value: StartupProfilePreset; label: string }> = [
  { value: "desktop", label: "Desktop (recommended)" },
  { value: "desktopOverlay", label: "Desktop + Overlay" },
  { value: "desktopWeb", label: "Desktop + Web" },
  { value: "vscodeCompanion", label: "VS Code Companion" },
  { value: "custom", label: "Custom" },
];

function getResolvedStartupTargets(settings: DesktopSettings): StartupProfileLaunchTargets {
  return resolveStartupProfileTargets({
    startupProfilePreset: settings.startupProfilePreset,
    startupProfileCustom: settings.startupProfileCustom,
  });
}

function getStartupWarnings(settings: DesktopSettings): string[] {
  const warnings: string[] = [];
  const targets = getResolvedStartupTargets(settings);

  if (targets.startMinimizedToTray && !settings.showInTray) {
    warnings.push(
      "Start minimized to tray needs the tray icon enabled. Momodoc will fall back to opening the main window."
    );
  }

  const hasVisibleSurface =
    targets.openMainWindowOnLaunch ||
    targets.startMinimizedToTray ||
    targets.openOverlayOnLaunch ||
    targets.openWebUiOnLaunch ||
    targets.openVsCodeOnLaunch;
  if (!hasVisibleSurface) {
    warnings.push(
      "This custom profile opens no visible surfaces. Momodoc will fall back to opening the main window."
    );
  }

  return warnings;
}

function formatStartupSummary(settings: DesktopSettings): string {
  const targets = getResolvedStartupTargets(settings);
  const parts: string[] = [];

  parts.push(settings.autoLaunch ? "On login: enabled" : "On login: off");
  if (settings.showInTray) {
    parts.push("tray on");
  }
  if (targets.startBackendOnLaunch) {
    parts.push("backend starts");
  } else {
    parts.push("backend off");
  }
  if (targets.startMinimizedToTray) {
    parts.push("start hidden in tray");
  } else if (targets.openMainWindowOnLaunch) {
    parts.push("main window opens");
  } else {
    parts.push("main window hidden");
  }
  if (targets.openOverlayOnLaunch) {
    parts.push("overlay opens");
  }
  if (targets.openWebUiOnLaunch) {
    parts.push("web UI opens");
  }
  if (targets.openVsCodeOnLaunch) {
    parts.push("VS Code opens");
  }
  if (!targets.restoreLastSession) {
    parts.push("does not restore last session");
  }

  return parts.join(" • ");
}

export function LlmSettingsSection() {
  const [llm, setLlm] = useState<LLMSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setLlm).catch(() => {});
  }, []);

  const save = useCallback(
    (partial: Partial<LLMSettings>) => {
      setLlm((prev) => (prev ? { ...prev, ...partial } : prev));
      setSaving(true);
      api
        .updateSettings(partial)
        .then(setLlm)
        .catch(() => {})
        .finally(() => setSaving(false));
    },
    [],
  );

  if (!llm) {
    return (
      <Card>
        <div className="p-4">
          <p className="text-sm text-fg-secondary">Loading LLM settings...</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-h3 font-medium text-fg-primary">LLM Provider</h2>
          {saving && (
            <span className="text-xs text-fg-tertiary">Saving...</span>
          )}
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">
              Default Provider
            </span>
            <select
              value={llm.llm_provider}
              onChange={(event) =>
                save({ llm_provider: event.target.value })
              }
              className="w-full h-9 px-3 bg-bg-input border border-border rounded-default text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <div className="space-y-2">
            <span className="text-xs text-fg-secondary font-medium">
              Claude (Anthropic)
            </span>
            <Input
              type="password"
              placeholder="Anthropic API Key"
              value={llm.anthropic_api_key}
              onChange={(event) =>
                save({ anthropic_api_key: event.target.value })
              }
            />
            <ModelSelector
              provider="claude"
              value={llm.claude_model}
              onChange={(model) => save({ claude_model: model })}
              fetchModels={api.getProviderModels}
              placeholder="e.g. claude-sonnet-4-6"
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs text-fg-secondary font-medium">OpenAI</span>
            <Input
              type="password"
              placeholder="OpenAI API Key"
              value={llm.openai_api_key}
              onChange={(event) =>
                save({ openai_api_key: event.target.value })
              }
            />
            <ModelSelector
              provider="openai"
              value={llm.openai_model}
              onChange={(model) => save({ openai_model: model })}
              fetchModels={api.getProviderModels}
              placeholder="e.g. gpt-4o"
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs text-fg-secondary font-medium">
              Gemini (Google)
            </span>
            <Input
              type="password"
              placeholder="Google API Key"
              value={llm.google_api_key}
              onChange={(event) =>
                save({ google_api_key: event.target.value })
              }
            />
            <ModelSelector
              provider="gemini"
              value={llm.gemini_model}
              onChange={(model) => save({ gemini_model: model })}
              fetchModels={api.getProviderModels}
              placeholder="e.g. gemini-2.5-flash"
            />
          </div>

          <div className="space-y-2">
            <span className="text-xs text-fg-secondary font-medium">
              Ollama (Local)
            </span>
            <Input
              placeholder="Ollama Base URL"
              value={llm.ollama_base_url}
              onChange={(event) =>
                save({ ollama_base_url: event.target.value })
              }
            />
            <ModelSelector
              provider="ollama"
              value={llm.ollama_model}
              onChange={(model) => save({ ollama_model: model })}
              fetchModels={api.getProviderModels}
              placeholder="e.g. qwen2.5-coder:7b"
            />
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ServerSettingsSection({
  settings,
  updateSettings,
  onSelectDirectory,
}: ServerSettingsSectionProps) {
  return (
    <Card>
      <div className="p-4 space-y-4">
        <h2 className="text-h3 font-medium text-fg-primary">Server</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">Port</span>
            <Input
              type="number"
              value={settings.port}
              onChange={(event) =>
                updateSettings({ port: parseInt(event.target.value, 10) || 8000 })
              }
            />
          </label>
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">
              Max Upload Size (MB)
            </span>
            <Input
              type="number"
              value={settings.maxUploadSizeMb}
              onChange={(event) =>
                updateSettings({
                  maxUploadSizeMb: parseInt(event.target.value, 10) || 100,
                })
              }
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-fg-secondary mb-1 block">
            Data Directory
          </span>
          <div className="flex gap-2">
            <Input
              value={settings.dataDir}
              onChange={(event) =>
                updateSettings({ dataDir: event.target.value })
              }
              placeholder="Default (OS user data dir)"
              className="flex-1"
            />
            <Button variant="secondary" size="sm" onClick={onSelectDirectory}>
              <FolderOpen size={14} />
            </Button>
          </div>
        </label>
        <label className="block">
          <span className="text-xs text-fg-secondary mb-1 block">Log Level</span>
          <select
            value={settings.logLevel}
            onChange={(event) => updateSettings({ logLevel: event.target.value })}
            className="w-full h-9 px-3 bg-bg-input border border-border rounded-default text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
          >
            {LOG_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Card>
  );
}

export function ChunkingSettingsSection({
  settings,
  updateSettings,
}: SettingsSectionProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <Card>
      <button
        className="w-full p-4 flex items-center justify-between text-left"
        onClick={() => setShowAdvanced((value) => !value)}
      >
        <h2 className="text-h3 font-medium text-fg-primary">Chunking (Advanced)</h2>
        {showAdvanced ? (
          <ChevronDown size={16} className="text-fg-secondary" />
        ) : (
          <ChevronRight size={16} className="text-fg-secondary" />
        )}
      </button>
      {showAdvanced && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Default Chunk Size
              </span>
              <Input
                type="number"
                value={settings.chunkSizeDefault}
                onChange={(event) =>
                  updateSettings({
                    chunkSizeDefault: parseInt(event.target.value, 10) || 2000,
                  })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Chunk Overlap
              </span>
              <Input
                type="number"
                value={settings.chunkOverlapDefault}
                onChange={(event) =>
                  updateSettings({
                    chunkOverlapDefault: parseInt(event.target.value, 10) || 200,
                  })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Code Chunk Size
              </span>
              <Input
                type="number"
                value={settings.chunkSizeCode}
                onChange={(event) =>
                  updateSettings({
                    chunkSizeCode: parseInt(event.target.value, 10) || 2000,
                  })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                PDF Chunk Size
              </span>
              <Input
                type="number"
                value={settings.chunkSizePdf}
                onChange={(event) =>
                  updateSettings({
                    chunkSizePdf: parseInt(event.target.value, 10) || 3000,
                  })
                }
              />
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Markdown Chunk Size
              </span>
              <Input
                type="number"
                value={settings.chunkSizeMarkdown}
                onChange={(event) =>
                  updateSettings({
                    chunkSizeMarkdown: parseInt(event.target.value, 10) || 2000,
                  })
                }
              />
            </label>
          </div>
        </div>
      )}
    </Card>
  );
}

export function StartupLaunchSettingsSection({
  settings,
  updateSettings,
}: StartupLaunchSettingsSectionProps) {
  const isCustom = settings.startupProfilePreset === "custom";
  const resolvedTargets = getResolvedStartupTargets(settings);
  const warnings = getStartupWarnings(settings);
  const summary = formatStartupSummary(settings);

  const updateCustomTargets = (partial: Partial<StartupProfileLaunchTargets>) => {
    updateSettings({
      startupProfileCustom: {
        ...settings.startupProfileCustom,
        ...partial,
      },
    });
  };

  return (
    <Card>
      <div className="p-4 space-y-4">
        <h2 className="text-h3 font-medium text-fg-primary">Startup & Launch</h2>
        <p className="text-xs text-fg-secondary">
          Control what opens together when Momodoc starts. These settings mostly
          apply on the next app launch.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-fg-primary">Auto-launch on startup</p>
              <p className="text-xs text-fg-secondary">
                Start momodoc when you log in
              </p>
            </div>
            <Toggle
              checked={settings.autoLaunch}
              onChange={(value) => updateSettings({ autoLaunch: value })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-fg-primary">Show in system tray</p>
              <p className="text-xs text-fg-secondary">
                Keep momodoc accessible from the tray
              </p>
            </div>
            <Toggle
              checked={settings.showInTray}
              onChange={(value) => updateSettings({ showInTray: value })}
            />
          </div>

          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">
              Launch Profile
            </span>
            <select
              value={settings.startupProfilePreset}
              onChange={(event) =>
                updateSettings({
                  startupProfilePreset: event.target.value as StartupProfilePreset,
                })
              }
              className="w-full h-9 px-3 bg-bg-input border border-border rounded-default text-sm text-fg-primary focus:outline-none focus:ring-1 focus:ring-focus-ring"
            >
              {STARTUP_PROFILE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-default border border-border bg-bg-secondary/50 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-fg-tertiary mb-1">
              Startup summary
            </p>
            <p className="text-sm text-fg-primary">{summary}</p>
          </div>

          {warnings.map((warning) => (
            <div
              key={warning}
              className="flex items-start gap-2 rounded-default border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}

          {isCustom ? (
            <div className="space-y-3 rounded-default border border-border p-3">
              <p className="text-xs font-medium text-fg-primary">Custom startup targets</p>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Start backend on launch</p>
                  <p className="text-xs text-fg-secondary">
                    Start the local Momodoc backend automatically.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.startBackendOnLaunch}
                  onChange={(value) =>
                    updateCustomTargets({ startBackendOnLaunch: value })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Open main window on launch</p>
                  <p className="text-xs text-fg-secondary">
                    Show the desktop window when the app starts.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.openMainWindowOnLaunch}
                  onChange={(value) =>
                    updateCustomTargets({ openMainWindowOnLaunch: value })
                  }
                  className={
                    settings.startupProfileCustom.startMinimizedToTray
                      ? "opacity-50 pointer-events-none"
                      : ""
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Start minimized to tray</p>
                  <p className="text-xs text-fg-secondary">
                    Hide the main window at startup and rely on the tray icon.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.startMinimizedToTray}
                  onChange={(value) =>
                    updateCustomTargets({ startMinimizedToTray: value })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Open overlay on launch</p>
                  <p className="text-xs text-fg-secondary">
                    Open the overlay chat surface when the app starts.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.openOverlayOnLaunch}
                  onChange={(value) =>
                    updateCustomTargets({ openOverlayOnLaunch: value })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Open web UI in browser</p>
                  <p className="text-xs text-fg-secondary">
                    Best effort: opens the local web UI URL after backend startup.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.openWebUiOnLaunch}
                  onChange={(value) =>
                    updateCustomTargets({ openWebUiOnLaunch: value })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Open VS Code</p>
                  <p className="text-xs text-fg-secondary">
                    Best effort: launches VS Code if the `code` command is available.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.openVsCodeOnLaunch}
                  onChange={(value) =>
                    updateCustomTargets({ openVsCodeOnLaunch: value })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-fg-primary">Restore last session</p>
                  <p className="text-xs text-fg-secondary">
                    Preserve the last session/window state when supported.
                  </p>
                </div>
                <Toggle
                  checked={settings.startupProfileCustom.restoreLastSession}
                  onChange={(value) =>
                    updateCustomTargets({ restoreLastSession: value })
                  }
                />
              </div>
            </div>
          ) : (
            <div className="rounded-default border border-border bg-bg-secondary/30 px-3 py-2 text-xs text-fg-secondary">
              Preset controls are read-only here. Switch to <span className="text-fg-primary font-medium">Custom</span> to fine-tune what opens together.
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function AppSettingsSection({
  settings,
  updateSettings,
}: SettingsSectionProps) {
  const onboardingStatus = settings.onboarding.status;

  return (
    <Card>
      <div className="p-4 space-y-4">
        <h2 className="text-h3 font-medium text-fg-primary">App Behavior</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-fg-secondary mb-1 block">
              Global Hotkey (Overlay)
            </span>
            <Input
              value={settings.globalHotkey}
              onChange={(event) =>
                updateSettings({ globalHotkey: event.target.value })
              }
              placeholder="CommandOrControl+Shift+Space"
            />
            <span className="text-[11px] text-fg-tertiary mt-1 block">
              Electron accelerator format. Restart app to apply.
            </span>
          </label>

          <div className="rounded-default border border-border bg-bg-secondary/20 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-fg-primary">Setup Wizard</p>
                <p className="text-xs text-fg-secondary">
                  Reopen or reset the first-run onboarding flow.
                </p>
              </div>
              <Badge variant={onboardingStatus === "completed" ? "default" : "outline"}>
                {onboardingStatus === "completed"
                  ? "Completed"
                  : onboardingStatus === "skipped"
                    ? "Skipped"
                    : onboardingStatus === "in_progress"
                      ? "In progress"
                      : "Not started"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  updateSettings({
                    onboarding: markOnboardingOpened(settings.onboarding),
                  })
                }
              >
                <Sparkles size={13} />
                {onboardingStatus === "completed" ? "Reopen Setup Wizard" : "Resume Setup Wizard"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateSettings({
                    onboarding: resetOnboardingState(),
                  })
                }
              >
                <RotateCcw size={13} />
                Reset Onboarding
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function IndexingSettingsSection({
  settings,
  updateSettings,
  onSelectDirectories,
}: IndexingSettingsSectionProps) {
  const paths = settings.allowedIndexPaths ?? [];

  const addPaths = async () => {
    const selected = await onSelectDirectories();
    if (!selected || selected.length === 0) return;
    const merged = Array.from(new Set([...paths, ...selected]));
    updateSettings({ allowedIndexPaths: merged });
  };

  const removePath = (index: number) => {
    updateSettings({ allowedIndexPaths: paths.filter((_, i) => i !== index) });
  };

  return (
    <Card>
      <div className="p-4 space-y-4">
        <h2 className="text-h3 font-medium text-fg-primary">Indexing</h2>

        <div className="space-y-2">
          <span className="text-xs text-fg-secondary mb-1 block">
            Allowed Index Paths
          </span>
          <p className="text-[11px] text-fg-tertiary">
            Directories the backend is allowed to index. If empty, all directory
            indexing and folder sync is blocked.
          </p>
          {paths.length > 0 && (
            <div className="space-y-1">
              {paths.map((p, i) => (
                <div
                  key={p}
                  className="flex items-center gap-2 px-2 py-1.5 bg-bg-input border border-border rounded-default text-sm text-fg-primary"
                >
                  <span className="flex-1 truncate">{p}</span>
                  <button
                    onClick={() => removePath(i)}
                    className="text-fg-tertiary hover:text-fg-primary shrink-0"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button variant="secondary" size="sm" onClick={() => void addPaths()}>
            <FolderOpen size={14} />
            Add Folders
          </Button>
        </div>

        <label className="block">
          <span className="text-xs text-fg-secondary mb-1 block">
            Max File Size for Indexing (MB)
          </span>
          <Input
            type="number"
            value={settings.maxFileSizeMb}
            onChange={(event) =>
              updateSettings({
                maxFileSizeMb: parseInt(event.target.value, 10) || 200,
              })
            }
          />
          <span className="text-[11px] text-fg-tertiary mt-1 block">
            Files larger than this are silently skipped during directory indexing.
          </span>
        </label>
      </div>
    </Card>
  );
}

export function RateLimitSettingsSection({
  settings,
  updateSettings,
}: SettingsSectionProps) {
  return (
    <Card>
      <div className="p-4 space-y-4">
        <h2 className="text-h3 font-medium text-fg-primary">Chat Rate Limiting</h2>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-fg-primary">Enable rate limiting</p>
            <p className="text-xs text-fg-secondary">
              Enforce per-client rate limits on chat endpoints. Disable for
              single-user desktop use.
            </p>
          </div>
          <Toggle
            checked={settings.chatRateLimitEnabled}
            onChange={(value) => updateSettings({ chatRateLimitEnabled: value })}
          />
        </div>

        {settings.chatRateLimitEnabled && (
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Client Requests
              </span>
              <Input
                type="number"
                value={settings.chatRateLimitClientRequests}
                onChange={(event) =>
                  updateSettings({
                    chatRateLimitClientRequests:
                      parseInt(event.target.value, 10) || 30,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Max non-streaming requests per window.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Streaming Requests
              </span>
              <Input
                type="number"
                value={settings.chatStreamRateLimitClientRequests}
                onChange={(event) =>
                  updateSettings({
                    chatStreamRateLimitClientRequests:
                      parseInt(event.target.value, 10) || 15,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Max streaming requests per window.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Window (seconds)
              </span>
              <Input
                type="number"
                value={settings.chatRateLimitWindowSeconds}
                onChange={(event) =>
                  updateSettings({
                    chatRateLimitWindowSeconds:
                      parseInt(event.target.value, 10) || 60,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Rate limit window duration.
              </span>
            </label>
          </div>
        )}
      </div>
    </Card>
  );
}

export function RetrievalSettingsSection({
  settings,
  updateSettings,
}: SettingsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <button
        className="w-full p-4 flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <h2 className="text-h3 font-medium text-fg-primary">
          Retrieval Quality (Advanced)
        </h2>
        {expanded ? (
          <ChevronDown size={16} className="text-fg-secondary" />
        ) : (
          <ChevronRight size={16} className="text-fg-secondary" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Search nprobes
              </span>
              <Input
                type="number"
                value={settings.vectordbSearchNprobes}
                onChange={(event) =>
                  updateSettings({
                    vectordbSearchNprobes:
                      parseInt(event.target.value, 10) || 24,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                IVF partitions to probe. Higher = better recall, slower search.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Search Refine Factor
              </span>
              <Input
                type="number"
                value={settings.vectordbSearchRefineFactor}
                onChange={(event) =>
                  updateSettings({
                    vectordbSearchRefineFactor:
                      parseInt(event.target.value, 10) || 2,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Candidate over-fetch multiplier before re-ranking.
              </span>
            </label>
          </div>
        </div>
      )}
    </Card>
  );
}

export function AdvancedSettingsSection({
  settings,
  updateSettings,
}: SettingsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <button
        className="w-full p-4 flex items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <h2 className="text-h3 font-medium text-fg-primary">
          Advanced
        </h2>
        {expanded ? (
          <ChevronDown size={16} className="text-fg-secondary" />
        ) : (
          <ChevronRight size={16} className="text-fg-secondary" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <div className="space-y-2">
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Embedding Model
              </span>
              <Input
                value={settings.embeddingModel}
                onChange={(event) =>
                  updateSettings({ embeddingModel: event.target.value })
                }
                placeholder="all-MiniLM-L6-v2"
              />
            </label>
            <div className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle size={12} />
              Changing the embedding model requires full re-ingestion of all
              documents.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Sync Concurrency
              </span>
              <Input
                type="number"
                value={settings.syncMaxConcurrentFiles}
                onChange={(event) =>
                  updateSettings({
                    syncMaxConcurrentFiles:
                      parseInt(event.target.value, 10) || 4,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Max files processed concurrently during directory sync.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Sync Queue Size
              </span>
              <Input
                type="number"
                value={settings.syncQueueSize}
                onChange={(event) =>
                  updateSettings({
                    syncQueueSize: parseInt(event.target.value, 10) || 64,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Max queued files during directory sync.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Index Concurrency
              </span>
              <Input
                type="number"
                value={settings.indexMaxConcurrentFiles}
                onChange={(event) =>
                  updateSettings({
                    indexMaxConcurrentFiles:
                      parseInt(event.target.value, 10) || 4,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Max files processed concurrently during direct indexing.
              </span>
            </label>
            <label className="block">
              <span className="text-xs text-fg-secondary mb-1 block">
                Index Discovery Batch Size
              </span>
              <Input
                type="number"
                value={settings.indexDiscoveryBatchSize}
                onChange={(event) =>
                  updateSettings({
                    indexDiscoveryBatchSize:
                      parseInt(event.target.value, 10) || 256,
                  })
                }
              />
              <span className="text-[11px] text-fg-tertiary mt-1 block">
                Files discovered per batch during directory walks.
              </span>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-fg-primary">Debug Mode</p>
              <p className="text-xs text-fg-secondary">
                Enable debug logging and diagnostics.
              </p>
            </div>
            <Toggle
              checked={settings.debug}
              onChange={(value) => updateSettings({ debug: value })}
            />
          </div>
        </div>
      )}
    </Card>
  );
}

export function DiagnosticsSettingsSection({
  diagnosticsSnapshot,
  diagnosticsRefreshing,
  diagnosticsNotice,
  onRefreshDiagnostics,
  onOpenLogsFolder,
  onOpenDataFolder,
  onRestartBackend,
  onCopyDiagnosticReport,
}: DiagnosticsSettingsSectionProps) {
  const backend = diagnosticsSnapshot?.backend;
  const providers = diagnosticsSnapshot?.providers ?? [];
  const selectedProvider =
    providers.find((provider) => provider.selected) ?? null;

  return (
    <Card>
      <div className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-h3 font-medium text-fg-primary">Diagnostics</h2>
            <p className="text-xs text-fg-secondary mt-1">
              Self-service troubleshooting tools for backend health, logs, and a
              redacted support report.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onRefreshDiagnostics()}
            disabled={diagnosticsRefreshing}
          >
            <RefreshCw
              size={13}
              className={diagnosticsRefreshing ? "animate-spin" : ""}
            />
            Refresh
          </Button>
        </div>

        {diagnosticsNotice && (
          <div
            className={`rounded-default border px-3 py-2 text-xs ${
              diagnosticsNotice.kind === "error"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-border bg-bg-secondary text-fg-secondary"
            }`}
          >
            {diagnosticsNotice.message}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-default border border-border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-fg-tertiary">
              Backend
            </p>
            <div className="flex items-center gap-2">
              <Badge variant={backend?.healthy ? "default" : "outline"}>
                {backend?.healthy
                  ? "Healthy"
                  : backend?.running
                    ? "Running (not healthy)"
                    : "Stopped"}
              </Badge>
              {backend?.port ? (
                <span className="text-xs text-fg-secondary">
                  Port {backend.port}
                </span>
              ) : null}
            </div>
            {backend?.error ? (
              <p className="text-xs text-warning">{backend.error}</p>
            ) : (
              <p className="text-xs text-fg-secondary">
                {backend?.healthUrl ?? "Health URL unavailable"}
              </p>
            )}
          </div>

          <div className="rounded-default border border-border p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-fg-tertiary">
              Provider Status
            </p>
            {selectedProvider ? (
              <div className="flex items-center gap-2">
                <Badge variant={selectedProvider.configured ? "default" : "outline"}>
                  {selectedProvider.provider} {selectedProvider.configured ? "configured" : "not configured"}
                </Badge>
              </div>
            ) : (
              <p className="text-xs text-fg-secondary">No provider selected.</p>
            )}
            <div className="space-y-1">
              {providers.map((provider) => (
                <p key={provider.provider} className="text-xs text-fg-secondary">
                  <span className="text-fg-primary">{provider.provider}</span>
                  {provider.selected ? " (selected)" : ""}: {provider.detail}
                </p>
              ))}
            </div>
          </div>
        </div>

        {diagnosticsSnapshot && (
          <div className="rounded-default border border-border bg-bg-secondary/30 p-3 space-y-1">
            <p className="text-xs uppercase tracking-wide text-fg-tertiary">
              Paths & Context
            </p>
            <p className="text-xs text-fg-secondary">
              Data dir: <span className="text-fg-primary">{diagnosticsSnapshot.dataDir}</span>
            </p>
            <p className="text-xs text-fg-secondary">
              Logs dir: <span className="text-fg-primary">{diagnosticsSnapshot.logsDir}</span>
            </p>
            <p className="text-xs text-fg-secondary">
              App: v{diagnosticsSnapshot.appVersion} ({diagnosticsSnapshot.platform}/{diagnosticsSnapshot.arch}) • {diagnosticsSnapshot.isPackaged ? "packaged" : "dev/unpackaged"}
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void onOpenLogsFolder()}>
            <FolderOpen size={13} />
            Open Logs Folder
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onOpenDataFolder()}>
            <FolderOpen size={13} />
            Open Data Folder
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onRefreshDiagnostics()}>
            Test Backend Connection
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onRestartBackend()}>
            Restart Backend
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onCopyDiagnosticReport()}>
            Copy Diagnostic Report
          </Button>
        </div>
      </div>
    </Card>
  );
}

export function UpdatesSettingsSection({
  appVersion,
  updateAvailable,
  updateDownloaded,
  updaterStatus,
  checkingForUpdates,
  onCheckForUpdates,
  onQuitAndInstall,
  onDownloadUpdate,
}: UpdatesSettingsSectionProps) {
  const statusState = updaterStatus?.state ?? "idle";
  const statusMessage = updaterStatus?.message ?? "Updates enabled (stable channel).";
  const isBusy =
    checkingForUpdates || statusState === "checking" || statusState === "downloading";

  const showDownloadProgress =
    statusState === "downloading" &&
    typeof updaterStatus?.percent === "number" &&
    Number.isFinite(updaterStatus.percent);

  return (
    <Card>
      <div className="p-4 space-y-3">
        <h2 className="text-h3 font-medium text-fg-primary">About</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-fg-secondary">momodoc</span>
          <Badge variant="outline">v{appVersion || "unknown"}</Badge>
          <Badge variant="outline">Stable updates</Badge>
        </div>
        <p className="text-xs text-fg-secondary">
          {statusMessage}
          {showDownloadProgress ? ` (${updaterStatus!.percent!.toFixed(0)}%)` : ""}
        </p>
        {statusState === "error" && (
          <div className="flex items-start gap-2 rounded-default border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}
        {statusState === "unsupported" && (
          <div className="flex items-start gap-2 rounded-default border border-border bg-bg-secondary px-3 py-2 text-xs text-fg-secondary">
            <InfoIcon />
            <span>{statusMessage}</span>
          </div>
        )}
        {updateDownloaded ? (
          <div className="flex items-center gap-2">
            <Badge variant="default">Update v{updateDownloaded} ready</Badge>
            <Button variant="primary" size="sm" onClick={onQuitAndInstall}>
              <Download size={13} />
              Install & Restart
            </Button>
          </div>
        ) : updateAvailable ? (
          <div className="flex items-center gap-2">
            <Badge variant="default">
              v{updateAvailable} {showDownloadProgress ? "downloading" : "available"}
            </Badge>
            {!showDownloadProgress && (
              <Button variant="primary" size="sm" onClick={onDownloadUpdate}>
                <Download size={13} />
                Download Update
              </Button>
            )}
          </div>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onCheckForUpdates}
            disabled={isBusy}
          >
            {isBusy ? "Checking..." : "Check for Updates"}
          </Button>
        )}
      </div>
    </Card>
  );
}

function InfoIcon() {
  return <span className="mt-[1px] shrink-0 text-[10px] font-semibold">i</span>;
}
