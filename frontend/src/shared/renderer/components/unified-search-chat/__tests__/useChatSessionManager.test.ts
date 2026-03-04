import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useChatSessionManager } from '../useChatSessionManager'
import type { ChatSession, ChatMessage } from '@/lib/types'

describe('useChatSessionManager', () => {
  const mockCreateSessionApi = vi.fn()
  const mockGetSessionsApi = vi.fn()
  const mockGetMessagesApi = vi.fn()
  const mockDeleteSessionApi = vi.fn()
  const mockUpdateSessionApi = vi.fn()
  const mockOnResetChat = vi.fn()
  const mockOnMessagesLoaded = vi.fn()

  const mockSession: ChatSession = {
    id: 'session-1',
    project_id: 'proj-1',
    title: 'Test Session',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }

  const mockSessions: ChatSession[] = [
    mockSession,
    {
      id: 'session-2',
      project_id: 'proj-1',
      title: 'Another Session',
      created_at: '2024-01-02T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
    },
  ]

  const mockMessages: ChatMessage[] = [
    {
      id: 'msg-1',
      session_id: 'session-1',
      role: 'user',
      content: 'Hello',
      sources: [],
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'msg-2',
      session_id: 'session-1',
      role: 'assistant',
      content: 'Hi there',
      sources: [],
      created_at: '2024-01-01T00:00:01Z',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionsApi.mockResolvedValue(mockSessions)
    mockGetMessagesApi.mockResolvedValue(mockMessages)
    mockCreateSessionApi.mockResolvedValue(mockSession)
    mockDeleteSessionApi.mockResolvedValue(undefined)
    mockUpdateSessionApi.mockResolvedValue({ ...mockSession, title: 'Updated' })
  })

  it('should initialize with loading state and fetch sessions', async () => {
    const { result } = renderHook(() =>
      useChatSessionManager({
        createSessionApi: mockCreateSessionApi,
        getSessionsApi: mockGetSessionsApi,
        getMessagesApi: mockGetMessagesApi,
        deleteSessionApi: mockDeleteSessionApi,
        updateSessionApi: mockUpdateSessionApi,
        onResetChat: mockOnResetChat,
        onMessagesLoaded: mockOnMessagesLoaded,
      })
    )

    expect(result.current.loadingSessions).toBe(true)

    await waitFor(() => {
      expect(result.current.loadingSessions).toBe(false)
      expect(result.current.sessions).toEqual(mockSessions)
    })

    expect(mockGetSessionsApi).toHaveBeenCalled()
  })

  it('should handle sessions fetch error gracefully', async () => {
    mockGetSessionsApi.mockRejectedValue(new Error('Failed to fetch'))

    const { result } = renderHook(() =>
      useChatSessionManager({
        createSessionApi: mockCreateSessionApi,
        getSessionsApi: mockGetSessionsApi,
        getMessagesApi: mockGetMessagesApi,
        deleteSessionApi: mockDeleteSessionApi,
        updateSessionApi: mockUpdateSessionApi,
        onResetChat: mockOnResetChat,
        onMessagesLoaded: mockOnMessagesLoaded,
      })
    )

    await waitFor(() => {
      expect(result.current.loadingSessions).toBe(false)
      expect(result.current.sessions).toEqual([])
    })
  })

  describe('loadSession', () => {
    it('should load session and messages', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBe('session-1')
        expect(mockGetMessagesApi).toHaveBeenCalledWith('session-1')
        expect(mockOnMessagesLoaded).toHaveBeenCalledWith(
          mockMessages.map(msg => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            sources: msg.sources,
          }))
        )
      })
    })

    it('should clear messages before loading new ones', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        // Should be called twice: once with [], once with messages
        expect(mockOnMessagesLoaded).toHaveBeenCalledTimes(2)
        expect(mockOnMessagesLoaded).toHaveBeenNthCalledWith(1, [])
      })
    })

    it('should handle message loading errors gracefully', async () => {
      mockGetMessagesApi.mockRejectedValue(new Error('Failed to load messages'))

      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBe('session-1')
        // Should still be called with empty array
        expect(mockOnMessagesLoaded).toHaveBeenCalledWith([])
      })
    })
  })

  describe('startNewChat', () => {
    it('should reset session and call onResetChat', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      // Load a session first
      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBe('session-1')
      })

      // Start new chat
      act(() => {
        result.current.startNewChat()
      })

      expect(result.current.sessionId).toBeNull()
      expect(mockOnResetChat).toHaveBeenCalled()
    })
  })

  describe('ensureSession', () => {
    it('should return existing session id if available', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBe('session-1')
      })

      let sessionId: string
      await act(async () => {
        sessionId = await result.current.ensureSession()
      })

      expect(sessionId!).toBe('session-1')
      expect(mockCreateSessionApi).not.toHaveBeenCalled()
    })

    it('should create new session if none exists', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      let sessionId: string
      await act(async () => {
        sessionId = await result.current.ensureSession()
      })

      expect(sessionId!).toBe('session-1')
      expect(mockCreateSessionApi).toHaveBeenCalled()
      expect(result.current.sessionId).toBe('session-1')
    })

    it('should add newly created session to sessions list', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.ensureSession()
      })

      await waitFor(() => {
        expect(result.current.sessions).toContainEqual(mockSession)
      })
    })
  })

  describe('deleteSession', () => {
    it('should require confirmation before deleting', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      // First call sets deleting state
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })

      expect(result.current.deletingSessionId).toBe('session-1')
      expect(mockDeleteSessionApi).not.toHaveBeenCalled()
    })

    it('should delete session on second call', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      // First call
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })

      // Second call
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })

      await waitFor(() => {
        expect(mockDeleteSessionApi).toHaveBeenCalledWith('session-1')
        expect(result.current.deletingSessionId).toBeNull()
        expect(result.current.sessions).not.toContainEqual(
          expect.objectContaining({ id: 'session-1' })
        )
      })
    })

    it('should start new chat if deleting current session', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      await act(async () => {
        await result.current.loadSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBe('session-1')
      })

      // Delete current session
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })

      await waitFor(() => {
        expect(result.current.sessionId).toBeNull()
        expect(mockOnResetChat).toHaveBeenCalled()
      })
    })
  })

  describe('renaming', () => {
    it('should start renaming and populate rename value', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      act(() => {
        result.current.startRenaming(mockSession)
      })

      expect(result.current.renamingSessionId).toBe('session-1')
      expect(result.current.renameValue).toBe('Test Session')
      expect(result.current.deletingSessionId).toBeNull()
    })

    it('should cancel renaming', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      act(() => {
        result.current.startRenaming(mockSession)
      })
      act(() => {
        result.current.cancelRenaming()
      })

      expect(result.current.renamingSessionId).toBeNull()
      expect(result.current.renameValue).toBe('')
    })

    it('should update session title on rename', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      act(() => {
        result.current.startRenaming(mockSession)
      })
      act(() => {
        result.current.setRenameValue('New Title')
      })

      await act(async () => {
        await result.current.handleRename()
      })

      await waitFor(() => {
        expect(mockUpdateSessionApi).toHaveBeenCalledWith('session-1', {
          title: 'New Title',
        })
        expect(result.current.renamingSessionId).toBeNull()
      })
    })

    it('should not rename if value is empty', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      act(() => {
        result.current.startRenaming(mockSession)
      })
      act(() => {
        result.current.setRenameValue('   ')
      })

      await act(async () => {
        await result.current.handleRename()
      })

      expect(mockUpdateSessionApi).not.toHaveBeenCalled()
    })
  })

  describe('handleSessionMouseLeave', () => {
    it('should clear hovered session', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      act(() => {
        result.current.setHoveredSessionId('session-1')
      })
      act(() => {
        result.current.handleSessionMouseLeave('session-1')
      })

      expect(result.current.hoveredSessionId).toBeNull()
    })

    it('should clear deleting state on mouse leave', async () => {
      const { result } = renderHook(() =>
        useChatSessionManager({
          createSessionApi: mockCreateSessionApi,
          getSessionsApi: mockGetSessionsApi,
          getMessagesApi: mockGetMessagesApi,
          deleteSessionApi: mockDeleteSessionApi,
          updateSessionApi: mockUpdateSessionApi,
          onResetChat: mockOnResetChat,
          onMessagesLoaded: mockOnMessagesLoaded,
        })
      )

      await waitFor(() => {
        expect(result.current.loadingSessions).toBe(false)
      })

      // Set deleting state
      await act(async () => {
        await result.current.handleDeleteSession('session-1')
      })
      expect(result.current.deletingSessionId).toBe('session-1')

      // Mouse leave should clear it
      act(() => {
        result.current.handleSessionMouseLeave('session-1')
      })

      expect(result.current.deletingSessionId).toBeNull()
    })
  })
})
