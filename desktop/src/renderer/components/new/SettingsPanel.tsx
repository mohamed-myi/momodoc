import { Info, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import {
  AdvancedSettingsSection,
  AppSettingsSection,
  ChunkingSettingsSection,
  DiagnosticsSettingsSection,
  IndexingSettingsSection,
  LlmSettingsSection,
  RateLimitSettingsSection,
  RetrievalSettingsSection,
  ServerSettingsSection,
  StartupLaunchSettingsSection,
  UpdatesSettingsSection,
} from "./settings/SettingsPanelSections";
import { useDesktopSettings } from "./settings/useDesktopSettings";

export function SettingsPanel() {
  const {
    settings,
    loading,
    saving,
    restartNeeded,
    restarting,
    updateAvailable,
    updateDownloaded,
    updaterStatus,
    checkingForUpdates,
    diagnosticsSnapshot,
    diagnosticsRefreshing,
    diagnosticsNotice,
    updateSettings,
    restartBackend,
    selectDataDirectory,
    selectDirectories,
    refreshDiagnostics,
    openLogsFolder,
    openDataFolder,
    copyDiagnosticReport,
    checkForUpdates,
    quitAndInstall,
  } = useDesktopSettings();

  if (loading || !settings) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container-dashboard py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-semibold text-fg-primary">Settings</h1>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-fg-secondary">Saving...</span>}
          {restartNeeded && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void restartBackend()}
              disabled={restarting}
            >
              {restarting ? (
                <>
                  <RefreshCw size={13} className="animate-spin" />
                  Restarting...
                </>
              ) : (
                <>
                  <RefreshCw size={13} />
                  Restart Backend
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {restartNeeded && (
        <div className="flex items-center gap-2 px-3 py-2 bg-warning/10 border border-warning/20 rounded-default text-sm text-warning">
          <Info size={14} />
          Some changes require a backend restart to take effect.
        </div>
      )}

      <LlmSettingsSection />
      <ServerSettingsSection
        settings={settings}
        updateSettings={updateSettings}
        onSelectDirectory={selectDataDirectory}
      />
      <IndexingSettingsSection
        settings={settings}
        updateSettings={updateSettings}
        onSelectDirectories={selectDirectories}
      />
      <RateLimitSettingsSection settings={settings} updateSettings={updateSettings} />
      <ChunkingSettingsSection settings={settings} updateSettings={updateSettings} />
      <RetrievalSettingsSection settings={settings} updateSettings={updateSettings} />
      <AdvancedSettingsSection settings={settings} updateSettings={updateSettings} />
      <StartupLaunchSettingsSection
        settings={settings}
        updateSettings={updateSettings}
      />
      <AppSettingsSection settings={settings} updateSettings={updateSettings} />
      <DiagnosticsSettingsSection
        diagnosticsSnapshot={diagnosticsSnapshot}
        diagnosticsRefreshing={diagnosticsRefreshing}
        diagnosticsNotice={diagnosticsNotice}
        onRefreshDiagnostics={refreshDiagnostics}
        onOpenLogsFolder={openLogsFolder}
        onOpenDataFolder={openDataFolder}
        onRestartBackend={restartBackend}
        onCopyDiagnosticReport={copyDiagnosticReport}
      />
      <UpdatesSettingsSection
        appVersion={diagnosticsSnapshot?.appVersion ?? null}
        updateAvailable={updateAvailable}
        updateDownloaded={updateDownloaded}
        updaterStatus={updaterStatus}
        checkingForUpdates={checkingForUpdates}
        onCheckForUpdates={checkForUpdates}
        onQuitAndInstall={quitAndInstall}
      />
    </div>
  );
}
