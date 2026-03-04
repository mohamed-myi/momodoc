# Onboarding Flow (Internal)

Last verified version: `0.1.0` (code-level review + local build/tests, 2026-02-25)

## Purpose

Describe the desktop onboarding state machine, persistence behavior, and how the renderer wizard maps to saved settings.

## State Storage

Onboarding state is persisted in desktop config (`electron-store`) as `config.onboarding`.

Primary schema lives in:
- `/Users/mohamedibrahim/momodoc/desktop/src/shared/onboarding.ts`
- `/Users/mohamedibrahim/momodoc/desktop/src/shared/app-config.ts`

## Onboarding State Model

- `status`: `not_started | in_progress | skipped | completed`
- `currentStep`: numeric index into `ONBOARDING_STEPS`
- timestamps: `completedAt`, `skippedAt`, `lastOpenedAt`
- `draft`: persisted draft values for AI mode and first-project creation inputs

## Auto-Open Behavior

The desktop shell (`App.tsx`) shows onboarding automatically when:
- backend is ready, and
- `shouldAutoOpenOnboarding(settings.onboarding)` is `true`

This currently means auto-open for:
- `not_started`
- `in_progress`

It does not auto-open for:
- `skipped`
- `completed`

## Resume / Reopen / Reset

Users can reopen or reset onboarding from:
- `Settings -> App Behavior -> Setup Wizard`

Actions:
- `Resume/Reopen Setup Wizard` -> marks onboarding as opened (`in_progress`)
- `Reset Onboarding` -> resets to schema defaults (`not_started`, step 0, cleared draft)

## Non-Blocking Recovery Requirement

Onboarding is intentionally non-blocking:
- users can `Skip for now`
- onboarding provides `Settings` and `Diagnostics` shortcuts
- startup failure screen still allows recovery access even when onboarding is not shown

## Step List (Current)

1. `welcome`
2. `folders`
3. `ai`
4. `startup`
5. `project`
6. `summary`

## Mapping: Onboarding -> Saved Settings

- Folders step -> `allowedIndexPaths`
- AI mode step -> `llmProvider` (except `searchOnly`, which keeps provider config unchanged) + onboarding draft AI mode
- Startup step -> `startupProfilePreset`, `autoLaunch`, `showInTray`
- First project step -> creates project via API; stores created project metadata in onboarding draft
- Finish step -> marks onboarding `completed`

## Known Limitations

- Screenshot documentation is pending manual packaged-app capture.
- `searchOnly` onboarding choice does not currently set a persistent chat default mode; it is recorded in onboarding draft and explained in the wizard.
