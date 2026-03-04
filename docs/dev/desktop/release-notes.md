# Desktop Release Notes Authoring

Last verified against source on 2026-03-04.

## Source Of Truth

- `desktop/src/shared/release-notes.ts`
- `desktop/src/renderer/components/App.tsx`

## Current Data Shape

Release notes entries use:

- `version`
- `title`
- `highlights: string[]`

As of 2026-03-04, the repo contains a single explicit entry:

- `0.1.0` -> `Desktop UX Productization`

## When The Dialog Appears

The renderer shows the What’s New modal only when:

- diagnostics report that the app is packaged
- an app version is available in diagnostics
- `localStorage["momodoc-last-seen-version"]` exists and differs from the current app version

On first packaged run for a user, the app records the current version and does not open the modal.

## Behavior When Notes Are Missing

If the current version has no matching entry in `RELEASE_NOTES`, the app still shows the modal with a generic fallback:

- title: `What’s New in v<version>`
- two generic highlight bullets about desktop improvements and reviewing settings/diagnostics

That means explicit release-note entries are optional from a runtime perspective, but recommended for real releases.

## How To Add A Version

1. Add a new object to `RELEASE_NOTES` in `desktop/src/shared/release-notes.ts`.
2. Use the exact application version string, for example `0.2.0`.
3. Add a short user-facing title.
4. Add concise highlight bullets focused on visible behavior changes.
5. Verify the packaged desktop upgrade path so the modal shows after moving from an older seen version to the new version.

## Writing Guidelines

- Write for end users, not maintainers.
- Prefer user-visible outcomes over implementation details.
- Keep highlights short enough to scan in a modal dialog.
- Mention required user action if a release changes setup, trust prompts, or migration behavior.
