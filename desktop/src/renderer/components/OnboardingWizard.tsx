import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  LifeBuoy,
  Rocket,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Toggle } from "./ui/toggle";
import { Badge } from "./ui/badge";
import type { DesktopSettings } from "../../shared/desktop-settings";
import type { StartupProfilePreset } from "../../shared/app-config";
import {
  ONBOARDING_STEPS,
  completeOnboarding,
  setOnboardingStep,
  skipOnboarding,
  updateOnboardingDraft,
  type OnboardingAiMode,
  type OnboardingState,
} from "../../shared/onboarding";

interface OnboardingWizardProps {
  settings: DesktopSettings;
  onUpdateSettings: (partial: Partial<DesktopSettings>) => Promise<void> | void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  onOpenOverlay: () => Promise<void> | void;
  onOpenProject: (projectId: string, projectName?: string) => void;
}

const STEP_TITLES = [
  "Welcome",
  "Folders",
  "AI Mode",
  "Startup",
  "First Project",
  "Finish",
] as const;

const STARTUP_PROFILE_OPTIONS: Array<{
  value: StartupProfilePreset;
  label: string;
  description: string;
}> = [
  {
    value: "desktop",
    label: "Desktop",
    description: "Open the desktop app window on launch.",
  },
  {
    value: "desktopOverlay",
    label: "Desktop + Overlay",
    description: "Open the desktop app and overlay together.",
  },
  {
    value: "desktopWeb",
    label: "Desktop + Web",
    description: "Open the desktop app and the web UI in your browser.",
  },
  {
    value: "vscodeCompanion",
    label: "VS Code Companion",
    description: "Start in tray and optionally open VS Code.",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Fine-tune startup targets later in Settings.",
  },
];

const AI_MODE_OPTIONS: Array<{
  value: OnboardingAiMode;
  label: string;
  description: string;
  helper: string;
}> = [
  {
    value: "searchOnly",
    label: "Search only",
    description: "Start without AI keys and use semantic search immediately.",
    helper: "You can enable an AI provider later in Settings.",
  },
  {
    value: "localOllama",
    label: "Local (Ollama)",
    description: "Use a local model via Ollama.",
    helper: "Best if you already have Ollama running.",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Use Claude with an API key.",
    helper: "Key is configured later in Settings if you do not have one yet.",
  },
  {
    value: "openai",
    label: "OpenAI",
    description: "Use OpenAI with an API key.",
    helper: "Key is configured later in Settings if you do not have one yet.",
  },
  {
    value: "google",
    label: "Google",
    description: "Use Gemini with an API key.",
    helper: "Key is configured later in Settings if you do not have one yet.",
  },
];

function applyAiModeToSettings(aiMode: OnboardingAiMode): Partial<DesktopSettings> {
  switch (aiMode) {
    case "localOllama":
      return { llmProvider: "ollama" };
    case "anthropic":
      return { llmProvider: "claude" };
    case "openai":
      return { llmProvider: "openai" };
    case "google":
      return { llmProvider: "google" };
    case "searchOnly":
    default:
      return {};
  }
}

function configuredKeyHint(settings: DesktopSettings, aiMode: OnboardingAiMode): string {
  switch (aiMode) {
    case "anthropic":
      return settings.anthropicApiKey ? "API key already configured" : "API key not set yet";
    case "openai":
      return settings.openaiApiKey ? "API key already configured" : "API key not set yet";
    case "google":
      return settings.googleApiKey ? "API key already configured" : "API key not set yet";
    case "localOllama":
      return `Endpoint: ${settings.ollamaBaseUrl}`;
    case "searchOnly":
    default:
      return "No provider setup required for search-only mode";
  }
}

function onboardingProgressPercent(stepIndex: number): number {
  if (ONBOARDING_STEPS.length <= 1) return 100;
  return Math.round((stepIndex / (ONBOARDING_STEPS.length - 1)) * 100);
}

function cloneOnboarding(state: OnboardingState): OnboardingState {
  return {
    ...state,
    draft: { ...state.draft },
  };
}

export function OnboardingWizard({
  settings,
  onUpdateSettings,
  onOpenSettings,
  onOpenDiagnostics,
  onOpenOverlay,
  onOpenProject,
}: OnboardingWizardProps) {
  const onboarding = settings.onboarding;
  const stepIndex = Math.max(0, Math.min(onboarding.currentStep, ONBOARDING_STEPS.length - 1));
  const progressPercent = onboardingProgressPercent(stepIndex);
  const stepKey = ONBOARDING_STEPS[stepIndex];

  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(
    null
  );
  const [working, setWorking] = useState(false);
  const [draftProjectName, setDraftProjectName] = useState(onboarding.draft.firstProjectName);
  const [draftProjectSourceDir, setDraftProjectSourceDir] = useState(
    onboarding.draft.firstProjectSourceDir
  );

  useEffect(() => {
    setDraftProjectName(onboarding.draft.firstProjectName);
    setDraftProjectSourceDir(onboarding.draft.firstProjectSourceDir);
  }, [onboarding.draft.firstProjectName, onboarding.draft.firstProjectSourceDir]);

  const selectedAiMode = onboarding.draft.aiMode;
  const selectedStartupPreset = settings.startupProfilePreset;

  const startupPresetInfo = useMemo(
    () =>
      STARTUP_PROFILE_OPTIONS.find((option) => option.value === selectedStartupPreset) ??
      STARTUP_PROFILE_OPTIONS[0],
    [selectedStartupPreset]
  );

  const persistOnboarding = async (
    nextOnboarding: OnboardingState,
    extra: Partial<DesktopSettings> = {}
  ) => {
    await onUpdateSettings({
      ...extra,
      onboarding: cloneOnboarding(nextOnboarding),
    });
  };

  const goToStep = async (nextStep: number) => {
    setNotice(null);
    await persistOnboarding(setOnboardingStep(onboarding, nextStep));
  };

  const handleSkip = async () => {
    setNotice(null);
    await persistOnboarding(skipOnboarding(onboarding));
  };

  const handleSelectFolders = async () => {
    if (!window.momodoc) return;
    const picked = await window.momodoc.selectDirectories();
    if (!picked || picked.length === 0) return;
    const merged = Array.from(new Set([...(settings.allowedIndexPaths ?? []), ...picked]));
    await persistOnboarding(onboarding, { allowedIndexPaths: merged });
    setNotice({
      kind: "success",
      message: `${picked.length} folder${picked.length === 1 ? "" : "s"} added to allowed paths.`,
    });
  };

  const removeAllowedFolder = async (pathToRemove: string) => {
    const nextPaths = (settings.allowedIndexPaths ?? []).filter((entry) => entry !== pathToRemove);
    await persistOnboarding(onboarding, { allowedIndexPaths: nextPaths });
  };

  const handleAiModeSelect = async (aiMode: OnboardingAiMode) => {
    const next = updateOnboardingDraft(onboarding, { aiMode });
    await persistOnboarding(next, applyAiModeToSettings(aiMode));
  };

  const handleStartupPresetChange = async (preset: StartupProfilePreset) => {
    await persistOnboarding(onboarding, { startupProfilePreset: preset });
  };

  const persistProjectDraft = async () => {
    const next = updateOnboardingDraft(onboarding, {
      firstProjectName: draftProjectName,
      firstProjectSourceDir: draftProjectSourceDir,
    });
    await persistOnboarding(next);
  };

  const chooseProjectFolder = async () => {
    if (!window.momodoc) return;
    const dir = await window.momodoc.selectDirectory();
    if (!dir) return;
    setDraftProjectSourceDir(dir);
    if (!draftProjectName.trim()) {
      const nameFromPath = dir.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
      setDraftProjectName(nameFromPath);
    }
  };

  const createFirstProject = async () => {
    if (working) return;
    setNotice(null);
    const name = draftProjectName.trim();
    if (!name) {
      setNotice({ kind: "error", message: "Enter a project name before creating it." });
      return;
    }

    setWorking(true);
    try {
      await persistProjectDraft();
      const created = await api.createProject({
        name,
        source_directory: draftProjectSourceDir.trim() || undefined,
      });
      const next = updateOnboardingDraft(onboarding, {
        firstProjectName: name,
        firstProjectSourceDir: draftProjectSourceDir.trim(),
        createdProjectId: created.id,
        createdProjectName: created.name,
      });
      await persistOnboarding(next);
      setNotice({ kind: "success", message: `Created project “${created.name}”.` });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to create project.",
      });
    } finally {
      setWorking(false);
    }
  };

  const completeSetup = async () => {
    setNotice(null);
    await persistOnboarding(completeOnboarding(onboarding));
  };

  const canGoNext = true;
  const canGoBack = stepIndex > 0;
  const createdProjectId = onboarding.draft.createdProjectId;

  return (
    <div className="absolute inset-0 z-[70] bg-bg-primary/85 backdrop-blur-sm">
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-4xl px-4 py-8">
          <div className="rounded-[var(--radius-default)] border border-border bg-bg-primary shadow-2xl">
            <div className="border-b border-border px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">Setup Wizard</Badge>
                    <span className="text-xs text-fg-secondary">
                      Step {stepIndex + 1} of {ONBOARDING_STEPS.length}
                    </span>
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-fg-primary">
                    {STEP_TITLES[stepIndex]}
                  </h2>
                  <p className="mt-1 text-sm text-fg-secondary">
                    Guided setup for a desktop-first Momodoc experience. You can skip and finish later.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={onOpenDiagnostics}>
                    <LifeBuoy size={13} />
                    Diagnostics
                  </Button>
                  <Button variant="secondary" size="sm" onClick={onOpenSettings}>
                    <Settings size={13} />
                    Settings
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void handleSkip()}>
                    <X size={13} />
                    Skip for now
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <div className="h-2 rounded-full bg-bg-tertiary">
                  <div
                    className="h-2 rounded-full bg-fg-primary transition-all duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="p-5 md:p-6">
              {notice && (
                <div
                  className={`mb-4 rounded-default border px-3 py-2 text-sm ${
                    notice.kind === "error"
                      ? "border-warning/30 bg-warning/10 text-warning"
                      : "border-border bg-bg-secondary text-fg-secondary"
                  }`}
                >
                  {notice.message}
                </div>
              )}

              {stepKey === "welcome" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="rounded-default border border-border p-4 bg-bg-secondary/30">
                      <FolderOpen size={16} className="text-fg-secondary" />
                      <p className="mt-2 text-sm text-fg-primary font-medium">Add folders</p>
                      <p className="mt-1 text-xs text-fg-secondary">
                        Choose which folders Momodoc is allowed to index.
                      </p>
                    </div>
                    <div className="rounded-default border border-border p-4 bg-bg-secondary/30">
                      <Sparkles size={16} className="text-fg-secondary" />
                      <p className="mt-2 text-sm text-fg-primary font-medium">Choose AI mode</p>
                      <p className="mt-1 text-xs text-fg-secondary">
                        Start with search-only, local Ollama, or a cloud provider.
                      </p>
                    </div>
                    <div className="rounded-default border border-border p-4 bg-bg-secondary/30">
                      <Rocket size={16} className="text-fg-secondary" />
                      <p className="mt-2 text-sm text-fg-primary font-medium">Launch your setup</p>
                      <p className="mt-1 text-xs text-fg-secondary">
                        Set startup behavior and optionally create your first project.
                      </p>
                    </div>
                  </div>
                  <div className="rounded-default border border-border bg-bg-secondary/20 p-4">
                    <p className="text-sm text-fg-primary">
                      You can always reopen this wizard from <span className="font-medium">Settings → App Behavior</span>.
                    </p>
                    <p className="text-xs text-fg-secondary mt-1">
                      If you skip now, the app stays usable and you can resume later.
                    </p>
                  </div>
                </div>
              )}

              {stepKey === "folders" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => void handleSelectFolders()}>
                      <FolderOpen size={13} />
                      Add Allowed Folders
                    </Button>
                    <Badge variant={settings.allowedIndexPaths.length > 0 ? "default" : "outline"}>
                      {settings.allowedIndexPaths.length > 0
                        ? `${settings.allowedIndexPaths.length} folder${settings.allowedIndexPaths.length === 1 ? "" : "s"} allowed`
                        : "No folders selected"}
                    </Badge>
                  </div>
                  <p className="text-sm text-fg-secondary">
                    Momodoc can only index folders listed here. If this list is empty, folder sync and directory indexing are blocked.
                  </p>
                  {settings.allowedIndexPaths.length === 0 ? (
                    <div className="rounded-default border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                      No folders are currently allowed. You can continue, but folder indexing will be disabled until you add one.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {settings.allowedIndexPaths.map((entry) => (
                        <div
                          key={entry}
                          className="flex items-center gap-2 rounded-default border border-border bg-bg-secondary/20 px-3 py-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm text-fg-primary">
                            {entry}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void removeAllowedFolder(entry)}
                          >
                            remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {stepKey === "ai" && (
                <div className="space-y-3">
                  <p className="text-sm text-fg-secondary">
                    Pick the simplest AI mode for how you want to start. This uses the same provider settings as the main Settings screen.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {AI_MODE_OPTIONS.map((option) => {
                      const selected = selectedAiMode === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => void handleAiModeSelect(option.value)}
                          className={`text-left rounded-default border p-4 transition-colors ${
                            selected
                              ? "border-fg-primary bg-bg-elevated"
                              : "border-border bg-bg-secondary/20 hover:border-border-strong"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-fg-primary">{option.label}</p>
                            {selected ? <Badge variant="default">Selected</Badge> : null}
                          </div>
                          <p className="mt-1 text-sm text-fg-secondary">{option.description}</p>
                          <p className="mt-2 text-xs text-fg-tertiary">{option.helper}</p>
                          <p className="mt-2 text-xs text-fg-secondary">
                            {configuredKeyHint(settings, option.value)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {stepKey === "startup" && (
                <div className="space-y-4">
                  <p className="text-sm text-fg-secondary">
                    Choose what opens together when Momodoc starts. You can fine-tune individual targets later in Settings.
                  </p>
                  <label className="block">
                    <span className="text-xs text-fg-secondary mb-1 block">Launch Profile</span>
                    <select
                      value={settings.startupProfilePreset}
                      onChange={(event) =>
                        void handleStartupPresetChange(event.target.value as StartupProfilePreset)
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
                  <div className="rounded-default border border-border bg-bg-secondary/20 p-3">
                    <p className="text-sm text-fg-primary font-medium">{startupPresetInfo.label}</p>
                    <p className="text-xs text-fg-secondary mt-1">{startupPresetInfo.description}</p>
                  </div>
                  <div className="space-y-3 rounded-default border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-fg-primary">Auto-launch at login</p>
                        <p className="text-xs text-fg-secondary">Start Momodoc when you sign in.</p>
                      </div>
                      <Toggle
                        checked={settings.autoLaunch}
                        onChange={(value) => void persistOnboarding(onboarding, { autoLaunch: value })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-fg-primary">Show tray icon</p>
                        <p className="text-xs text-fg-secondary">Keep quick access in the system tray.</p>
                      </div>
                      <Toggle
                        checked={settings.showInTray}
                        onChange={(value) => void persistOnboarding(onboarding, { showInTray: value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {stepKey === "project" && (
                <div className="space-y-4">
                  <p className="text-sm text-fg-secondary">
                    Create your first project now (optional). You can skip this step and create one later from the home screen.
                  </p>

                  {onboarding.draft.createdProjectId ? (
                    <div className="rounded-default border border-border bg-bg-secondary/20 p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-fg-secondary" />
                        <p className="text-sm font-medium text-fg-primary">
                          Project ready: {onboarding.draft.createdProjectName || "Untitled"}
                        </p>
                      </div>
                      <p className="text-xs text-fg-secondary mt-2">
                        You can continue to the summary or open this project now.
                      </p>
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            onOpenProject(
                              onboarding.draft.createdProjectId!,
                              onboarding.draft.createdProjectName || undefined
                            )
                          }
                        >
                          Open Project
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="space-y-3 rounded-default border border-border p-4">
                    <label className="block">
                      <span className="text-xs text-fg-secondary mb-1 block">Project name</span>
                      <Input
                        value={draftProjectName}
                        onChange={(event) => setDraftProjectName(event.target.value)}
                        onBlur={() => void persistProjectDraft()}
                        placeholder="My project"
                      />
                    </label>
                    <div>
                      <span className="text-xs text-fg-secondary mb-1 block">Source folder (optional)</span>
                      <div className="flex gap-2">
                        <Input
                          value={draftProjectSourceDir}
                          onChange={(event) => setDraftProjectSourceDir(event.target.value)}
                          onBlur={() => void persistProjectDraft()}
                          placeholder="/path/to/project"
                          className="flex-1"
                        />
                        <Button variant="secondary" size="sm" onClick={() => void chooseProjectFolder()}>
                          <FolderOpen size={13} />
                          Browse
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-fg-tertiary">
                        If provided, Momodoc can start indexing this folder immediately after project creation.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void createFirstProject()}
                        disabled={working || !draftProjectName.trim()}
                      >
                        {working ? "Creating..." : "Create Project"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void persistProjectDraft()}>
                        Save draft
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {stepKey === "summary" && (
                <div className="space-y-4">
                  <div className="rounded-default border border-border bg-bg-secondary/20 p-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-fg-secondary" />
                      <p className="text-sm font-medium text-fg-primary">Setup summary</p>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-default border border-border bg-bg-primary/40 p-3">
                        <p className="text-xs text-fg-tertiary uppercase tracking-wide">Folders</p>
                        <p className="mt-1 text-fg-primary">
                          {settings.allowedIndexPaths.length > 0
                            ? `${settings.allowedIndexPaths.length} allowed folder${settings.allowedIndexPaths.length === 1 ? "" : "s"}`
                            : "None selected yet"}
                        </p>
                      </div>
                      <div className="rounded-default border border-border bg-bg-primary/40 p-3">
                        <p className="text-xs text-fg-tertiary uppercase tracking-wide">AI mode</p>
                        <p className="mt-1 text-fg-primary">
                          {AI_MODE_OPTIONS.find((option) => option.value === selectedAiMode)?.label ??
                            selectedAiMode}
                        </p>
                      </div>
                      <div className="rounded-default border border-border bg-bg-primary/40 p-3">
                        <p className="text-xs text-fg-tertiary uppercase tracking-wide">Startup</p>
                        <p className="mt-1 text-fg-primary">
                          {startupPresetInfo.label}
                          {settings.autoLaunch ? " • Auto-launch on" : " • Auto-launch off"}
                        </p>
                      </div>
                      <div className="rounded-default border border-border bg-bg-primary/40 p-3">
                        <p className="text-xs text-fg-tertiary uppercase tracking-wide">First project</p>
                        <p className="mt-1 text-fg-primary">
                          {onboarding.draft.createdProjectName || "Not created yet"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {createdProjectId ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          onOpenProject(createdProjectId, onboarding.draft.createdProjectName || undefined)
                        }
                      >
                        Open Project
                      </Button>
                    ) : null}
                    <Button variant="secondary" size="sm" onClick={() => void onOpenOverlay()}>
                      Open Overlay
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onOpenDiagnostics}>
                      Open Diagnostics
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onOpenSettings}>
                      Review Settings
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-border px-5 py-4 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-fg-secondary">
                {stepKey === "summary"
                  ? "Finish setup to hide this wizard. You can reopen it from Settings anytime."
                  : "Skip for now keeps the app usable and lets you resume later."}
              </div>
              <div className="flex items-center gap-2">
                {canGoBack ? (
                  <Button variant="ghost" size="sm" onClick={() => void goToStep(stepIndex - 1)}>
                    <ArrowLeft size={13} />
                    Back
                  </Button>
                ) : null}
                {stepKey === "summary" ? (
                  <Button variant="primary" size="sm" onClick={() => void completeSetup()}>
                    <CheckCircle2 size={13} />
                    Finish Setup
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void goToStep(stepIndex + 1)}
                    disabled={!canGoNext}
                  >
                    Next
                    <ArrowRight size={13} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
