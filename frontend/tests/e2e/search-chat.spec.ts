import { test, expect, type Page } from '@playwright/test'
import {
  buildTokenStream,
  createMockApiState,
  installMockApi,
  type MockApiState,
} from './support/mockApi'

async function openGlobalChat(page: Page, overrides: Partial<MockApiState> = {}) {
  const state = createMockApiState(overrides)
  await installMockApi(page, state)
  await page.goto('/')
  await page.getByRole('button', { name: /chat across all projects/i }).click()
  await expect(page.getByPlaceholder('Ask across all projects...')).toBeVisible()
  return state
}

async function switchToMode(page: Page, optionLabel: string) {
  await page.getByRole('button', { name: 'Select AI model' }).click()
  await page.getByRole('button', { name: optionLabel }).click()
}

test.describe('Unified Search and Chat E2E', () => {
  test('switches between chat and search modes', async ({ page }) => {
    await openGlobalChat(page)

    await switchToMode(page, 'Search only')
    await expect(page.getByPlaceholder('Search all projects...')).toBeVisible()
    await expect(page.getByText('search your documents with semantic similarity')).toBeVisible()

    await switchToMode(page, 'Gemini')
    await expect(page.getByPlaceholder('Ask across all projects...')).toBeVisible()
  })

  test('performs a global search and renders results', async ({ page }) => {
    await openGlobalChat(page, {
      searchResults: [
        {
          source_type: 'file',
          source_id: 'file-1',
          filename: 'example.py',
          original_path: '/workspace/test-project-1/example.py',
          chunk_text: 'def hello():\n    print("hello")',
          chunk_index: 0,
          file_type: 'py',
          score: 0.95,
          project_id: 'proj-1',
        },
        {
          source_type: 'note',
          source_id: 'note-1',
          filename: 'Architecture note',
          original_path: null,
          chunk_text: 'Use semantic search before asking the LLM.',
          chunk_index: 0,
          file_type: 'note',
          score: 0.84,
          project_id: 'proj-2',
        },
      ],
    })

    await switchToMode(page, 'Search only')
    const searchInput = page.getByPlaceholder('Search all projects...')
    await searchInput.fill('python functions')
    await searchInput.press('Enter')

    await expect(page.getByText('2 results')).toBeVisible()
    await expect(page.getByText('example.py', { exact: true })).toBeVisible()
    await expect(page.getByText('Architecture note')).toBeVisible()
  })

  test('creates, renames, and deletes chat sessions', async ({ page }) => {
    await openGlobalChat(page, {
      globalSessions: [],
      streamResponse: {
        body: buildTokenStream(['Mocked assistant response.']),
      },
    })

    const input = page.getByPlaceholder('Ask across all projects...')
    await input.fill('Hello from Playwright')
    await input.press('Enter')

    await expect(page.getByText('Hello from Playwright')).toBeVisible()
    await expect(page.getByText('Mocked assistant response.')).toBeVisible()

    const untitledSession = page.getByRole('button', { name: 'Untitled' })
    await expect(untitledSession).toBeVisible()
    await untitledSession.hover()
    await page.getByTitle('Rename').click()

    const renameInput = page.locator('input[type="text"]').last()
    await renameInput.fill('Renamed session')
    await renameInput.press('Enter')

    const renamedSession = page.getByRole('button', { name: 'Renamed session' })
    await expect(renamedSession).toBeVisible()
    await renamedSession.hover()
    await page.locator('button[title="Delete"]').click()
    await page.getByRole('button', { name: 'delete?' }).click()

    await expect(page.getByRole('button', { name: 'Renamed session' })).toHaveCount(0)
  })

  test('renders markdown responses from chat streams', async ({ page }) => {
    await openGlobalChat(page, {
      globalSessions: [],
      streamResponse: {
        body: buildTokenStream(['## Example\n\n```ts\nconst value = 1\n```']),
      },
    })

    const input = page.getByPlaceholder('Ask across all projects...')
    await input.fill('Show me a code example')
    await input.press('Enter')

    await expect(page.getByRole('heading', { name: 'Example' })).toBeVisible()
    await expect(page.locator('pre code')).toContainText('const value = 1')
  })

  test('shows an inline error when a chat stream fails', async ({ page }) => {
    await openGlobalChat(page, {
      globalSessions: [],
      streamResponse: {
        status: 500,
        detail: 'stream failed',
      },
    })

    const input = page.getByPlaceholder('Ask across all projects...')
    await input.fill('This should fail')
    await input.press('Enter')

    await expect(page.getByText(/failed to get response/i)).toBeVisible()
  })
})
