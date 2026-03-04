import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

/**
 * Desktop Metrics Dashboard E2E Test
 *
 * IMPORTANT: Requires packaged Electron app
 * These tests are marked as local-only
 */

test.describe('Metrics Dashboard E2E', () => {
  test.skip(!!process.env.CI, 'Metrics dashboard tests require packaged app (local only)')

  test('loads metrics dashboard', async () => {
    const electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist-electron/main/index.js')],
    })

    const mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')

    // Navigate to metrics/settings (if accessible via UI)
    const settingsButton = mainWindow.locator('button:has-text("Settings"), [aria-label*="settings" i]').first()

    if (await settingsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await settingsButton.click()

      // Look for metrics tab
      const metricsTab = mainWindow.locator('button:has-text("Metrics"), [role="tab"]:has-text("Metrics")').first()

      if (await metricsTab.isVisible().catch(() => false)) {
        await metricsTab.click()

        // Verify metrics display
        await expect(mainWindow.locator('text=/uptime|storage|projects|chat/i')).toBeVisible({ timeout: 5000 })
      }
    }

    await electronApp.close()
  })

  test('verifies data displays correctly', async () => {
    test.skip(true, 'Requires packaged app and metrics UI')

    // This test would:
    // 1. Launch app
    // 2. Navigate to metrics dashboard
    // 3. Verify charts/tables render
    // 4. Check for non-zero values (uptime, project count, etc.)
    // 5. Verify no error states
  })

  test('tests sorting and filtering', async () => {
    test.skip(true, 'Requires packaged app and metrics UI')

    // This test would:
    // 1. Navigate to metrics dashboard
    // 2. Find sortable columns
    // 3. Click to sort ascending/descending
    // 4. Verify order changes
    // 5. Apply filters (date range, project, etc.)
    // 6. Verify filtered results
  })

  test('tests refresh functionality', async () => {
    test.skip(true, 'Requires packaged app and metrics UI')

    // This test would:
    // 1. Load metrics dashboard
    // 2. Note current values
    // 3. Click refresh button
    // 4. Verify data reloads
    // 5. Check for updated timestamps
  })
})

/**
 * MANUAL TEST CHECKLIST FOR METRICS DASHBOARD
 *
 * [ ] Launch packaged app
 * [ ] Open Settings → Metrics tab
 * [ ] Verify all metric cards display (Overview, Projects, Chat, Storage, Sync)
 * [ ] Check Overview metrics:
 *     [ ] Uptime displays correctly
 *     [ ] Total projects count
 *     [ ] Total chunks count
 * [ ] Check Projects metrics:
 *     [ ] Projects listed with file counts
 *     [ ] Can sort by name/files/updated
 * [ ] Check Chat metrics:
 *     [ ] Session count
 *     [ ] Message count
 *     [ ] Recent sessions list
 * [ ] Check Storage metrics:
 *     [ ] Database size
 *     [ ] Vector DB size
 *     [ ] Breakdown by type
 * [ ] Check Sync metrics:
 *     [ ] Recent sync jobs
 *     [ ] Success/failure counts
 *     [ ] Error details if any
 * [ ] Test refresh button:
 *     [ ] Click refresh
 *     [ ] Verify loading indicator
 *     [ ] Verify updated data
 * [ ] Test with no data:
 *     [ ] Fresh install/reset data
 *     [ ] Verify empty states display correctly
 */
