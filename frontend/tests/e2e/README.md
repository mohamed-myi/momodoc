# Frontend E2E Tests

Last verified against source on 2026-03-04.

## Current Scope

The Playwright suite currently contains:

- `dashboard.spec.ts`
- `search-chat.spec.ts`
- `support/mockApi.ts`

Only the frontend is launched. The tests do not require a real backend because API traffic is mocked.

## How The Suite Works

`frontend/playwright.config.ts` currently:

- runs tests from `frontend/tests/e2e`
- uses Chromium only
- starts `npm run dev`
- serves the app at `http://localhost:3000`
- injects `NEXT_PUBLIC_API_BASE_URL` from `PLAYWRIGHT_API_BASE_URL` or `http://127.0.0.1:8000`
- reuses an existing dev server outside CI

Even though an API base URL is configured, `support/mockApi.ts` intercepts `**/api/v1/**` requests and fulfills them with deterministic mocked state.

## Running The Tests

From `frontend/`:

```bash
npm run test:e2e
```

For Playwright UI mode:

```bash
npm run test:e2e:ui
```

## Mocking Model

`support/mockApi.ts` provides an in-browser fake API with mutable state for:

- projects
- project files
- notes
- issues
- project chat sessions and messages
- global chat sessions and messages
- providers
- streaming chat responses

This lets the tests exercise the real UI state transitions without depending on:

- backend startup
- local embeddings
- LLM configuration
- live network calls

## Writing New Tests

Current guidance that matches the existing suite:

- prefer route mocks and fixture state over real backend integration
- assert visible UI states rather than `networkidle`
- use durable selectors such as roles, labels, placeholders, and `data-testid` where needed
- keep hover-only controls explicit in the test if you need them

## Outputs

Playwright is configured with:

- HTML reporter
- trace on first retry
- screenshots on failure

Useful commands:

```bash
npx playwright show-report
npx playwright show-trace test-results/<path>/trace.zip
```

## Troubleshooting

If the suite will not start:

- confirm `npm install` has been run in `frontend/`
- confirm port `3000` is available
- check whether another dev server is already running and conflicting with the expected config
