import { describe, it, expect } from "vitest";

import { DEFAULT_APP_CONFIG } from "../../src/shared/app-config";
import type { DiagnosticsSnapshot } from "../../src/shared/diagnostics";
import {
  buildProviderDiagnosticsStatuses,
  buildRedactedSettingsSummary,
  formatDiagnosticsReport,
} from "../../src/main/diagnostics-report";

describe("Diagnostics Report", () => {
  it("diagnostic report redacts API keys and includes useful context", () => {
    const config = {
      ...DEFAULT_APP_CONFIG,
      llmProvider: "claude",
      anthropicApiKey: "sk-ant-secret-value",
      openaiApiKey: "sk-openai-secret",
      googleApiKey: "AIza-secret",
      dataDir: "/tmp/momodoc-data",
    };

    const providers = buildProviderDiagnosticsStatuses(config);
    const redacted = buildRedactedSettingsSummary(config);

    const snapshot: DiagnosticsSnapshot = {
      generatedAt: "2026-02-25T00:00:00.000Z",
      appVersion: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      isPackaged: true,
      dataDir: "/tmp/momodoc-data",
      logsDir: "/tmp/momodoc-data",
      selectedProvider: "claude",
      backend: {
        running: true,
        port: 8000,
        healthy: true,
        healthUrl: "http://127.0.0.1:8000/api/v1/health",
        error: null,
      },
      providers,
    };

    const report = formatDiagnosticsReport(snapshot, redacted);

    expect(report).toContain("Momodoc Diagnostic Report (redacted)");
    expect(report).toContain("Version: 0.1.0");
    expect(report).toContain("Platform: darwin");
    expect(report).toContain("Data dir: /tmp/momodoc-data");
    expect(report).toContain("anthropicApiKey: [REDACTED] (set)");
    expect(report).toContain("openaiApiKey: [REDACTED] (set)");
    expect(report).toContain("googleApiKey: [REDACTED] (set)");

    expect(report).not.toContain("sk-ant-secret-value");
    expect(report).not.toContain("sk-openai-secret");
    expect(report).not.toContain("AIza-secret");
  });
});
