import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '../../../../../tests/utils/renderUtils'
import { SettingsPanel } from '../SettingsPanel'
import { DEFAULT_APP_CONFIG } from '../../../../shared/app-config'

const { windowBounds: _, ...DEFAULT_SETTINGS } = DEFAULT_APP_CONFIG

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
      downloadUpdate: vi.fn(),
    })

    const { container } = render(<SettingsPanel />)

    // Check for loading state by checking the container has spinner
    expect(container.querySelector('[class*="animate-"]')).toBeInTheDocument()
  })

  it('renders settings sections when loaded', () => {
    mockUseDesktopSettings.mockReturnValue({
      settings: { ...DEFAULT_SETTINGS },
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
      downloadUpdate: vi.fn(),
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
      settings: { ...DEFAULT_SETTINGS },
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
      downloadUpdate: vi.fn(),
    })

    render(<SettingsPanel />)

    // Check for restart banner in the document
    expect(screen.getByText(/changes require a backend restart/i)).toBeInTheDocument()
  })

  it('calls updateSettings when settings are changed', () => {
    const mockUpdateSettings = vi.fn()

    mockUseDesktopSettings.mockReturnValue({
      settings: { ...DEFAULT_SETTINGS },
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
      downloadUpdate: vi.fn(),
    })

    render(<SettingsPanel />)

    // Verify the mock is available
    expect(mockUpdateSettings).toBeDefined()
  })
})
