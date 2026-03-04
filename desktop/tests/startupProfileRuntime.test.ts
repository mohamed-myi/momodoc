import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_APP_CONFIG, type AppConfig } from "../src/shared/app-config";
import { resolveEffectiveStartupProfile } from "../src/main/startup-profile-runtime";

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

test("startMinimizedToTray disables visible main window startup", () => {
  const result = resolveEffectiveStartupProfile({
    ...baseConfig(),
    startupProfilePreset: "custom",
    startupProfileCustom: {
      ...DEFAULT_APP_CONFIG.startupProfileCustom,
      startMinimizedToTray: true,
      openMainWindowOnLaunch: true,
    },
  });

  assert.equal(result.targets.startMinimizedToTray, true);
  assert.equal(result.targets.openMainWindowOnLaunch, false);
  assert.deepEqual(result.warnings, []);
});

test("minimized-to-tray falls back to visible window when tray is disabled", () => {
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

  assert.equal(result.targets.startMinimizedToTray, false);
  assert.equal(result.targets.openMainWindowOnLaunch, true);
  assert.equal(result.warnings.length, 1);
});

test("invisible custom startup profile gets safety fallback to main window", () => {
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

  assert.equal(result.targets.openMainWindowOnLaunch, true);
  assert.ok(
    result.warnings.some((warning) => warning.includes("no visible surfaces"))
  );
});
