import { createRendererApiClient } from "@/shared/renderer/lib/apiClientCore";

// Same origin in production; configurable for split frontend/backend dev and E2E.
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/$/, "");

// Session token (fetched once from the localhost-only /api/v1/token endpoint)
let _token: string | null = null;
let _tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/token`);
  if (!res.ok) throw new Error("Failed to fetch session token");
  const data = await res.json();
  return data.token;
}

async function getToken(): Promise<string> {
  if (_token) return _token;
  if (!_tokenPromise) {
    _tokenPromise = fetchToken()
      .then((token) => {
        _token = token;
        return token;
      })
      .catch((err) => {
        // Clear so next call retries instead of returning the rejected promise forever
        _tokenPromise = null;
        throw err;
      });
  }
  return _tokenPromise;
}

async function getApiBaseUrl(): Promise<string> {
  return API_BASE;
}

const { api } = createRendererApiClient({
  getBaseUrl: getApiBaseUrl,
  getToken,
});

export { api, API_BASE, getApiBaseUrl, getToken };
