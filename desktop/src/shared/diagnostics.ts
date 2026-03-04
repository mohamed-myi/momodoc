export interface DiagnosticsActionResult {
  ok: boolean;
  path?: string;
  error?: string | null;
}

export interface ProviderDiagnosticsStatus {
  provider: "claude" | "openai" | "gemini" | "ollama";
  selected: boolean;
  configured: boolean;
  detail: string;
}

export interface BackendDiagnosticsStatus {
  running: boolean;
  port: number | null;
  healthy: boolean;
  healthUrl: string | null;
  error: string | null;
}

export interface DiagnosticsSnapshot {
  generatedAt: string;
  appVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  dataDir: string;
  logsDir: string;
  backend: BackendDiagnosticsStatus;
  providers: ProviderDiagnosticsStatus[];
  selectedProvider: string;
}

export interface CopyDiagnosticReportResult {
  ok: boolean;
  bytes: number;
  error?: string | null;
}
