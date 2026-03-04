export const ONBOARDING_SCHEMA_VERSION = 1;

export const ONBOARDING_STEPS = [
  "welcome",
  "folders",
  "ai",
  "startup",
  "project",
  "summary",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number];
export type OnboardingStatus =
  | "not_started"
  | "in_progress"
  | "skipped"
  | "completed";

export type OnboardingAiMode =
  | "searchOnly"
  | "localOllama"
  | "anthropic"
  | "openai"
  | "google";

export interface OnboardingDraft {
  aiMode: OnboardingAiMode;
  firstProjectName: string;
  firstProjectSourceDir: string;
  createdProjectId: string | null;
  createdProjectName: string | null;
}

export interface OnboardingState {
  schemaVersion: number;
  status: OnboardingStatus;
  currentStep: number;
  completedAt: string | null;
  skippedAt: string | null;
  lastOpenedAt: string | null;
  draft: OnboardingDraft;
}

export const DEFAULT_ONBOARDING_DRAFT: OnboardingDraft = {
  aiMode: "searchOnly",
  firstProjectName: "",
  firstProjectSourceDir: "",
  createdProjectId: null,
  createdProjectName: null,
};

export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  schemaVersion: ONBOARDING_SCHEMA_VERSION,
  status: "not_started",
  currentStep: 0,
  completedAt: null,
  skippedAt: null,
  lastOpenedAt: null,
  draft: { ...DEFAULT_ONBOARDING_DRAFT },
};

function isOnboardingStatus(value: unknown): value is OnboardingStatus {
  return (
    value === "not_started" ||
    value === "in_progress" ||
    value === "skipped" ||
    value === "completed"
  );
}

function isOnboardingAiMode(value: unknown): value is OnboardingAiMode {
  return (
    value === "searchOnly" ||
    value === "localOllama" ||
    value === "anthropic" ||
    value === "openai" ||
    value === "google"
  );
}

function clampStep(value: unknown): number {
  if (!Number.isInteger(value)) {
    return 0;
  }
  return Math.max(0, Math.min((value as number) | 0, ONBOARDING_STEPS.length - 1));
}

export function normalizeOnboardingDraft(
  value: Partial<OnboardingDraft> | null | undefined
): OnboardingDraft {
  return {
    aiMode: isOnboardingAiMode(value?.aiMode)
      ? value.aiMode
      : DEFAULT_ONBOARDING_DRAFT.aiMode,
    firstProjectName:
      typeof value?.firstProjectName === "string"
        ? value.firstProjectName
        : DEFAULT_ONBOARDING_DRAFT.firstProjectName,
    firstProjectSourceDir:
      typeof value?.firstProjectSourceDir === "string"
        ? value.firstProjectSourceDir
        : DEFAULT_ONBOARDING_DRAFT.firstProjectSourceDir,
    createdProjectId:
      typeof value?.createdProjectId === "string" ? value.createdProjectId : null,
    createdProjectName:
      typeof value?.createdProjectName === "string"
        ? value.createdProjectName
        : null,
  };
}

export function normalizeOnboardingState(
  value: Partial<OnboardingState> | null | undefined
): OnboardingState {
  const status = isOnboardingStatus(value?.status)
    ? value.status
    : DEFAULT_ONBOARDING_STATE.status;

  const normalized: OnboardingState = {
    schemaVersion:
      typeof value?.schemaVersion === "number" && Number.isFinite(value.schemaVersion)
        ? value.schemaVersion
        : ONBOARDING_SCHEMA_VERSION,
    status,
    currentStep: clampStep(value?.currentStep),
    completedAt: typeof value?.completedAt === "string" ? value.completedAt : null,
    skippedAt: typeof value?.skippedAt === "string" ? value.skippedAt : null,
    lastOpenedAt: typeof value?.lastOpenedAt === "string" ? value.lastOpenedAt : null,
    draft: normalizeOnboardingDraft(value?.draft),
  };

  if (status === "completed") {
    normalized.currentStep = ONBOARDING_STEPS.length - 1;
  }

  return normalized;
}

export function shouldAutoOpenOnboarding(state: OnboardingState): boolean {
  return state.status === "not_started" || state.status === "in_progress";
}

export function markOnboardingOpened(
  state: OnboardingState,
  nowIso: string = new Date().toISOString()
): OnboardingState {
  return normalizeOnboardingState({
    ...state,
    status: state.status === "completed" ? "completed" : "in_progress",
    lastOpenedAt: nowIso,
    skippedAt: state.status === "skipped" ? state.skippedAt : null,
  });
}

export function setOnboardingStep(
  state: OnboardingState,
  currentStep: number
): OnboardingState {
  return normalizeOnboardingState({
    ...state,
    currentStep,
    status: state.status === "completed" ? "completed" : "in_progress",
  });
}

export function skipOnboarding(
  state: OnboardingState,
  nowIso: string = new Date().toISOString()
): OnboardingState {
  return normalizeOnboardingState({
    ...state,
    status: "skipped",
    skippedAt: nowIso,
  });
}

export function completeOnboarding(
  state: OnboardingState,
  nowIso: string = new Date().toISOString()
): OnboardingState {
  return normalizeOnboardingState({
    ...state,
    status: "completed",
    currentStep: ONBOARDING_STEPS.length - 1,
    completedAt: nowIso,
    skippedAt: null,
  });
}

export function resetOnboardingState(): OnboardingState {
  return normalizeOnboardingState(DEFAULT_ONBOARDING_STATE);
}

export function updateOnboardingDraft(
  state: OnboardingState,
  partial: Partial<OnboardingDraft>
): OnboardingState {
  return normalizeOnboardingState({
    ...state,
    draft: {
      ...state.draft,
      ...partial,
    },
  });
}
