import { describe, it, expect } from "vitest";

import { DEFAULT_APP_CONFIG, type AppConfig } from "../../src/shared/app-config";
import { resolveEffectiveStartupProfile } from "../../src/main/startup-profile-runtime";

function baseConfig(): Pick<
  AppConfig,
  "startupProfilePreset" | "startupProfileCustom" | "showInTray"
> {
  return {
    startupProfilePreset: DEFAULT_APP_CONFIG.startupProfilePreset,
    startupProfileCustom: { ...DEFAULT_APP_CONFIG.startupProfileCustom },
    showInTray: DEFAULT_APP_CONFIG.showInTray,
  };
}

describe("Startup Profile Runtime", () => {
  it("startMinimizedToTray disables visible main window startup", () => {
    const result = resolveEffectiveStartupProfile({
      ...baseConfig(),
      startupProfilePreset: "custom",
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        startMinimizedToTray: true,
        openMainWindowOnLaunch: true,
      },
    });

    expect(result.targets.startMinimizedToTray).toBe(true);
    expect(result.targets.openMainWindowOnLaunch).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("minimized-to-tray falls back to visible window when tray is disabled", () => {
    const result = resolveEffectiveStartupProfile({
      ...baseConfig(),
      showInTray: false,
      startupProfilePreset: "custom",
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        startMinimizedToTray: true,
        openMainWindowOnLaunch: false,
      },
    });

    expect(result.targets.startMinimizedToTray).toBe(false);
    expect(result.targets.openMainWindowOnLaunch).toBe(true);
    expect(result.warnings.length).toBe(1);
  });

  it("invisible custom startup profile gets safety fallback to main window", () => {
    const result = resolveEffectiveStartupProfile({
      ...baseConfig(),
      showInTray: false,
      startupProfilePreset: "custom",
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        openMainWindowOnLaunch: false,
        startMinimizedToTray: false,
        openOverlayOnLaunch: false,
        openWebUiOnLaunch: false,
        openVsCodeOnLaunch: false,
      },
    });

    expect(result.targets.openMainWindowOnLaunch).toBe(true);
    expect(
      result.warnings.some((warning) => warning.includes("no visible surfaces"))
    ).toBe(true);
  });
});
