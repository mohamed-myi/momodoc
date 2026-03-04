import { ipcMain } from "electron";
import { AppConfig } from "../config-store";
import type { IpcDeps } from "./shared";
import { sendToWindow } from "./shared";

export const SETTINGS_IPC_CHANNELS = [
  "get-settings",
  "update-settings",
] as const;

// Allowlist of settings keys the renderer may update.
const ALLOWED_SETTINGS_KEYS = new Set<keyof AppConfig>([
  "llmProvider", "anthropicApiKey", "claudeModel", "openaiApiKey", "openaiModel",
  "googleApiKey", "geminiModel", "ollamaBaseUrl", "ollamaModel",
  "port", "host", "dataDir", "maxUploadSizeMb", "logLevel",
  "chunkSizeDefault", "chunkOverlapDefault", "chunkSizeCode", "chunkSizePdf", "chunkSizeMarkdown",
  "allowedIndexPaths", "maxFileSizeMb",
  "chatRateLimitEnabled", "chatRateLimitClientRequests",
  "chatStreamRateLimitClientRequests", "chatRateLimitWindowSeconds",
  "vectordbSearchNprobes", "vectordbSearchRefineFactor",
  "embeddingModel",
  "syncMaxConcurrentFiles", "syncQueueSize", "indexMaxConcurrentFiles", "indexDiscoveryBatchSize",
  "debug",
  "autoLaunch", "globalHotkey", "showInTray",
  "startupProfilePreset", "startupProfileCustom",
  "onboarding",
]);

function sanitizeSettingsUpdate(partial: Record<string, unknown>): Partial<AppConfig> {
  const sanitized: Partial<AppConfig> = {};
  for (const [key, value] of Object.entries(partial)) {
    if (ALLOWED_SETTINGS_KEYS.has(key as keyof AppConfig) && value !== undefined) {
      (sanitized as Record<string, unknown>)[key] = value;
    }
  }
  return sanitized;
}

export function registerSettingsIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("get-settings", () => {
    return deps.configStore.getAll();
  });

  ipcMain.handle("update-settings", (_event, partial: Record<string, unknown>) => {
    const sanitized = sanitizeSettingsUpdate(partial);
    if (Object.keys(sanitized).length > 0) {
      deps.configStore.update(sanitized);
      sendToWindow(deps.mainWindow, "settings-changed", deps.configStore.getAll());
    }
  });
}
