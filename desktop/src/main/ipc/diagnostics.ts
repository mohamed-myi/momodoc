import * as fs from "fs";
import { app, clipboard, ipcMain, shell } from "electron";
import type {
  BackendDiagnosticsStatus,
  DiagnosticsActionResult,
  DiagnosticsSnapshot,
  ProviderDiagnosticsStatus,
  CopyDiagnosticReportResult,
} from "../../shared/diagnostics";
import { getDataDir } from "../platform";
import {
  buildProviderDiagnosticsStatuses,
  buildRedactedSettingsSummary,
  formatDiagnosticsReport,
} from "../diagnostics-report";
import type { IpcDeps } from "./shared";

export const DIAGNOSTICS_IPC_CHANNELS = [
  "get-diagnostics-snapshot",
  "open-logs-folder",
  "open-data-folder",
  "test-backend-connection",
  "test-provider-config",
  "copy-diagnostic-report",
] as const;

async function testBackendConnection(deps: IpcDeps): Promise<BackendDiagnosticsStatus> {
  const running = await deps.sidecar.isRunning();
  const port = deps.sidecar.getPort();
  const healthUrl = port ? `http://127.0.0.1:${port}/api/v1/health` : null;

  if (!running) {
    return {
      running: false,
      port,
      healthy: false,
      healthUrl,
      error: "Backend is not running",
    };
  }

  if (!healthUrl) {
    return {
      running: true,
      port,
      healthy: false,
      healthUrl: null,
      error: "Backend port is unavailable",
    };
  }

  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return {
        running: true,
        port,
        healthy: false,
        healthUrl,
        error: `Health endpoint returned ${response.status}`,
      };
    }

    let ready = true;
    try {
      const data = (await response.json()) as { ready?: boolean };
      if (typeof data.ready === "boolean") {
        ready = data.ready;
      }
    } catch {
      // Health endpoint may still be useful even if JSON parsing fails.
    }

    return {
      running: true,
      port,
      healthy: ready,
      healthUrl,
      error: ready ? null : "Health endpoint reported not ready",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      running: true,
      port,
      healthy: false,
      healthUrl,
      error: message,
    };
  }
}

function getProviderConfigStatuses(deps: IpcDeps): ProviderDiagnosticsStatus[] {
  const config = deps.configStore.getAll();
  return buildProviderDiagnosticsStatuses(config);
}

async function buildDiagnosticsSnapshot(deps: IpcDeps): Promise<DiagnosticsSnapshot> {
  const dataDir = getDataDir();
  const backend = await testBackendConnection(deps);
  const providers = getProviderConfigStatuses(deps);
  const config = deps.configStore.getAll();

  return {
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    dataDir,
    logsDir: dataDir,
    backend,
    providers,
    selectedProvider: config.llmProvider,
  };
}

async function openFolder(folderPath: string): Promise<DiagnosticsActionResult> {
  try {
    fs.mkdirSync(folderPath, { recursive: true });
    const errorMessage = await shell.openPath(folderPath);
    if (errorMessage) {
      return { ok: false, path: folderPath, error: errorMessage };
    }
    return { ok: true, path: folderPath, error: null };
  } catch (err) {
    return {
      ok: false,
      path: folderPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerDiagnosticsIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle("get-diagnostics-snapshot", async () => {
    return buildDiagnosticsSnapshot(deps);
  });

  ipcMain.handle("open-logs-folder", async () => {
    return openFolder(getDataDir());
  });

  ipcMain.handle("open-data-folder", async () => {
    return openFolder(getDataDir());
  });

  ipcMain.handle("test-backend-connection", async () => {
    return testBackendConnection(deps);
  });

  ipcMain.handle("test-provider-config", async () => {
    return getProviderConfigStatuses(deps);
  });

  ipcMain.handle("copy-diagnostic-report", async (): Promise<CopyDiagnosticReportResult> => {
    try {
      const snapshot = await buildDiagnosticsSnapshot(deps);
      const config = deps.configStore.getAll();
      const redactedSettings = buildRedactedSettingsSummary(config);
      const report = formatDiagnosticsReport(snapshot, redactedSettings);
      clipboard.writeText(report);
      return { ok: true, bytes: Buffer.byteLength(report, "utf8"), error: null };
    } catch (err) {
      return {
        ok: false,
        bytes: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
