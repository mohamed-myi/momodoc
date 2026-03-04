import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_APP_CONFIG,
  normalizeAppConfig,
  resolveStartupProfileTargets,
  type AppConfig,
} from "../src/shared/app-config";
import {
  changeRequiresBackendRestart,
  changeTakesEffectOnNextLaunch,
} from "../src/shared/desktop-settings";

test("default app config includes startup profile settings", () => {
  assert.equal(DEFAULT_APP_CONFIG.startupProfilePreset, "desktop");
  assert.equal(DEFAULT_APP_CONFIG.startupProfileCustom.startBackendOnLaunch, true);
  assert.equal(DEFAULT_APP_CONFIG.startupProfileCustom.openOverlayOnLaunch, false);
});

test("resolveStartupProfileTargets returns preset defaults for non-custom preset", () => {
  const config: Pick<AppConfig, "startupProfilePreset" | "startupProfileCustom"> = {
    startupProfilePreset: "desktopOverlay",
    startupProfileCustom: {
      ...DEFAULT_APP_CONFIG.startupProfileCustom,
      openOverlayOnLaunch: false,
    },
  };

  const resolved = resolveStartupProfileTargets(config);
  assert.equal(resolved.openOverlayOnLaunch, true);
  assert.equal(resolved.openWebUiOnLaunch, false);
  assert.equal(resolved.startBackendOnLaunch, true);
});

test("resolveStartupProfileTargets uses normalized custom settings for custom preset", () => {
  const config: Pick<AppConfig, "startupProfilePreset" | "startupProfileCustom"> = {
    startupProfilePreset: "custom",
    startupProfileCustom: {
      ...DEFAULT_APP_CONFIG.startupProfileCustom,
      openOverlayOnLaunch: true,
      openMainWindowOnLaunch: false,
    },
  };

  const resolved = resolveStartupProfileTargets(config);
  assert.equal(resolved.openOverlayOnLaunch, true);
  assert.equal(resolved.openMainWindowOnLaunch, false);
});

test("normalizeAppConfig migrates older config shape with no startup profile fields", () => {
  const oldConfig = {
    autoLaunch: true,
    showInTray: false,
    globalHotkey: "CommandOrControl+Shift+K",
    llmProvider: "openai",
  } satisfies Partial<AppConfig>;

  const normalized = normalizeAppConfig(oldConfig);

  assert.equal(normalized.autoLaunch, true);
  assert.equal(normalized.showInTray, false);
  assert.equal(normalized.globalHotkey, "CommandOrControl+Shift+K");
  assert.equal(normalized.llmProvider, "openai");
  assert.equal(normalized.startupProfilePreset, "desktop");
  assert.deepEqual(normalized.startupProfileCustom, DEFAULT_APP_CONFIG.startupProfileCustom);
});

test("normalizeAppConfig fills missing custom startup target fields", () => {
  const normalized = normalizeAppConfig({
    startupProfilePreset: "custom",
    startupProfileCustom: {
      openOverlayOnLaunch: true,
    } as Partial<AppConfig["startupProfileCustom"]> as AppConfig["startupProfileCustom"],
  });

  assert.equal(normalized.startupProfilePreset, "custom");
  assert.equal(normalized.startupProfileCustom.openOverlayOnLaunch, true);
  assert.equal(normalized.startupProfileCustom.startBackendOnLaunch, true);
  assert.equal(normalized.startupProfileCustom.restoreLastSession, true);
});

test("restart semantics distinguish backend restart vs next-launch settings", () => {
  assert.equal(changeRequiresBackendRestart({ port: 9000 }), true);
  assert.equal(changeRequiresBackendRestart({ startupProfilePreset: "custom" }), false);

  assert.equal(changeTakesEffectOnNextLaunch({ startupProfilePreset: "custom" }), true);
  assert.equal(
    changeTakesEffectOnNextLaunch({
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        openWebUiOnLaunch: true,
      },
    }),
    true
  );
  assert.equal(changeTakesEffectOnNextLaunch({ logLevel: "DEBUG" }), false);
});
