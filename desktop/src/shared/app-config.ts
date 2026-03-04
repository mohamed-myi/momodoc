import {
  DEFAULT_ONBOARDING_STATE,
  normalizeOnboardingState,
  type OnboardingState,
} from "./onboarding";

export interface AppWindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export type StartupProfilePreset =
  | "desktop"
  | "desktopOverlay"
  | "desktopWeb"
  | "vscodeCompanion"
  | "custom";

export interface StartupProfileLaunchTargets {
  startBackendOnLaunch: boolean;
  openMainWindowOnLaunch: boolean;
  startMinimizedToTray: boolean;
  openOverlayOnLaunch: boolean;
  openWebUiOnLaunch: boolean;
  openVsCodeOnLaunch: boolean;
  restoreLastSession: boolean;
}

export interface AppConfig {
  // LLM
  llmProvider: string;
  anthropicApiKey: string;
  claudeModel: string;
  openaiApiKey: string;
  openaiModel: string;
  googleApiKey: string;
  geminiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;

  // Server
  port: number;
  host: string;
  dataDir: string;
  maxUploadSizeMb: number;
  logLevel: string;

  // Chunking
  chunkSizeDefault: number;
  chunkOverlapDefault: number;
  chunkSizeCode: number;
  chunkSizePdf: number;
  chunkSizeMarkdown: number;

  // Storage / Indexing
  allowedIndexPaths: string[];
  maxFileSizeMb: number;

  // Rate Limiting
  chatRateLimitEnabled: boolean;
  chatRateLimitClientRequests: number;
  chatStreamRateLimitClientRequests: number;
  chatRateLimitWindowSeconds: number;

  // Retrieval Quality
  vectordbSearchNprobes: number;
  vectordbSearchRefineFactor: number;

  // Embedding
  embeddingModel: string;

  // Concurrency
  syncMaxConcurrentFiles: number;
  syncQueueSize: number;
  indexMaxConcurrentFiles: number;
  indexDiscoveryBatchSize: number;

  // Debug
  debug: boolean;

  // App behavior (Electron-only, not passed to backend)
  autoLaunch: boolean;
  globalHotkey: string;
  showInTray: boolean;
  startupProfilePreset: StartupProfilePreset;
  startupProfileCustom: StartupProfileLaunchTargets;
  onboarding: OnboardingState;
  windowBounds: AppWindowBounds | null;
}

export const DEFAULT_STARTUP_PROFILE_TARGETS: StartupProfileLaunchTargets = {
  startBackendOnLaunch: true,
  openMainWindowOnLaunch: true,
  startMinimizedToTray: false,
  openOverlayOnLaunch: false,
  openWebUiOnLaunch: false,
  openVsCodeOnLaunch: false,
  restoreLastSession: true,
};

export const STARTUP_PROFILE_PRESET_DEFAULTS: Record<
  Exclude<StartupProfilePreset, "custom">,
  StartupProfileLaunchTargets
> = {
  desktop: { ...DEFAULT_STARTUP_PROFILE_TARGETS },
  desktopOverlay: {
    ...DEFAULT_STARTUP_PROFILE_TARGETS,
    openOverlayOnLaunch: true,
  },
  desktopWeb: {
    ...DEFAULT_STARTUP_PROFILE_TARGETS,
    openWebUiOnLaunch: true,
  },
  vscodeCompanion: {
    ...DEFAULT_STARTUP_PROFILE_TARGETS,
    openMainWindowOnLaunch: false,
    startMinimizedToTray: true,
    openVsCodeOnLaunch: true,
  },
};

export function isStartupProfilePreset(value: unknown): value is StartupProfilePreset {
  return (
    value === "desktop" ||
    value === "desktopOverlay" ||
    value === "desktopWeb" ||
    value === "vscodeCompanion" ||
    value === "custom"
  );
}

export function normalizeStartupProfileTargets(
  value: Partial<StartupProfileLaunchTargets> | null | undefined
): StartupProfileLaunchTargets {
  return {
    startBackendOnLaunch:
      value?.startBackendOnLaunch ?? DEFAULT_STARTUP_PROFILE_TARGETS.startBackendOnLaunch,
    openMainWindowOnLaunch:
      value?.openMainWindowOnLaunch ?? DEFAULT_STARTUP_PROFILE_TARGETS.openMainWindowOnLaunch,
    startMinimizedToTray:
      value?.startMinimizedToTray ?? DEFAULT_STARTUP_PROFILE_TARGETS.startMinimizedToTray,
    openOverlayOnLaunch:
      value?.openOverlayOnLaunch ?? DEFAULT_STARTUP_PROFILE_TARGETS.openOverlayOnLaunch,
    openWebUiOnLaunch:
      value?.openWebUiOnLaunch ?? DEFAULT_STARTUP_PROFILE_TARGETS.openWebUiOnLaunch,
    openVsCodeOnLaunch:
      value?.openVsCodeOnLaunch ?? DEFAULT_STARTUP_PROFILE_TARGETS.openVsCodeOnLaunch,
    restoreLastSession:
      value?.restoreLastSession ?? DEFAULT_STARTUP_PROFILE_TARGETS.restoreLastSession,
  };
}

export function resolveStartupProfileTargets(config: Pick<AppConfig, "startupProfilePreset" | "startupProfileCustom">): StartupProfileLaunchTargets {
  if (config.startupProfilePreset === "custom") {
    return normalizeStartupProfileTargets(config.startupProfileCustom);
  }
  return { ...STARTUP_PROFILE_PRESET_DEFAULTS[config.startupProfilePreset] };
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  // LLM
  llmProvider: "claude",
  anthropicApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  openaiApiKey: "",
  openaiModel: "gpt-4o",
  googleApiKey: "",
  geminiModel: "gemini-2.5-flash",
  ollamaBaseUrl: "http://localhost:11434/v1",
  ollamaModel: "qwen2.5-coder:7b",

  // Server
  port: 8000,
  host: "127.0.0.1",
  dataDir: "",
  maxUploadSizeMb: 100,
  logLevel: "INFO",

  // Chunking
  chunkSizeDefault: 2000,
  chunkOverlapDefault: 200,
  chunkSizeCode: 2000,
  chunkSizePdf: 3000,
  chunkSizeMarkdown: 2000,

  // Storage / Indexing
  allowedIndexPaths: [],
  maxFileSizeMb: 200,

  // Rate Limiting
  chatRateLimitEnabled: true,
  chatRateLimitClientRequests: 30,
  chatStreamRateLimitClientRequests: 15,
  chatRateLimitWindowSeconds: 60,

  // Retrieval Quality
  vectordbSearchNprobes: 24,
  vectordbSearchRefineFactor: 2,

  // Embedding
  embeddingModel: "all-MiniLM-L6-v2",

  // Concurrency
  syncMaxConcurrentFiles: 4,
  syncQueueSize: 64,
  indexMaxConcurrentFiles: 4,
  indexDiscoveryBatchSize: 256,

  // Debug
  debug: false,

  // App behavior
  autoLaunch: false,
  globalHotkey: "CommandOrControl+Shift+Space",
  showInTray: true,
  startupProfilePreset: "desktop",
  startupProfileCustom: { ...DEFAULT_STARTUP_PROFILE_TARGETS },
  onboarding: { ...DEFAULT_ONBOARDING_STATE, draft: { ...DEFAULT_ONBOARDING_STATE.draft } },
  windowBounds: null,
};

export function normalizeAppConfig(
  value: Partial<AppConfig> | null | undefined
): AppConfig {
  const raw = value ?? {};
  const preset = isStartupProfilePreset(raw.startupProfilePreset)
    ? raw.startupProfilePreset
    : DEFAULT_APP_CONFIG.startupProfilePreset;

  return {
    ...DEFAULT_APP_CONFIG,
    ...raw,
    startupProfilePreset: preset,
    startupProfileCustom: normalizeStartupProfileTargets(raw.startupProfileCustom),
    onboarding: normalizeOnboardingState(raw.onboarding),
  };
}
