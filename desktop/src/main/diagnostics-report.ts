import type { AppConfig } from "../shared/app-config";
import type {
  DiagnosticsSnapshot,
  ProviderDiagnosticsStatus,
} from "../shared/diagnostics";

export interface RedactedSettingsSummary {
  llmProvider: string;
  claudeModel: string;
  openaiModel: string;
  geminiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  dataDirOverride: string;
  allowedIndexPathsCount: number;
  debug: boolean;
}

function secretSummary(value: string): string {
  return value.trim() ? "[REDACTED] (set)" : "(not set)";
}

export function buildProviderDiagnosticsStatuses(
  config: AppConfig
): ProviderDiagnosticsStatus[] {
  return [
    {
      provider: "claude",
      selected: config.llmProvider === "claude",
      configured: Boolean(config.anthropicApiKey.trim()),
      detail: config.anthropicApiKey.trim()
        ? `Configured (model: ${config.claudeModel || "default"})`
        : "Missing Anthropic API key",
    },
    {
      provider: "openai",
      selected: config.llmProvider === "openai",
      configured: Boolean(config.openaiApiKey.trim()),
      detail: config.openaiApiKey.trim()
        ? `Configured (model: ${config.openaiModel || "default"})`
        : "Missing OpenAI API key",
    },
    {
      provider: "gemini",
      selected: config.llmProvider === "gemini",
      configured: Boolean(config.googleApiKey.trim()),
      detail: config.googleApiKey.trim()
        ? `Configured (model: ${config.geminiModel || "default"})`
        : "Missing Google API key",
    },
    {
      provider: "ollama",
      selected: config.llmProvider === "ollama",
      configured: Boolean(config.ollamaBaseUrl.trim() && config.ollamaModel.trim()),
      detail:
        config.ollamaBaseUrl.trim() && config.ollamaModel.trim()
          ? `Configured (${config.ollamaModel} @ ${config.ollamaBaseUrl})`
          : "Missing Ollama base URL or model",
    },
  ];
}

export function buildRedactedSettingsSummary(
  config: AppConfig
): RedactedSettingsSummary {
  return {
    llmProvider: config.llmProvider,
    claudeModel: config.claudeModel,
    openaiModel: config.openaiModel,
    geminiModel: config.geminiModel,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaModel: config.ollamaModel,
    anthropicApiKey: secretSummary(config.anthropicApiKey),
    openaiApiKey: secretSummary(config.openaiApiKey),
    googleApiKey: secretSummary(config.googleApiKey),
    dataDirOverride: config.dataDir || "(default)",
    allowedIndexPathsCount: Array.isArray(config.allowedIndexPaths)
      ? config.allowedIndexPaths.length
      : 0,
    debug: Boolean(config.debug),
  };
}

export function formatDiagnosticsReport(
  snapshot: DiagnosticsSnapshot,
  redactedSettings: RedactedSettingsSummary
): string {
  const providerLines = snapshot.providers.map((provider) => {
    const selected = provider.selected ? " (selected)" : "";
    const configured = provider.configured ? "configured" : "not configured";
    return `- ${provider.provider}${selected}: ${configured} — ${provider.detail}`;
  });

  const backendSummary = snapshot.backend.healthy
    ? `healthy (running=${snapshot.backend.running}, port=${snapshot.backend.port ?? "n/a"})`
    : `unhealthy (running=${snapshot.backend.running}, port=${snapshot.backend.port ?? "n/a"}, error=${snapshot.backend.error ?? "n/a"})`;

  return [
    "Momodoc Diagnostic Report (redacted)",
    `Generated: ${snapshot.generatedAt}`,
    "",
    "App",
    `- Version: ${snapshot.appVersion}`,
    `- Platform: ${snapshot.platform}`,
    `- Architecture: ${snapshot.arch}`,
    `- Packaged build: ${snapshot.isPackaged ? "yes" : "no"}`,
    "",
    "Paths",
    `- Data dir: ${snapshot.dataDir}`,
    `- Logs dir: ${snapshot.logsDir}`,
    "",
    "Backend",
    `- Status: ${backendSummary}`,
    `- Health URL: ${snapshot.backend.healthUrl ?? "n/a"}`,
    "",
    "Providers (non-secret config summary)",
    ...providerLines,
    "",
    "Redacted settings summary",
    `- llmProvider: ${redactedSettings.llmProvider}`,
    `- claudeModel: ${redactedSettings.claudeModel}`,
    `- openaiModel: ${redactedSettings.openaiModel}`,
    `- geminiModel: ${redactedSettings.geminiModel}`,
    `- ollamaBaseUrl: ${redactedSettings.ollamaBaseUrl}`,
    `- ollamaModel: ${redactedSettings.ollamaModel}`,
    `- anthropicApiKey: ${redactedSettings.anthropicApiKey}`,
    `- openaiApiKey: ${redactedSettings.openaiApiKey}`,
    `- googleApiKey: ${redactedSettings.googleApiKey}`,
    `- dataDir override: ${redactedSettings.dataDirOverride}`,
    `- allowedIndexPaths count: ${redactedSettings.allowedIndexPathsCount}`,
    `- debug: ${redactedSettings.debug ? "true" : "false"}`,
    "",
    "Note: Secrets (API keys/tokens) are redacted by design.",
    "",
  ].join("\n");
}
