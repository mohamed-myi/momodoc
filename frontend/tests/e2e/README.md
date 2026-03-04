# Frontend E2E Tests

End-to-end tests for the momodoc frontend using Playwright.

## Prerequisites

1. **Frontend dev server** - Tests run against the Next.js dev server
2. Playwright installed: `npm install` (already in devDependencies)

The browser specs use Playwright route mocks for `/api/v1/**` so they can exercise the current UI deterministically without depending on real backend data or LLM configuration.

## Running Tests

### Automatic (Recommended)

Playwright config automatically starts the frontend dev server:

```bash
npm run test:e2e
```

This will:
1. Start frontend via `npm run dev` (localhost:3000)
2. Run all E2E tests
3. Shut down the dev server after tests complete

### Manual

If you prefer to run servers manually:

```bash
# Terminal 1: Start frontend
npm run dev

# Terminal 2: Run tests
npm run test:e2e
```

### UI Mode (Interactive)

For debugging and developing tests:

```bash
npm run test:e2e:ui
```

This opens Playwright's UI mode where you can:
- Run tests individually
- See live browser interactions
- Debug failed tests
- Time-travel through test steps

## Test Structure

- `dashboard.spec.ts` - Dashboard loading, empty/error states, project navigation
- `search-chat.spec.ts` - Unified search/chat mode switching, sessions, streaming states

## Writing E2E Tests

### Best Practices

1. **Use data-testid attributes** for reliable selectors:
   ```tsx
   <div data-testid="project-card">...</div>
   ```

2. **Wait for elements** rather than fixed timeouts:
   ```ts
   await expect(page.locator('[data-testid="result"]')).toBeVisible({ timeout: 5000 })
   ```

3. **Wait for user-visible state** instead of `networkidle`:
   ```ts
   await expect(page.getByRole('heading', { name: 'momodoc' })).toBeVisible()
   ```

4. **Clean up test data** to avoid test pollution:
   ```ts
   test.afterEach(async ({ page }) => {
     // Delete test project if created
   })
   ```

### Common Patterns

**Testing streaming responses:**
```ts
const chatInput = page.locator('textarea[placeholder*="message"]')
await chatInput.fill('Test message')
await chatInput.press('Enter')

// Wait for response to start
const response = page.locator('[data-role="assistant"]').last()
await expect(response).toBeVisible({ timeout: 10000 })
```

**Testing error states:**
```ts
await page.route('**/api/v1/projects', route => {
  route.fulfill({ status: 500, body: JSON.stringify({ detail: 'Error' }) })
})

await page.goto('/')
await expect(page.locator('text=/error/i')).toBeVisible()
```

## Debugging

### Failed Tests

View HTML report:
```bash
npx playwright show-report
```

### Screenshots & Videos

Failed tests automatically capture:
- Screenshots: `test-results/*/screenshot.png`
- Videos: `test-results/*/video.webm`
- Traces: `test-results/*/trace.zip`

View trace:
```bash
npx playwright show-trace test-results/path/to/trace.zip
```

## Troubleshooting

**Frontend not loading:**
- Check dev server: `curl http://localhost:3000`
- Check for port conflicts: `lsof -i :3000`

**Flaky tests:**
- Prefer route mocks with explicit fixtures over real backend state
- Wait for stable UI text, roles, or placeholders instead of fixed timeouts
- Keep selectors tied to visible controls, not hidden hover affordances unless the test explicitly hovers first
