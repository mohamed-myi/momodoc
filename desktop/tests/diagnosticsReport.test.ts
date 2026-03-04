import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_APP_CONFIG } from "../src/shared/app-config";
import type { DiagnosticsSnapshot } from "../src/shared/diagnostics";
import {
  buildProviderDiagnosticsStatuses,
  buildRedactedSettingsSummary,
  formatDiagnosticsReport,
} from "../src/main/diagnostics-report";

test("diagnostic report redacts API keys and includes useful context", () => {
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

  assert.ok(report.includes("Momodoc Diagnostic Report (redacted)"));
  assert.ok(report.includes("Version: 0.1.0"));
  assert.ok(report.includes("Platform: darwin"));
  assert.ok(report.includes("Data dir: /tmp/momodoc-data"));
  assert.ok(report.includes("anthropicApiKey: [REDACTED] (set)"));
  assert.ok(report.includes("openaiApiKey: [REDACTED] (set)"));
  assert.ok(report.includes("googleApiKey: [REDACTED] (set)"));

  assert.ok(!report.includes("sk-ant-secret-value"));
  assert.ok(!report.includes("sk-openai-secret"));
  assert.ok(!report.includes("AIza-secret"));
});
