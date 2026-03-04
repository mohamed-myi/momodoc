import { defineConfig } from '@playwright/test'

/**
 * Playwright configuration for Electron E2E tests
 *
 * IMPORTANT: These tests require a packaged Electron app
 * Run locally only, not in CI initially
 *
 * To run:
 * 1. Package the app: npm run package:dir
 * 2. Run tests: npx playwright test -c playwright-electron.config.ts
 */

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Electron tests should run serially
  retries: 0,
  workers: 1,
  timeout: 60000, // Electron startup can be slow
  reporter: [
    ['html', { outputFolder: 'playwright-report-electron' }],
    ['list'],
  ],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
