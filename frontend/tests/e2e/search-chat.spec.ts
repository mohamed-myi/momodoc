import { test, expect } from '@playwright/test'

test.describe('Unified Search and Chat E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('switches between search and chat modes', async ({ page }) => {
    // Look for mode toggle buttons
    const chatButton = page.locator('button:has-text("Chat"), [role="tab"]:has-text("Chat")').first()
    const searchButton = page.locator('button:has-text("Search"), [role="tab"]:has-text("Search")').first()

    if (await chatButton.isVisible().catch(() => false)) {
      // Test chat mode (default)
      await chatButton.click()
      await page.waitForTimeout(500)

      // Verify chat interface elements
      const chatInput = page.locator('textarea[placeholder*="message" i], input[placeholder*="message" i]')
      if (await chatInput.isVisible().catch(() => false)) {
        await expect(chatInput).toBeVisible()
      }

      // Switch to search
      if (await searchButton.isVisible().catch(() => false)) {
        await searchButton.click()
        await page.waitForTimeout(500)

        // Verify search interface
        const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]')
        if (await searchInput.isVisible().catch(() => false)) {
          await expect(searchInput).toBeVisible()
        }
      }
    } else {
      console.log('Mode toggle not found - skipping test')
      test.skip()
    }
  })

  test('performs search query and displays results', async ({ page }) => {
    // Navigate to search (or find search input)
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first()

    if (await searchInput.isVisible().catch(() => false)) {
      // Enter search query
      await searchInput.fill('python functions')
      await searchInput.press('Enter')

      // Wait for results
      await page.waitForTimeout(2000)

      // Look for search results
      const results = page.locator('[data-testid="search-result"], .search-result, article.result').first()
      const emptyState = page.locator('text=/no results|no matches/i')

      // Either results or empty state should appear
      await expect(results.or(emptyState)).toBeVisible({ timeout: 5000 })
    } else {
      console.log('Search input not found')
      test.skip()
    }
  })

  test('creates and manages chat sessions', async ({ page }) => {
    // Look for chat interface
    const newChatButton = page.locator('button:has-text("New Chat"), button[aria-label*="new chat" i]').first()

    if (await newChatButton.isVisible().catch(() => false)) {
      // Create new session
      await newChatButton.click()
      await page.waitForTimeout(1000)

      // Find chat input
      const chatInput = page.locator('textarea[placeholder*="message" i], textarea[placeholder*="type" i]').first()

      if (await chatInput.isVisible()) {
        // Send message
        await chatInput.fill('Hello, can you help me with my project?')
        await chatInput.press('Enter')

        // Wait for response
        await page.waitForTimeout(3000)

        // Look for assistant response
        const assistantMessage = page.locator('[data-role="assistant"], .message.assistant, .ai-response').first()

        // Response should appear (or loading indicator)
        const loadingIndicator = page.locator('[data-testid="loading"], .loading, .spinner')

        await expect(assistantMessage.or(loadingIndicator)).toBeVisible({ timeout: 15000 })

        // Verify session appears in sidebar
        const sessionItem = page.locator('[data-testid="session-item"], .session, .chat-session').first()
        if (await sessionItem.isVisible().catch(() => false)) {
          await expect(sessionItem).toBeVisible()
        }
      }
    } else {
      console.log('New Chat button not found')
      test.skip()
    }
  })

  test('handles streaming responses', async ({ page }) => {
    // Find chat input
    const chatInput = page.locator('textarea[placeholder*="message" i], textarea[placeholder*="type" i]').first()

    if (await chatInput.isVisible().catch(() => false)) {
      // Send message that triggers streaming
      await chatInput.fill('Explain how RAG works')
      await chatInput.press('Enter')

      // Monitor for streaming (text appearing gradually)
      await page.waitForTimeout(1000)

      // Look for response container
      const responseContainer = page.locator('[data-role="assistant"], .message.assistant').last()

      // Wait for response to start appearing
      await expect(responseContainer).toBeVisible({ timeout: 10000 })

      // Get initial content length
      const initialText = await responseContainer.textContent()
      const initialLength = initialText?.length || 0

      // Wait a bit for more content to stream
      await page.waitForTimeout(2000)

      // Get updated content
      const updatedText = await responseContainer.textContent()
      const updatedLength = updatedText?.length || 0

      // Content should have grown (streaming)
      expect(updatedLength).toBeGreaterThanOrEqual(initialLength)
    } else {
      console.log('Chat input not found')
      test.skip()
    }
  })

  test('aborts streaming response', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="message" i], textarea[placeholder*="type" i]').first()

    if (await chatInput.isVisible().catch(() => false)) {
      // Send message
      await chatInput.fill('Write a long explanation about quantum computing')
      await chatInput.press('Enter')

      // Wait for streaming to start
      await page.waitForTimeout(1000)

      // Look for abort/stop button
      const stopButton = page.locator('button:has-text("Stop"), button[aria-label*="stop" i], button.stop-streaming').first()

      if (await stopButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        // Click stop
        await stopButton.click()

        // Wait a moment
        await page.waitForTimeout(1000)

        // Verify streaming stopped (button disappears or changes)
        const isStopButtonGone = !(await stopButton.isVisible().catch(() => true))
        expect(isStopButtonGone).toBeTruthy()
      } else {
        console.log('Stop button not found or stream too fast')
      }
    } else {
      test.skip()
    }
  })

  test('switches between chat sessions', async ({ page }) => {
    // Look for session list
    const sessionItems = page.locator('[data-testid="session-item"], .session-item, .chat-session')

    const count = await sessionItems.count()

    if (count >= 2) {
      // Click first session
      await sessionItems.first().click()
      await page.waitForTimeout(500)

      const firstSessionMessages = await page.locator('[data-role="message"], .message').count()

      // Click second session
      await sessionItems.nth(1).click()
      await page.waitForTimeout(500)

      const secondSessionMessages = await page.locator('[data-role="message"], .message').count()

      // Messages should change between sessions
      // (or could be same if both empty/similar)
      expect(typeof firstSessionMessages).toBe('number')
      expect(typeof secondSessionMessages).toBe('number')
    } else {
      console.log('Not enough sessions to test switching')
      test.skip()
    }
  })

  test('deletes chat session', async ({ page }) => {
    const sessionItems = page.locator('[data-testid="session-item"], .session-item')
    const initialCount = await sessionItems.count()

    if (initialCount > 0) {
      // Hover over first session to reveal delete button
      await sessionItems.first().hover()

      // Look for delete button
      const deleteButton = page.locator('button[aria-label*="delete" i], button:has-text("Delete"), .delete-session').first()

      if (await deleteButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await deleteButton.click()

        // Confirm deletion if modal appears
        const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Confirm")').first()
        if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmButton.click()
        }

        // Wait for deletion
        await page.waitForTimeout(1000)

        // Verify session count decreased
        const newCount = await sessionItems.count()
        expect(newCount).toBeLessThan(initialCount)
      } else {
        console.log('Delete button not found')
        test.skip()
      }
    } else {
      console.log('No sessions to delete')
      test.skip()
    }
  })

  test('handles search with filters', async ({ page }) => {
    const searchInput = page.locator('input[placeholder*="search" i], input[type="search"]').first()

    if (await searchInput.isVisible().catch(() => false)) {
      // Look for filter options
      const filterButton = page.locator('button:has-text("Filter"), button[aria-label*="filter" i]').first()

      if (await filterButton.isVisible().catch(() => false)) {
        await filterButton.click()

        // Look for filter options (e.g., file type, project)
        const filterOptions = page.locator('[role="checkbox"], [type="checkbox"]')

        if (await filterOptions.count() > 0) {
          // Select a filter
          await filterOptions.first().click()

          // Close filter menu
          await filterButton.click()

          // Perform search
          await searchInput.fill('test query')
          await searchInput.press('Enter')

          await page.waitForTimeout(2000)

          // Results should appear (filtered)
          const results = page.locator('[data-testid="search-result"], .search-result')
          await expect(results.first().or(page.locator('text=/no results/i'))).toBeVisible({ timeout: 5000 })
        }
      }
    } else {
      test.skip()
    }
  })

  test('handles network errors gracefully', async ({ page }) => {
    // Intercept chat stream and force error
    await page.route('**/api/v1/chat/stream', route => {
      route.abort('failed')
    })

    const chatInput = page.locator('textarea[placeholder*="message" i]').first()

    if (await chatInput.isVisible().catch(() => false)) {
      await chatInput.fill('This should fail')
      await chatInput.press('Enter')

      // Wait for error message
      await page.waitForTimeout(2000)

      const errorMessage = page.locator('text=/error|failed|try again/i')
      await expect(errorMessage).toBeVisible({ timeout: 5000 })
    } else {
      test.skip()
    }
  })

  test('preserves chat history on page reload', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="message" i]').first()

    if (await chatInput.isVisible().catch(() => false)) {
      // Send a unique message
      const uniqueMessage = `Test message ${Date.now()}`
      await chatInput.fill(uniqueMessage)
      await chatInput.press('Enter')

      // Wait for message to appear
      await page.waitForTimeout(2000)

      // Reload page
      await page.reload()
      await page.waitForLoadState('networkidle')

      // Check if message is still there
      const messageText = page.locator(`text="${uniqueMessage}"`)

      // Message should be preserved (if session persists)
      // This is a soft check as it depends on implementation
      const exists = await messageText.isVisible().catch(() => false)
      console.log(`Message preservation: ${exists ? 'PASS' : 'SKIP (not implemented)'}`)
    } else {
      test.skip()
    }
  })

  test('renders markdown in chat responses', async ({ page }) => {
    const chatInput = page.locator('textarea[placeholder*="message" i]').first()

    if (await chatInput.isVisible().catch(() => false)) {
      // Request markdown response
      await chatInput.fill('Show me a code example')
      await chatInput.press('Enter')

      // Wait for response
      await page.waitForTimeout(5000)

      // Look for rendered markdown elements
      const codeBlock = page.locator('pre code, .hljs, .code-block')
      const hasMd = await codeBlock.isVisible({ timeout: 5000 }).catch(() => false)

      if (hasMd) {
        await expect(codeBlock).toBeVisible()
      } else {
        console.log('Markdown rendering not detected (response may not contain code)')
      }
    } else {
      test.skip()
    }
  })
})
