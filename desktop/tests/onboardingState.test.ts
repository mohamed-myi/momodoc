import test from "node:test";
import assert from "node:assert/strict";

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
} from "../src/shared/onboarding";
import { DEFAULT_APP_CONFIG, normalizeAppConfig } from "../src/shared/app-config";

test("default app config includes onboarding state", () => {
  assert.equal(DEFAULT_APP_CONFIG.onboarding.status, "not_started");
  assert.equal(DEFAULT_APP_CONFIG.onboarding.currentStep, 0);
  assert.equal(DEFAULT_APP_CONFIG.onboarding.draft.aiMode, "searchOnly");
});

test("normalizeAppConfig migrates missing onboarding state", () => {
  const normalized = normalizeAppConfig({ llmProvider: "openai" });
  assert.equal(normalized.llmProvider, "openai");
  assert.equal(normalized.onboarding.status, "not_started");
  assert.equal(normalized.onboarding.currentStep, 0);
});

test("normalizeOnboardingState fills missing nested draft fields and clamps step", () => {
  const normalized = normalizeOnboardingState({
    status: "in_progress",
    currentStep: 999,
    draft: {
      aiMode: "localOllama",
      firstProjectName: "Docs",
    } as Partial<(typeof DEFAULT_ONBOARDING_STATE)["draft"]> as (typeof DEFAULT_ONBOARDING_STATE)["draft"],
  });

  assert.equal(normalized.status, "in_progress");
  assert.equal(normalized.currentStep, ONBOARDING_STEPS.length - 1);
  assert.equal(normalized.draft.aiMode, "localOllama");
  assert.equal(normalized.draft.firstProjectName, "Docs");
  assert.equal(normalized.draft.firstProjectSourceDir, "");
});

test("onboarding state transitions support skip, resume, and completion", () => {
  const skipped = skipOnboarding(DEFAULT_ONBOARDING_STATE, "2026-02-25T01:00:00.000Z");
  assert.equal(skipped.status, "skipped");
  assert.equal(shouldAutoOpenOnboarding(skipped), false);

  const resumed = setOnboardingStep(skipped, 2);
  assert.equal(resumed.status, "in_progress");
  assert.equal(resumed.currentStep, 2);
  assert.equal(shouldAutoOpenOnboarding(resumed), true);

  const completed = completeOnboarding(resumed, "2026-02-25T02:00:00.000Z");
  assert.equal(completed.status, "completed");
  assert.equal(completed.currentStep, ONBOARDING_STEPS.length - 1);
  assert.equal(completed.completedAt, "2026-02-25T02:00:00.000Z");
  assert.equal(shouldAutoOpenOnboarding(completed), false);
});

test("onboarding draft updates persist project creation draft fields", () => {
  const state = updateOnboardingDraft(resetOnboardingState(), {
    firstProjectName: "Workspace",
    firstProjectSourceDir: "/tmp/workspace",
    createdProjectId: "proj_123",
    createdProjectName: "Workspace",
  });

  assert.equal(state.draft.firstProjectName, "Workspace");
  assert.equal(state.draft.firstProjectSourceDir, "/tmp/workspace");
  assert.equal(state.draft.createdProjectId, "proj_123");
  assert.equal(state.draft.createdProjectName, "Workspace");
});
