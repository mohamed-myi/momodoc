# Frontend E2E Tests

End-to-end tests for the momodoc frontend using Playwright.

## Prerequisites

1. **Backend must be running** - E2E tests interact with a real backend
2. **Frontend dev server** - Tests run against the Next.js dev server
3. Playwright installed: `npm install` (already in devDependencies)

## Running Tests

### Automatic (Recommended)

Playwright config automatically starts both backend and frontend:

```bash
npm run test:e2e
```

This will:
1. Start backend via `make serve` (localhost:8000)
2. Start frontend via `npm run dev` (localhost:3000)
3. Run all E2E tests
4. Shut down servers after tests complete

### Manual

If you prefer to run servers manually:

```bash
# Terminal 1: Start backend
cd ../backend
make serve

# Terminal 2: Start frontend
npm run dev

# Terminal 3: Run tests
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

- `dashboard.spec.ts` - Dashboard, project CRUD, navigation
- `search-chat.spec.ts` - Unified search/chat, streaming, sessions

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

3. **Handle async operations** (API calls, streaming):
   ```ts
   await page.waitForLoadState('networkidle')
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

## CI/CD

E2E tests run in GitHub Actions with:
- Backend started via `make serve`
- Frontend started via `npm run dev`
- Headless browser mode
- 2 retries on failure
- Artifacts uploaded (screenshots, videos, traces)

## Troubleshooting

**Tests timeout:**
- Increase timeout in test: `test.setTimeout(60000)`
- Or in config: `timeout: 60000`

**Backend not starting:**
- Check backend health: `curl http://localhost:8000/api/v1/health`
- Check logs: `tail -f ../backend/momodoc.log`

**Frontend not loading:**
- Check dev server: `curl http://localhost:3000`
- Check for port conflicts: `lsof -i :3000`

**Flaky tests:**
- Use `waitForLoadState('networkidle')` instead of fixed timeouts
- Add explicit waits for dynamic content
- Use `test.retry(2)` for known flaky tests
