import { describe, it, expect } from "vitest";

import {
  DEFAULT_ONBOARDING_STATE,
  ONBOARDING_STEPS,
  completeOnboarding,
  normalizeOnboardingState,
  resetOnboardingState,
  setOnboardingStep,
  shouldAutoOpenOnboarding,
  skipOnboarding,
  updateOnboardingDraft,
} from "../../src/shared/onboarding";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "../../src/shared/app-config";

describe("Onboarding State", () => {
  it("default app config includes onboarding state", () => {
    expect(DEFAULT_APP_CONFIG.onboarding.status).toBe("not_started");
    expect(DEFAULT_APP_CONFIG.onboarding.currentStep).toBe(0);
    expect(DEFAULT_APP_CONFIG.onboarding.draft.aiMode).toBe("searchOnly");
  });

  it("normalizeAppConfig migrates missing onboarding state", () => {
    const normalized = normalizeAppConfig({ llmProvider: "openai" });
    expect(normalized.llmProvider).toBe("openai");
    expect(normalized.onboarding.status).toBe("not_started");
    expect(normalized.onboarding.currentStep).toBe(0);
  });

  it("normalizeOnboardingState fills missing nested draft fields and clamps step", () => {
    const normalized = normalizeOnboardingState({
      status: "in_progress",
      currentStep: 999,
      draft: {
        aiMode: "localOllama",
        firstProjectName: "Docs",
      } as Partial<(typeof DEFAULT_ONBOARDING_STATE)["draft"]> as (typeof DEFAULT_ONBOARDING_STATE)["draft"],
    });

    expect(normalized.status).toBe("in_progress");
    expect(normalized.currentStep).toBe(ONBOARDING_STEPS.length - 1);
    expect(normalized.draft.aiMode).toBe("localOllama");
    expect(normalized.draft.firstProjectName).toBe("Docs");
    expect(normalized.draft.firstProjectSourceDir).toBe("");
  });

  it("onboarding state transitions support skip, resume, and completion", () => {
    const skipped = skipOnboarding(DEFAULT_ONBOARDING_STATE, "2026-02-25T01:00:00.000Z");
    expect(skipped.status).toBe("skipped");
    expect(shouldAutoOpenOnboarding(skipped)).toBe(false);

    const resumed = setOnboardingStep(skipped, 2);
    expect(resumed.status).toBe("in_progress");
    expect(resumed.currentStep).toBe(2);
    expect(shouldAutoOpenOnboarding(resumed)).toBe(true);

    const completed = completeOnboarding(resumed, "2026-02-25T02:00:00.000Z");
    expect(completed.status).toBe("completed");
    expect(completed.currentStep).toBe(ONBOARDING_STEPS.length - 1);
    expect(completed.completedAt).toBe("2026-02-25T02:00:00.000Z");
    expect(shouldAutoOpenOnboarding(completed)).toBe(false);
  });

  it("onboarding draft updates persist project creation draft fields", () => {
    const state = updateOnboardingDraft(resetOnboardingState(), {
      firstProjectName: "Workspace",
      firstProjectSourceDir: "/tmp/workspace",
      createdProjectId: "proj_123",
      createdProjectName: "Workspace",
    });

    expect(state.draft.firstProjectName).toBe("Workspace");
    expect(state.draft.firstProjectSourceDir).toBe("/tmp/workspace");
    expect(state.draft.createdProjectId).toBe("proj_123");
    expect(state.draft.createdProjectName).toBe("Workspace");
  });
});
