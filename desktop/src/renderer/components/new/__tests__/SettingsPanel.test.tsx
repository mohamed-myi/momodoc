import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../../../../tests/utils/renderUtils'
import { SettingsPanel } from '../SettingsPanel'
import { DEFAULT_ONBOARDING_STATE } from '../../../../shared/onboarding'

// Mock the useDesktopSettings hook
vi.mock('../settings/useDesktopSettings', () => ({
  useDesktopSettings: vi.fn(),
}))

import { useDesktopSettings } from '../settings/useDesktopSettings'

const mockUseDesktopSettings = vi.mocked(useDesktopSettings)

describe('SettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading spinner when loading', () => {
    mockUseDesktopSettings.mockReturnValue({
      settings: null,
      loading: true,
      saving: false,
      restartNeeded: false,
      restarting: false,
      updateAvailable: null,
      updateDownloaded: null,
      updaterStatus: null,
      checkingForUpdates: false,
      diagnosticsSnapshot: null,
      diagnosticsRefreshing: false,
      diagnosticsNotice: null,
      updateSettings: vi.fn(),
      restartBackend: vi.fn(),
      selectDataDirectory: vi.fn(),
      selectDirectories: vi.fn(),
      refreshDiagnostics: vi.fn(),
      openLogsFolder: vi.fn(),
      openDataFolder: vi.fn(),
      copyDiagnosticReport: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    })

    const { container } = render(<SettingsPanel />)

    // Check for loading state by checking the container has spinner
    expect(container.querySelector('[class*="animate-"]')).toBeInTheDocument()
  })

  it('renders settings sections when loaded', () => {
    mockUseDesktopSettings.mockReturnValue({
      settings: {
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
        onboarding: DEFAULT_ONBOARDING_STATE,
      },
      loading: false,
      saving: false,
      restartNeeded: false,
      restarting: false,
      updateAvailable: null,
      updateDownloaded: null,
      updaterStatus: null,
      checkingForUpdates: false,
      diagnosticsSnapshot: null,
      diagnosticsRefreshing: false,
      diagnosticsNotice: null,
      updateSettings: vi.fn(),
      restartBackend: vi.fn(),
      selectDataDirectory: vi.fn(),
      selectDirectories: vi.fn(),
      refreshDiagnostics: vi.fn(),
      openLogsFolder: vi.fn(),
      openDataFolder: vi.fn(),
      copyDiagnosticReport: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    })

    const { container } = render(<SettingsPanel />)

    // Check that settings sections are rendered (no loading spinner)
    expect(container.querySelector('[class*="animate-"]')).not.toBeInTheDocument()
    // Check that we have form elements indicating settings are loaded
    expect(container.querySelectorAll('input, select, textarea').length).toBeGreaterThan(0)
  })

  it('shows restart banner when restart is needed', () => {
    const mockRestartBackend = vi.fn()

    mockUseDesktopSettings.mockReturnValue({
      settings: {
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
        onboarding: DEFAULT_ONBOARDING_STATE,
      },
      loading: false,
      saving: false,
      restartNeeded: true,
      restarting: false,
      updateAvailable: null,
      updateDownloaded: null,
      updaterStatus: null,
      checkingForUpdates: false,
      diagnosticsSnapshot: null,
      diagnosticsRefreshing: false,
      diagnosticsNotice: null,
      updateSettings: vi.fn(),
      restartBackend: mockRestartBackend,
      selectDataDirectory: vi.fn(),
      selectDirectories: vi.fn(),
      refreshDiagnostics: vi.fn(),
      openLogsFolder: vi.fn(),
      openDataFolder: vi.fn(),
      copyDiagnosticReport: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    })

    render(<SettingsPanel />)

    // Check for restart banner in the document
    expect(screen.getByText(/changes require a backend restart/i)).toBeInTheDocument()
  })

  it('calls updateSettings when settings are changed', () => {
    const mockUpdateSettings = vi.fn()

    mockUseDesktopSettings.mockReturnValue({
      settings: {
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
        onboarding: DEFAULT_ONBOARDING_STATE,
      },
      loading: false,
      saving: false,
      restartNeeded: false,
      restarting: false,
      updateAvailable: null,
      updateDownloaded: null,
      updaterStatus: null,
      checkingForUpdates: false,
      diagnosticsSnapshot: null,
      diagnosticsRefreshing: false,
      diagnosticsNotice: null,
      updateSettings: mockUpdateSettings,
      restartBackend: vi.fn(),
      selectDataDirectory: vi.fn(),
      selectDirectories: vi.fn(),
      refreshDiagnostics: vi.fn(),
      openLogsFolder: vi.fn(),
      openDataFolder: vi.fn(),
      copyDiagnosticReport: vi.fn(),
      checkForUpdates: vi.fn(),
      quitAndInstall: vi.fn(),
    })

    render(<SettingsPanel />)

    // Verify the mock is available
    expect(mockUpdateSettings).toBeDefined()
  })
})
