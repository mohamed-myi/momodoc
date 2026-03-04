import { describe, it, expect } from "vitest";

import {
  DEFAULT_APP_CONFIG,
  normalizeAppConfig,
  resolveStartupProfileTargets,
  type AppConfig,
} from "../../src/shared/app-config";
import {
  changeRequiresBackendRestart,
  changeTakesEffectOnNextLaunch,
} from "../../src/shared/desktop-settings";

describe("Startup Profiles Config", () => {
  it("default app config includes startup profile settings", () => {
    expect(DEFAULT_APP_CONFIG.startupProfilePreset).toBe("desktop");
    expect(DEFAULT_APP_CONFIG.startupProfileCustom.startBackendOnLaunch).toBe(true);
    expect(DEFAULT_APP_CONFIG.startupProfileCustom.openOverlayOnLaunch).toBe(false);
  });

  it("resolveStartupProfileTargets returns preset defaults for non-custom preset", () => {
    const config: Pick<AppConfig, "startupProfilePreset" | "startupProfileCustom"> = {
      startupProfilePreset: "desktopOverlay",
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        openOverlayOnLaunch: false,
      },
    };

    const resolved = resolveStartupProfileTargets(config);
    expect(resolved.openOverlayOnLaunch).toBe(true);
    expect(resolved.openWebUiOnLaunch).toBe(false);
    expect(resolved.startBackendOnLaunch).toBe(true);
  });

  it("resolveStartupProfileTargets uses normalized custom settings for custom preset", () => {
    const config: Pick<AppConfig, "startupProfilePreset" | "startupProfileCustom"> = {
      startupProfilePreset: "custom",
      startupProfileCustom: {
        ...DEFAULT_APP_CONFIG.startupProfileCustom,
        openOverlayOnLaunch: true,
        openMainWindowOnLaunch: false,
      },
    };

    const resolved = resolveStartupProfileTargets(config);
    expect(resolved.openOverlayOnLaunch).toBe(true);
    expect(resolved.openMainWindowOnLaunch).toBe(false);
  });

  it("normalizeAppConfig migrates older config shape with no startup profile fields", () => {
    const oldConfig = {
      autoLaunch: true,
      showInTray: false,
      globalHotkey: "CommandOrControl+Shift+K",
      llmProvider: "openai",
    } satisfies Partial<AppConfig>;

    const normalized = normalizeAppConfig(oldConfig);

    expect(normalized.autoLaunch).toBe(true);
    expect(normalized.showInTray).toBe(false);
    expect(normalized.globalHotkey).toBe("CommandOrControl+Shift+K");
    expect(normalized.llmProvider).toBe("openai");
    expect(normalized.startupProfilePreset).toBe("desktop");
    expect(normalized.startupProfileCustom).toEqual(DEFAULT_APP_CONFIG.startupProfileCustom);
  });

  it("normalizeAppConfig fills missing custom startup target fields", () => {
    const normalized = normalizeAppConfig({
      startupProfilePreset: "custom",
      startupProfileCustom: {
        openOverlayOnLaunch: true,
      } as Partial<AppConfig["startupProfileCustom"]> as AppConfig["startupProfileCustom"],
    });

    expect(normalized.startupProfilePreset).toBe("custom");
    expect(normalized.startupProfileCustom.openOverlayOnLaunch).toBe(true);
    expect(normalized.startupProfileCustom.startBackendOnLaunch).toBe(true);
    expect(normalized.startupProfileCustom.restoreLastSession).toBe(true);
  });

  it("restart semantics distinguish backend restart vs next-launch settings", () => {
    expect(changeRequiresBackendRestart({ port: 9000 })).toBe(true);
    expect(changeRequiresBackendRestart({ startupProfilePreset: "custom" })).toBe(false);

    expect(changeTakesEffectOnNextLaunch({ startupProfilePreset: "custom" })).toBe(true);
    expect(
      changeTakesEffectOnNextLaunch({
        startupProfileCustom: {
          ...DEFAULT_APP_CONFIG.startupProfileCustom,
          openWebUiOnLaunch: true,
        },
      })
    ).toBe(true);
    expect(changeTakesEffectOnNextLaunch({ logLevel: "DEBUG" })).toBe(false);
  });
});
