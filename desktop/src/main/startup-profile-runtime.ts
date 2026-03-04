import {
  resolveStartupProfileTargets,
  type AppConfig,
  type StartupProfileLaunchTargets,
} from "../shared/app-config";

export interface EffectiveStartupProfileResult {
  targets: StartupProfileLaunchTargets;
  warnings: string[];
}

export function resolveEffectiveStartupProfile(
  config: Pick<
    AppConfig,
    "startupProfilePreset" | "startupProfileCustom" | "showInTray"
  >
): EffectiveStartupProfileResult {
  const warnings: string[] = [];
  const targets = {
    ...resolveStartupProfileTargets(config),
  };

  if (targets.startMinimizedToTray) {
    // Minimized-to-tray startup implies the main window should not open visibly.
    if (targets.openMainWindowOnLaunch) {
      targets.openMainWindowOnLaunch = false;
    }

    if (!config.showInTray) {
      targets.startMinimizedToTray = false;
      warnings.push(
        "startMinimizedToTray requested while tray icon is disabled; falling back to visible main window startup."
      );
      targets.openMainWindowOnLaunch = true;
    }
  }

  const hasVisibleSurface =
    targets.openMainWindowOnLaunch ||
    targets.startMinimizedToTray ||
    targets.openOverlayOnLaunch ||
    targets.openWebUiOnLaunch ||
    targets.openVsCodeOnLaunch;

  if (!hasVisibleSurface) {
    warnings.push(
      "Startup profile would open no visible surfaces; enabling main window on launch as a safety fallback."
    );
    targets.openMainWindowOnLaunch = true;
  }

  return { targets, warnings };
}
