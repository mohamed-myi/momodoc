import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useChatStreaming } from '../useChatStreaming'
import { api, getToken } from '@/lib/api'

// Mock the API module
vi.mock('@/lib/api', () => ({
  api: {
    search: vi.fn(),
  },
  getToken: vi.fn(),
  getApiBaseUrl: vi.fn().mockResolvedValue(''),
}))

describe('useChatStreaming', () => {
  const mockEnsureSession = vi.fn()
  const mockGetStreamUrl = vi.fn()
  const mockOnProjectScores = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockEnsureSession.mockResolvedValue('session-123')
    mockGetStreamUrl.mockResolvedValue('http://localhost:8000/stream')
    vi.mocked(getToken).mockResolvedValue('test-token')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should initialize with empty messages and not loading', () => {
    const { result } = renderHook(() =>
      useChatStreaming({
        projectId: 'proj-1',
        isGlobal: false,
        onProjectScores: mockOnProjectScores,
        includeHistory: false,
        llmMode: 'gemini',
        ensureSession: mockEnsureSession,
        getStreamUrl: mockGetStreamUrl,
      })
    )

    expect(result.current.messages).toEqual([])
    expect(result.current.isLoading).toBe(false)
  })

  it('should reset messages', () => {
    const { result } = renderHook(() =>
      useChatStreaming({
        projectId: 'proj-1',
        isGlobal: false,
        onProjectScores: mockOnProjectScores,
        includeHistory: false,
        llmMode: 'gemini',
        ensureSession: mockEnsureSession,
        getStreamUrl: mockGetStreamUrl,
      })
    )

    // Add a message first
    act(() => {
      result.current.replaceMessages([
        { id: '1', role: 'user', content: 'Test' },
      ])
    })

    // Reset
    act(() => {
      result.current.resetMessages()
    })

    expect(result.current.messages).toEqual([])
  })

  it('should replace messages', async () => {
    const { result } = renderHook(() =>
      useChatStreaming({
        projectId: 'proj-1',
        isGlobal: false,
        onProjectScores: mockOnProjectScores,
        includeHistory: false,
        llmMode: 'gemini',
        ensureSession: mockEnsureSession,
        getStreamUrl: mockGetStreamUrl,
      })
    )

    const newMessages = [
      { id: '1', role: 'user' as const, content: 'Hello' },
      { id: '2', role: 'assistant' as const, content: 'Hi there' },
    ]

    act(() => {
      result.current.replaceMessages(newMessages)
    })

    expect(result.current.messages).toEqual(newMessages)
  })

  describe('searchOnly', () => {
    it('should perform search and update messages', async () => {
      const mockSearchResults = [
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
      ]

      vi.mocked(api.search).mockResolvedValue(mockSearchResults)

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'search',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.searchOnly('test query')
      })

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2)
        expect(result.current.messages[0].role).toBe('user')
        expect(result.current.messages[0].content).toBe('test query')
        expect(result.current.messages[1].role).toBe('assistant')
        expect(result.current.messages[1].content).toBe('Found 1 result')
        expect(result.current.messages[1].searchResults).toEqual(mockSearchResults)
      })

      expect(api.search).toHaveBeenCalledWith('test query', 'proj-1')
    })

    it('should handle no search results', async () => {
      vi.mocked(api.search).mockResolvedValue([])

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'search',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.searchOnly('no results')
      })

      await waitFor(() => {
        expect(result.current.messages[1].content).toBe('No results found for "no results"')
      })
    })

    it('should calculate project scores for global search', async () => {
      const mockSearchResults = [
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
        {
          source_type: 'file',
          source_id: 'file-2',
          filename: 'test2.py',
          original_path: '/test2.py',
          chunk_text: 'test code 2',
          chunk_index: 0,
          score: 0.87,
          project_id: 'proj-1',
        },
        {
          source_type: 'file',
          source_id: 'file-3',
          filename: 'test3.py',
          original_path: '/test3.py',
          chunk_text: 'test code 3',
          chunk_index: 0,
          score: 0.82,
          project_id: 'proj-2',
        },
      ]

      vi.mocked(api.search).mockResolvedValue(mockSearchResults)

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: undefined,
          isGlobal: true,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'search',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.searchOnly('test query')
      })

      await waitFor(() => {
        expect(mockOnProjectScores).toHaveBeenCalledWith({
          'proj-1': 2,
          'proj-2': 1,
        })
      })
    })

    it('should handle search errors', async () => {
      vi.mocked(api.search).mockRejectedValue(new Error('Search failed'))

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'search',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.searchOnly('error query')
      })

      await waitFor(() => {
        expect(result.current.messages[1].content).toBe('Search failed. Please try again.')
        expect(result.current.isLoading).toBe(false)
      })
    })
  })

  describe('sendMessage', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn()
      global.fetch = mockFetch
    })

    it('should ensure session before sending', async () => {
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test message')
      })

      await waitFor(() => {
        expect(mockEnsureSession).toHaveBeenCalled()
      })
    })

    it('should add user and assistant messages immediately', async () => {
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('Hello')
      })

      await waitFor(() => {
        expect(result.current.messages).toHaveLength(2)
        expect(result.current.messages[0].role).toBe('user')
        expect(result.current.messages[0].content).toBe('Hello')
        expect(result.current.messages[1].role).toBe('assistant')
        expect(result.current.messages[1].isStreaming).toBe(false)
      })
    })

    it('should stream tokens and update assistant message', async () => {
      const encoder = new TextEncoder()
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: token\ndata: {"token":"Hello"}\n\n'))
          controller.enqueue(encoder.encode('event: token\ndata: {"token":" world"}\n\n'))
          controller.enqueue(encoder.encode('event: done\ndata: {"message_id":"msg-1"}\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test')
      })

      await waitFor(() => {
        const assistantMsg = result.current.messages.find(m => m.role === 'assistant')
        expect(assistantMsg?.content).toBe('Hello world')
        expect(assistantMsg?.isStreaming).toBe(false)
      })
    })

    it('should handle sources in stream', async () => {
      const encoder = new TextEncoder()
      const mockSources = [
        {
          source_type: 'file',
          source_id: 'file-1',
          filename: 'test.py',
          chunk_text: 'code',
          score: 0.95,
        },
      ]

      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(`event: sources\ndata: ${JSON.stringify(mockSources)}\n\n`)
          )
          controller.enqueue(encoder.encode('event: token\ndata: {"token":"Response"}\n\n'))
          controller.enqueue(encoder.encode('event: done\ndata: {"message_id":"msg-1"}\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test')
      })

      await waitFor(() => {
        const assistantMsg = result.current.messages.find(m => m.role === 'assistant')
        expect(assistantMsg?.sources).toEqual(mockSources)
      })
    })

    it('should handle stream errors', async () => {
      const encoder = new TextEncoder()
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: error\ndata: {"error":"API error"}\n\n'))
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test')
      })

      await waitFor(() => {
        const assistantMsg = result.current.messages.find(m => m.role === 'assistant')
        expect(assistantMsg?.content).toContain('failed to get response')
      })
    })

    it('should handle fetch failures', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test')
      })

      await waitFor(() => {
        const assistantMsg = result.current.messages.find(m => m.role === 'assistant')
        expect(assistantMsg?.content).toContain('failed to get response')
        expect(result.current.isLoading).toBe(false)
      })
    })

    it('should include history and llm_mode in request', async () => {
      const mockReadableStream = new ReadableStream({
        start(controller) {
          controller.close()
        },
      })

      mockFetch.mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: true,
          llmMode: 'claude',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      await act(async () => {
        await result.current.sendMessage('test')
      })

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:8000/stream',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              query: 'test',
              include_history: true,
              llm_mode: 'claude',
            }),
          })
        )
      })
    })
  })

  describe('stopStreaming', () => {
    it('should abort ongoing stream', async () => {
      const encoder = new TextEncoder()

      const mockReadableStream = new ReadableStream({
        start(controller) {
          // Never emit anything, simulating a stuck stream
        },
      })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        body: mockReadableStream,
      })

      global.fetch = mockFetch

      const { result } = renderHook(() =>
        useChatStreaming({
          projectId: 'proj-1',
          isGlobal: false,
          onProjectScores: mockOnProjectScores,
          includeHistory: false,
          llmMode: 'gemini',
          ensureSession: mockEnsureSession,
          getStreamUrl: mockGetStreamUrl,
        })
      )

      // Start streaming
      let sendPromise: Promise<void>
      act(() => {
        sendPromise = result.current.sendMessage('test')
      })

      // Wait for loading state
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true)
      })

      // Stop streaming
      act(() => {
        result.current.stopStreaming()
      })

      // Wait for the send to complete (it will be aborted)
      await act(async () => {
        await sendPromise!.catch(() => {})
      })

      // Should stop loading after abort
      expect(result.current.isLoading).toBe(false)
    })
  })
})
