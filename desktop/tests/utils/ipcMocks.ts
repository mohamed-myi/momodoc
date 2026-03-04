import { vi } from 'vitest'

export const mockIPC = {
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
      chunkOverlap: 200,
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
}

export function resetMockIPC() {
  Object.values(mockIPC).forEach(category => {
    if (typeof category === 'object') {
      Object.values(category).forEach(fn => {
        if (vi.isMockFunction(fn)) {
          fn.mockClear()
        }
      })
    } else if (vi.isMockFunction(category)) {
      category.mockClear()
    }
  })
}
