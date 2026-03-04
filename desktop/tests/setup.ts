import '@testing-library/jest-dom'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { server } from './utils/mockApi/server'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())

// Mock crypto.randomUUID
if (!global.crypto) {
  global.crypto = {} as Crypto
}
global.crypto.randomUUID = (() => '00000000-0000-0000-0000-000000000000') as typeof crypto.randomUUID

// Mock localStorage
const localStorageMock = {
  store: {} as Record<string, string>,
  getItem(key: string) { return this.store[key] || null },
  setItem(key: string, value: string) { this.store[key] = value },
  removeItem(key: string) { delete this.store[key] },
  clear() { this.store = {} }
}
global.localStorage = localStorageMock as any
global.sessionStorage = localStorageMock as any

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// Mock IPC bridge (window.momodoc)
global.window.momodoc = {
  backend: {
    getUrl: vi.fn().mockResolvedValue('http://localhost:8000'),
    getToken: vi.fn().mockResolvedValue('test-token-123'),
  },
  settings: {
    get: vi.fn().mockResolvedValue({
      port: 8000,
      dataDir: '/tmp/momodoc-test',
      logLevel: 'INFO',
      llmProvider: 'claude',
      anthropicApiKey: '',
      openaiApiKey: '',
      googleApiKey: '',
      ollamaBaseUrl: 'http://localhost:11434',
      embeddingModel: 'all-MiniLM-L6-v2',
      chunkSizeMarkdown: 1000,
      chunkSizeCode: 1500,
      chunkOverlapDefault: 200,
      autoLaunch: false,
      showInTray: true,
      globalHotkey: 'CommandOrControl+Shift+K',
      startupProfilePreset: 'desktop',
      startupProfileCustom: {
        startBackendOnLaunch: true,
        openMainWindowOnLaunch: true,
        openOverlayOnLaunch: false,
        openWebUiOnLaunch: false,
        openVsCodeOnLaunch: false,
        startMinimizedToTray: false,
        restoreLastSession: true,
      },
      onboarding: {
        status: 'not_started',
        currentStep: 0,
        draft: {
          aiMode: 'searchOnly',
          firstProjectName: '',
          firstProjectSourceDir: '',
          createdProjectId: '',
          createdProjectName: '',
        },
      },
    }),
    update: vi.fn().mockResolvedValue(undefined),
  },
  onBackendReady: vi.fn(),
  onOverlayExpanded: vi.fn(),
  expandOverlay: vi.fn(),
  getDiagnosticsSnapshot: vi.fn().mockResolvedValue({
    generatedAt: new Date().toISOString(),
    appVersion: '0.1.0',
    platform: process.platform,
    arch: process.arch,
    isPackaged: false,
    dataDir: '/tmp/momodoc-test',
    logsDir: '/tmp/momodoc-test',
    selectedProvider: 'claude',
    backend: {
      running: true,
      port: 8000,
      healthy: true,
      healthUrl: 'http://localhost:8000/api/v1/health',
      error: null,
    },
    providers: {
      claude: { configured: false },
      openai: { configured: false },
      gemini: { configured: false },
      ollama: { configured: false, reachable: false },
    },
  }),
  openDataFolder: vi.fn(),
  getBackendStatus: vi.fn().mockResolvedValue({
    status: 'running',
    port: 8000,
    healthy: true
  }),
  restartBackend: vi.fn().mockResolvedValue(undefined),
  openExternal: vi.fn().mockResolvedValue(undefined),
} as any
