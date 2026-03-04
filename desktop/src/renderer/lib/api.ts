import { createRendererApiClient } from "../../../../frontend/src/shared/renderer/lib/apiClientCore";
import type {
  ChatMetrics,
  MetricsOverview,
  ProjectMetric,
  StorageMetrics,
  SyncMetrics,
} from "./metrics-types";

// Dynamic backend URL and token from Electron main process
let _baseUrl: string | null = null;
let _token: string | null = null;
let _initPromise: Promise<void> | null = null;

async function init(): Promise<void> {
  if (window.momodoc) {
    _baseUrl = await window.momodoc.getBackendUrl();
    _token = await window.momodoc.getToken();
    return;
  }

  // Fallback for web dev (same-origin)
  _baseUrl = "";
  const res = await fetch("/api/v1/token");
  if (res.ok) {
    const data = await res.json();
    _token = data.token;
  }
}

async function ensureInit(): Promise<void> {
  if (_baseUrl !== null && _token !== null) return;
  if (!_initPromise) {
    _initPromise = init().catch((err) => {
      _initPromise = null;
      throw err;
    });
  }
  return _initPromise;
}

/**
 * Reset cached base URL and token (call on backend restart).
 */
export function resetApiClient(): void {
  _baseUrl = null;
  _token = null;
  _initPromise = null;
}

// Listen for backend-ready events to reset the cache
if (typeof window !== "undefined" && window.momodoc) {
  window.momodoc.onBackendReady(() => {
    resetApiClient();
  });
}

async function getBaseUrl(): Promise<string> {
  await ensureInit();
  return _baseUrl!;
}

async function getToken(): Promise<string> {
  await ensureInit();
  return _token!;
}

const { api: sharedApi, request } = createRendererApiClient({
  getBaseUrl,
  getToken,
});

export const api = {
  ...sharedApi,

  // Metrics (desktop-only)
  getMetricsOverview: () => request<MetricsOverview>("/api/v1/metrics/overview"),
  getProjectMetrics: () => request<ProjectMetric[]>("/api/v1/metrics/projects"),
  getChatMetrics: (days?: number) => {
    const params = days ? `?days=${days}` : "";
    return request<ChatMetrics>(`/api/v1/metrics/chat${params}`);
  },
  getStorageMetrics: () => request<StorageMetrics>("/api/v1/metrics/storage"),
  getSyncMetrics: (days?: number) => {
    const params = days ? `?days=${days}` : "";
    return request<SyncMetrics>(`/api/v1/metrics/sync${params}`);
  },
};

export { getBaseUrl as getApiBaseUrl, getToken };
