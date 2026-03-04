# Desktop Release Notes Authoring

Last verified version: `0.1.0` (code-level review + local build/tests, 2026-02-25)

## Source of Truth

Desktop post-update “What’s New” notes are defined in:
- `/Users/mohamedibrahim/momodoc/desktop/src/shared/release-notes.ts`

## When Notes Appear

The desktop app shows a “What’s New” dialog when:
- running a packaged build, and
- the current app version differs from the last version seen by the user

Version tracking key:
- `localStorage["momodoc-last-seen-version"]`

## How To Add Notes For A New Version

1. Add a new entry to `RELEASE_NOTES` in `desktop/src/shared/release-notes.ts`.
2. Set `version` to the exact app version string (no `v` prefix), e.g. `0.2.0`.
3. Add 3-6 concise highlights focused on user-visible changes.
4. Run `cd desktop && npm run build`.
5. Verify the dialog after upgrading from the previous version (manual packaged-app test).

## Writing Guidelines

- Prefer user-facing language (what changed / why it matters).
- Avoid internal refactor jargon.
- Mention migration or trust-warning changes if user action is required.
- Keep bullets short enough to scan in a modal dialog.
