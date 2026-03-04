import { test, expect, type Page } from '@playwright/test'
import { createMockApiState, installMockApi, type MockApiState } from './support/mockApi'

async function openDashboard(
  page: Page,
  overrides: Partial<MockApiState> = {},
  expectReady = true
) {
  const state = createMockApiState(overrides)
  await installMockApi(page, state)
  await page.goto('/')
  if (expectReady) {
    await expect(page.getByRole('heading', { name: 'momodoc' })).toBeVisible()
  }
  return state
}

test.describe('Dashboard E2E', () => {
  test('shows the project list and opens a project detail view', async ({ page }) => {
    await openDashboard(page)

    await expect(page.getByText('2 projects')).toBeVisible()
    await expect(page.getByText('Test Project 1')).toBeVisible()
    await expect(page.getByText('Test Project 2')).toBeVisible()

    await page.getByRole('button', { name: /Test Project 1/i }).click()

    await expect(page.getByRole('button', { name: /^Chat/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Files/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Notes/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Issues/ })).toBeVisible()
    await expect(page.getByPlaceholder('Ask about this project...')).toBeVisible()
  })

  test('creates a project from the dashboard', async ({ page }) => {
    await openDashboard(page)

    await page.getByRole('button', { name: 'new project' }).click()
    await page.getByPlaceholder('project name').fill('E2E Test Project')
    await page.getByPlaceholder('description (optional)').fill('Created from Playwright')
    await page.getByRole('button', { name: 'create' }).click()

    await expect(page.getByText('E2E Test Project')).toBeVisible()
    await expect(page.getByText('Created from Playwright')).toBeVisible()
  })

  test('shows the empty state when no projects exist', async ({ page }) => {
    await openDashboard(page, { projects: [] })

    await expect(page.getByText('no projects')).toBeVisible()
    await expect(page.getByText('create one to get started')).toBeVisible()
  })

  test('shows the retry page when loading projects fails', async ({ page }) => {
    await openDashboard(
      page,
      { projectsError: { detail: 'failed to load projects', status: 500 } },
      false
    )

    await expect(page.getByText('something went wrong')).toBeVisible()
    await expect(page.getByText('failed to load projects')).toBeVisible()
    await expect(page.getByRole('button', { name: 'retry' })).toBeVisible()
  })
})
