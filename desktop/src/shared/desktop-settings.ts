import type { AppConfig } from "./app-config";

export type DesktopSettings = Omit<AppConfig, "windowBounds">;
export type DesktopSettingsKey = keyof DesktopSettings;

// LLM settings (provider, API keys, models) no longer require a backend
// restart; they are hot-reloaded via PUT /api/v1/settings.
export const DESKTOP_BACKEND_RESTART_KEYS = [
  "port",
  "host",
  "dataDir",
  "maxUploadSizeMb",
  "logLevel",
  "chunkSizeDefault",
  "chunkOverlapDefault",
  "chunkSizeCode",
  "chunkSizePdf",
  "chunkSizeMarkdown",
  "allowedIndexPaths",
  "maxFileSizeMb",
  "chatRateLimitEnabled",
  "chatRateLimitClientRequests",
  "chatStreamRateLimitClientRequests",
  "chatRateLimitWindowSeconds",
  "vectordbSearchNprobes",
  "vectordbSearchRefineFactor",
  "embeddingModel",
  "syncMaxConcurrentFiles",
  "syncQueueSize",
  "indexMaxConcurrentFiles",
  "indexDiscoveryBatchSize",
  "debug",
] as const satisfies readonly DesktopSettingsKey[];

const DESKTOP_BACKEND_RESTART_KEY_SET = new Set<DesktopSettingsKey>(
  DESKTOP_BACKEND_RESTART_KEYS,
);

// Electron app/startup behavior settings generally take effect immediately or on
// the next app launch, but do not require a backend restart.
export const DESKTOP_NEXT_LAUNCH_KEYS = [
  "autoLaunch",
  "globalHotkey",
  "showInTray",
  "startupProfilePreset",
  "startupProfileCustom",
] as const satisfies readonly DesktopSettingsKey[];

const DESKTOP_NEXT_LAUNCH_KEY_SET = new Set<DesktopSettingsKey>(
  DESKTOP_NEXT_LAUNCH_KEYS,
);

export function changeRequiresBackendRestart(
  partial: Partial<DesktopSettings>,
): boolean {
  return Object.keys(partial).some((key) =>
    DESKTOP_BACKEND_RESTART_KEY_SET.has(key as DesktopSettingsKey),
  );
}

export function changeTakesEffectOnNextLaunch(
  partial: Partial<DesktopSettings>,
): boolean {
  return Object.keys(partial).some((key) =>
    DESKTOP_NEXT_LAUNCH_KEY_SET.has(key as DesktopSettingsKey),
  );
}
