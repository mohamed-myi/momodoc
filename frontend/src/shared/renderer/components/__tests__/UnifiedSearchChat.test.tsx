import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { UnifiedSearchChat } from '../UnifiedSearchChat'
import { server } from '@tests/utils/mockApi/server'
import { http, HttpResponse } from 'msw'
import { mockChatSessions } from '@tests/utils/fixtures/chatSessions'
import { mockChatMessages } from '@tests/utils/fixtures/messages'

// Mock the api module
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual('@/lib/api')
  return {
    ...actual,
    getApiBaseUrl: vi.fn().mockResolvedValue(''),
    getToken: vi.fn().mockResolvedValue('test-token'),
  }
})

describe('UnifiedSearchChat', () => {
  const mockOnProjectScores = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render chat interface', async () => {
    render(<UnifiedSearchChat projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ask about this project/i)).toBeInTheDocument()
    })
  })

  it('should render search placeholder in search mode', async () => {
    // Set localStorage to search mode
    localStorage.setItem('momodoc-llm-mode-proj-1', 'search')

    render(<UnifiedSearchChat projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search this project/i)).toBeInTheDocument()
    })
  })

  it('should load sessions on mount', async () => {
    render(<UnifiedSearchChat projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      expect(screen.getByText('Test Session 2')).toBeInTheDocument()
    })
  })

  it('should load global sessions when isGlobal is true', async () => {
    render(<UnifiedSearchChat isGlobal={true} />)

    await waitFor(() => {
      expect(screen.getByText('Global Session')).toBeInTheDocument()
    })
  })

  describe('Mode Switching', () => {
    it('should switch between chat and search mode', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      // Open mode dropdown
      const modeButton = await screen.findByRole('button', { name: /Select AI model/i })
      await user.click(modeButton)

      // Select search mode
      const searchOption = await screen.findByText('Search only')
      await user.click(searchOption)

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Search this project/i)).toBeInTheDocument()
      })
    })

    it('should persist mode selection in localStorage', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      // Open mode dropdown
      const modeButton = await screen.findByRole('button', { name: /Select AI model/i })
      await user.click(modeButton)

      // Select search mode
      const searchOption = await screen.findByText('Search only')
      await user.click(searchOption)

      await waitFor(() => {
        expect(localStorage.getItem('momodoc-llm-mode-proj-1')).toBe('search')
      })
    })

    it('should load mode from localStorage on mount', () => {
      localStorage.setItem('momodoc-llm-mode-proj-1', 'search')

      render(<UnifiedSearchChat projectId="proj-1" />)

      expect(screen.getByPlaceholderText(/Search this project/i)).toBeInTheDocument()
    })
  })

  describe('Session Management', () => {
    it('should load session when clicking on it', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })

      const sessionButton = screen.getByText('Test Session 1')
      await user.click(sessionButton)

      await waitFor(() => {
        // Messages should be loaded
        expect(screen.getByText(/What does the hello function do/i)).toBeInTheDocument()
      })
    })

    it('should create new session when starting new chat', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })

      // Click the new chat button
      const newChatButton = screen.getByRole('button', { name: /new chat/i })
      await user.click(newChatButton)

      // Session should be cleared
      await waitFor(() => {
        const textarea = screen.getByRole('textbox')
        expect(textarea).toHaveValue('')
      })
    })

    it('should load requested session on mount', async () => {
      render(<UnifiedSearchChat projectId="proj-1" requestedSessionId="session-1" />)

      await waitFor(() => {
        expect(screen.getByText(/What does the hello function do/i)).toBeInTheDocument()
      })
    })

    it('should delete session after confirmation', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })

      // Hover over session to show delete button
      const sessionItem = screen.getByText('Test Session 1').closest('button')
      await user.hover(sessionItem!)

      // Click delete button once for confirmation
      const deleteButton = screen.getAllByRole('button', { name: /delete/i })[0]
      await user.click(deleteButton)

      // Click again to confirm
      const confirmDeleteButton = screen.getByRole('button', { name: /delete\?/i })
      await user.click(confirmDeleteButton)

      await waitFor(() => {
        expect(screen.queryByText('Test Session 1')).not.toBeInTheDocument()
      })
    })
  })

  describe('Search Functionality', () => {
    it('should perform search in search mode', async () => {
      const user = userEvent.setup()
      localStorage.setItem('momodoc-llm-mode-proj-1', 'search')

      // Mock search endpoint
      server.use(
        http.post('/api/v1/projects/proj-1/search', () => {
          return HttpResponse.json({
            results: [
              {
                source_type: 'file',
                source_id: 'file-1',
                filename: 'test.py',
                original_path: '/test.py',
                chunk_text: 'test code',
                chunk_index: 0,
                score: 0.95,
                project_id: 'proj-1',
              },
            ],
          })
        })
      )

      render(<UnifiedSearchChat projectId="proj-1" />)

      const textarea = await screen.findByPlaceholderText(/Search this project/i)
      await user.type(textarea, 'test query')

      const sendButton = screen.getByRole('button', { name: /submit/i })
      await user.click(sendButton)

      await waitFor(() => {
        expect(screen.getByText('1 result')).toBeInTheDocument()
      })
    })

    it('should calculate project scores in global search', async () => {
      const user = userEvent.setup()
      localStorage.setItem('momodoc-llm-mode-global', 'search')

      // Mock search endpoint
      server.use(
        http.post('/api/v1/search', () => {
          return HttpResponse.json([
            {
              source_type: 'file',
              source_id: 'file-1',
              filename: 'test.py',
              chunk_text: 'test',
              score: 0.95,
              project_id: 'proj-1',
            },
            {
              source_type: 'file',
              source_id: 'file-2',
              filename: 'test2.py',
              chunk_text: 'test',
              score: 0.87,
              project_id: 'proj-2',
            },
          ])
        })
      )

      render(<UnifiedSearchChat isGlobal={true} onProjectScores={mockOnProjectScores} />)

      const textarea = await screen.findByPlaceholderText(/Search all projects/i)
      await user.type(textarea, 'test query')

      const sendButton = screen.getByRole('button', { name: /submit/i })
      await user.click(sendButton)

      await waitFor(() => {
        expect(mockOnProjectScores).toHaveBeenCalledWith({
          'proj-1': 1,
          'proj-2': 1,
        })
      })
    })
  })

  describe('Chat Streaming', () => {
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should send message and stream response', async () => {
      const user = userEvent.setup()

      // Mock fetch for streaming — pass through non-stream requests to MSW
      const streamMock = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder()
            controller.enqueue(encoder.encode('event: token\ndata: {"token":"Hello"}\n\n'))
            controller.enqueue(encoder.encode('event: token\ndata: {"token":" world"}\n\n'))
            controller.enqueue(encoder.encode('event: done\ndata: {"message_id":"msg-1"}\n\n'))
            controller.close()
          },
        }),
      })
      global.fetch = vi.fn((...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
        if (url.includes('/stream')) return streamMock(...args)
        return originalFetch(...args)
      }) as typeof fetch

      render(<UnifiedSearchChat projectId="proj-1" />)

      const textarea = await screen.findByPlaceholderText(/Ask about this project/i)
      await user.type(textarea, 'test message')

      const sendButton = screen.getByRole('button', { name: /submit/i })
      await user.click(sendButton)

      await waitFor(() => {
        expect(screen.getByText('Hello world')).toBeInTheDocument()
      })
    })

    it('should show stop button while streaming', async () => {
      const user = userEvent.setup()

      // Mock long-running stream — pass through non-stream requests to MSW
      const streamMock = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start() {
            // Never close to simulate ongoing stream
          },
        }),
      })
      global.fetch = vi.fn((...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
        if (url.includes('/stream')) return streamMock(...args)
        return originalFetch(...args)
      }) as typeof fetch

      render(<UnifiedSearchChat projectId="proj-1" />)

      const textarea = await screen.findByPlaceholderText(/Ask about this project/i)
      await user.type(textarea, 'test message')

      const sendButton = screen.getByRole('button', { name: /submit/i })
      await user.click(sendButton)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
      })
    })
  })

  describe('Context Toggle', () => {
    it('should toggle include history', async () => {
      const user = userEvent.setup()
      render(<UnifiedSearchChat projectId="proj-1" />)

      const contextToggle = await screen.findByText('ctx')
      await user.click(contextToggle.closest('label')!)

      const toggle = screen.getByRole('switch')
      expect(toggle).toBeChecked()
    })

    it('should not show context toggle in search mode', () => {
      localStorage.setItem('momodoc-llm-mode-proj-1', 'search')

      render(<UnifiedSearchChat projectId="proj-1" />)

      expect(screen.queryByText('ctx')).not.toBeInTheDocument()
    })
  })

  describe('Session Sidebar', () => {
    it('should show sessions sidebar by default', async () => {
      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })
    })

    it('should hide sessions in search mode', () => {
      localStorage.setItem('momodoc-llm-mode-proj-1', 'search')

      render(<UnifiedSearchChat projectId="proj-1" />)

      expect(screen.queryByText('Test Session 1')).not.toBeInTheDocument()
    })

    it('should persist session width in localStorage', async () => {
      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })

      // Session width should be stored in localStorage
      const storedWidth = localStorage.getItem('momodoc-session-width')
      expect(storedWidth).toBeTruthy()
    })
  })

  describe('Provider Loading', () => {
    it('should load available providers on mount', async () => {
      render(<UnifiedSearchChat projectId="proj-1" />)

      const modeButton = await screen.findByRole('button', { name: /Select AI model/i })
      await userEvent.click(modeButton)

      await waitFor(() => {
        expect(screen.getByText('Claude')).toBeInTheDocument()
      })
    })
  })

  describe('Keyboard Shortcuts', () => {
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should submit on Enter key', async () => {
      const user = userEvent.setup()

      const streamMock = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      })
      global.fetch = vi.fn((...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
        if (url.includes('/stream')) return streamMock(...args)
        return originalFetch(...args)
      }) as typeof fetch

      render(<UnifiedSearchChat projectId="proj-1" />)

      const textarea = await screen.findByPlaceholderText(/Ask about this project/i)
      await user.type(textarea, 'test message')
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(streamMock).toHaveBeenCalled()
      })
    })

    it('should add newline on Shift+Enter', async () => {
      const user = userEvent.setup()

      const streamMock = vi.fn()
      global.fetch = vi.fn((...args: Parameters<typeof fetch>) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url
        if (url.includes('/stream')) return streamMock(...args)
        return originalFetch(...args)
      }) as typeof fetch

      render(<UnifiedSearchChat projectId="proj-1" />)

      const textarea = await screen.findByPlaceholderText(/Ask about this project/i)
      await user.type(textarea, 'line 1')
      await user.keyboard('{Shift>}{Enter}{/Shift}')
      await user.type(textarea, 'line 2')

      // Should not submit
      expect(streamMock).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle session loading errors gracefully', async () => {
      // Mock error response
      server.use(
        http.get('/api/v1/projects/proj-1/chat/sessions', () => {
          return HttpResponse.json({ detail: 'Error' }, { status: 500 })
        })
      )

      render(<UnifiedSearchChat projectId="proj-1" />)

      // Should still render without crashing
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/Ask about this project/i)).toBeInTheDocument()
      })
    })

    it('should handle message loading errors gracefully', async () => {
      const user = userEvent.setup()

      // Mock error response for messages
      server.use(
        http.get(
          '/api/v1/projects/proj-1/chat/sessions/:sessionId/messages',
          () => {
            return HttpResponse.json({ detail: 'Error' }, { status: 500 })
          }
        )
      )

      render(<UnifiedSearchChat projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('Test Session 1')).toBeInTheDocument()
      })

      const sessionButton = screen.getByText('Test Session 1')
      await user.click(sessionButton)

      // Should handle error without crashing
      await waitFor(() => {
        const textarea = screen.getByRole('textbox')
        expect(textarea).toBeInTheDocument()
      })
    })
  })
})
