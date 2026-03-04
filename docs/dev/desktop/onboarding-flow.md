# Desktop Onboarding Flow

Last verified against source on 2026-03-04.

## Source Of Truth

- `desktop/src/shared/onboarding.ts`
- `desktop/src/shared/app-config.ts`
- `desktop/src/renderer/components/OnboardingWizard.tsx`
- `desktop/src/renderer/components/App.tsx`

## Stored State

Onboarding is persisted inside desktop config as `config.onboarding`.

Current schema:

- `schemaVersion`
- `status`
- `currentStep`
- `completedAt`
- `skippedAt`
- `lastOpenedAt`
- `draft`

Current schema version:

- `1`

## Allowed Status Values

- `not_started`
- `in_progress`
- `skipped`
- `completed`

Current step keys:

1. `welcome`
2. `folders`
3. `ai`
4. `startup`
5. `project`
6. `summary`

## Draft Payload

The onboarding draft currently stores:

- `aiMode`
- `firstProjectName`
- `firstProjectSourceDir`
- `createdProjectId`
- `createdProjectName`

Supported onboarding AI modes:

- `searchOnly`
- `localOllama`
- `anthropic`
- `openai`
- `google`

## Auto-Open Rules

The wizard auto-opens only when all of the following are true:

- desktop settings are loaded
- the backend is ready
- `shouldAutoOpenOnboarding(settings.onboarding)` returns true

That helper currently returns true for:

- `not_started`
- `in_progress`

It does not auto-open for:

- `skipped`
- `completed`

## State Transitions

Shared helpers implement the main state transitions:

- `markOnboardingOpened(...)`
- `setOnboardingStep(...)`
- `skipOnboarding(...)`
- `completeOnboarding(...)`
- `resetOnboardingState()`
- `updateOnboardingDraft(...)`

Important current behavior:

- opening or stepping the wizard keeps it in `in_progress` unless already completed
- skipping records `skippedAt`
- completing forces the step index to the final step and clears `skippedAt`
- resetting returns the full default state

## Step Behavior

### Welcome

Introduces the setup flow and reminds the user that the wizard is non-blocking.

### Folders

Uses the desktop directory picker to append entries to `allowedIndexPaths`.

Notes:

- the app deduplicates chosen paths
- users can remove allowed paths directly in the wizard
- continuing with zero allowed folders is permitted, but folder indexing will remain blocked

### AI

Selecting an AI mode updates onboarding draft state and may also change `llmProvider`:

- `localOllama` -> `ollama`
- `anthropic` -> `claude`
- `openai` -> `openai`
- `google` -> `google`
- `searchOnly` -> no provider change

The wizard does not write API keys. It only points the user toward the matching provider configuration path.

### Startup

This step edits:

- `startupProfilePreset`
- `autoLaunch`
- `showInTray`

The available preset options mirror the runtime presets:

- `desktop`
- `desktopOverlay`
- `desktopWeb`
- `vscodeCompanion`
- `custom`

### First Project

This step can create a project through the frontend API client:

- it requires a project name
- source folder is optional
- after creation, the wizard stores the created project id and name in the onboarding draft

### Summary

The final step summarizes:

- allowed folder count
- selected AI mode
- startup preset and auto-launch status
- created project name if one exists

The summary also exposes shortcuts to open:

- the created project
- the overlay
- diagnostics
- settings

## Reopen, Skip, And Reset

The wizard is intentionally non-blocking.

Current recovery paths include:

- `Skip for now` from the wizard
- reopening from settings
- resetting onboarding from settings
- opening settings or diagnostics directly from the wizard

## Known Product Limits

- `searchOnly` is preserved in onboarding draft, but it does not establish a separate persistent chat mode beyond leaving provider settings unchanged.
- The wizard depends on backend readiness because project creation and settings-backed state updates need the desktop shell to be fully operational.
