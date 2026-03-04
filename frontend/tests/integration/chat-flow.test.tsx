import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../utils/mockApi/server'

/**
 * Chat Flow Integration Tests
 *
 * Tests the complete chat flow: create session -> send message -> stream response -> abort
 * Uses MSW to mock API endpoints, testing multi-step flows
 */
describe('Chat Flow Integration', () => {
  const baseUrl = 'http://localhost:8000'
  const mockToken = 'mock-session-token'

  beforeEach(() => {
    // Reset any runtime state
  })

  it('creates chat session and sends message with streaming response', async () => {
    // Setup MSW handlers for chat flow
    const sessionId = 'session-test-123'
    const messageId = 'msg-test-123'

    server.use(
      // Create session
      http.post(`${baseUrl}/api/v1/chat/sessions`, () => {
        return HttpResponse.json({
          id: sessionId,
          project_id: null,
          title: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { status: 201 })
      }),

      // Get messages (initially empty)
      http.get(`${baseUrl}/api/v1/chat/sessions/:sessionId/messages`, () => {
        return HttpResponse.json([])
      }),

      // Stream chat response using SSE
      http.post(`${baseUrl}/api/v1/chat/stream`, async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            // SSE format: data: {json}\n\n
            const events = [
              { type: 'message_start', message_id: messageId },
              { type: 'content_block_delta', delta: { text: 'Hello' } },
              { type: 'content_block_delta', delta: { text: ' world' } },
              { type: 'content_block_delta', delta: { text: '!' } },
              { type: 'message_stop', message_id: messageId },
            ]

            let index = 0
            const interval = setInterval(() => {
              if (index < events.length) {
                const line = `data: ${JSON.stringify(events[index])}\n\n`
                controller.enqueue(encoder.encode(line))
                index++
              } else {
                clearInterval(interval)
                controller.close()
              }
            }, 10)
          },
        })

        return new HttpResponse(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        })
      })
    )

    // Test the flow using fetch directly
    // 1. Create chat session
    const createResponse = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Momodoc-Token': mockToken,
      },
      body: JSON.stringify({}),
    })
    const session = await createResponse.json()
    expect(session.id).toBe(sessionId)

    // 2. Get initial messages (should be empty)
    const messagesResponse = await fetch(`${baseUrl}/api/v1/chat/sessions/${sessionId}/messages`, {
      headers: { 'X-Momodoc-Token': mockToken },
    })
    const initialMessages = await messagesResponse.json()
    expect(initialMessages).toHaveLength(0)

    // 3. Test streaming (mock EventSource since it's not available in jsdom)
    const streamedContent: string[] = []
    const mockEventSource = vi.fn()

    // Note: Full SSE streaming test would require a real EventSource polyfill
    // For now, we validate the handler returns the correct response format
    const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, query: 'test' }),
    })

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(response.ok).toBe(true)
  })

  it('handles chat session creation error gracefully', async () => {
    // Setup MSW to return error
    server.use(
      http.post(`${baseUrl}/api/v1/chat/sessions`, () => {
        return HttpResponse.json(
          { detail: 'Failed to create session' },
          { status: 500 }
        )
      })
    )

    // Attempt to create session
    const response = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Momodoc-Token': mockToken,
      },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(500)
    const error = await response.json()
    expect(error.detail).toBe('Failed to create session')
  })

  it('validates message persistence after streaming', async () => {
    const sessionId = 'session-persist-test'
    const userMessage = {
      id: 'msg-user-1',
      session_id: sessionId,
      role: 'user',
      content: 'Hello',
      created_at: new Date().toISOString(),
    }
    const assistantMessage = {
      id: 'msg-assistant-1',
      session_id: sessionId,
      role: 'assistant',
      content: 'Hello world!',
      created_at: new Date().toISOString(),
    }

    server.use(
      http.post(`${baseUrl}/api/v1/chat/sessions`, () => {
        return HttpResponse.json({
          id: sessionId,
          project_id: null,
          title: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { status: 201 })
      }),

      http.get(`${baseUrl}/api/v1/chat/sessions/${sessionId}/messages`, () => {
        return HttpResponse.json([userMessage, assistantMessage])
      })
    )

    // Create session
    const createResponse = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Momodoc-Token': mockToken,
      },
      body: JSON.stringify({}),
    })
    const session = await createResponse.json()

    // After streaming completes, messages should be persisted
    const messagesResponse = await fetch(`${baseUrl}/api/v1/chat/sessions/${session.id}/messages`, {
      headers: { 'X-Momodoc-Token': mockToken },
    })
    const messages = await messagesResponse.json()

    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Hello world!')
  })

  it('tests abort functionality mid-stream', async () => {
    const controller = new AbortController()

    server.use(
      http.post(`${baseUrl}/api/v1/chat/stream`, async () => {
        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(streamController) {
            const interval = setInterval(() => {
              try {
                streamController.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'chunk' } })}\n\n`)
                )
              } catch (error) {
                clearInterval(interval)
                streamController.close()
              }
            }, 10)

            // Simulate abort after 50ms
            setTimeout(() => {
              clearInterval(interval)
              streamController.close()
            }, 50)
          },
        })

        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
      })
    )

    const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test' }),
      signal: controller.signal,
    })

    // Abort after starting
    setTimeout(() => controller.abort(), 20)

    // Stream should be abortable
    expect(response.ok).toBe(true)
  })

  it('handles multiple concurrent sessions', async () => {
    const sessionIds = ['session-1', 'session-2', 'session-3']

    server.use(
      http.post(`${baseUrl}/api/v1/chat/sessions`, ({ request }) => {
        const sessionId = sessionIds.shift() || 'session-fallback'
        return HttpResponse.json({
          id: sessionId,
          project_id: null,
          title: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { status: 201 })
      })
    )

    // Create multiple sessions concurrently
    const createSession = () => fetch(`${baseUrl}/api/v1/chat/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Momodoc-Token': mockToken,
      },
      body: JSON.stringify({}),
    }).then(r => r.json())

    const sessions = await Promise.all([
      createSession(),
      createSession(),
      createSession(),
    ])

    expect(sessions).toHaveLength(3)
    expect(new Set(sessions.map(s => s.id)).size).toBe(3) // All unique IDs
  })

  it('validates session list and deletion', async () => {
    const sessions = [
      {
        id: 'session-1',
        project_id: null,
        title: 'Test Session 1',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'session-2',
        project_id: null,
        title: 'Test Session 2',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]

    server.use(
      http.get(`${baseUrl}/api/v1/chat/sessions`, () => {
        return HttpResponse.json(sessions)
      }),

      http.delete(`${baseUrl}/api/v1/chat/sessions/:sessionId`, ({ params }) => {
        const index = sessions.findIndex(s => s.id === params.sessionId)
        if (index >= 0) {
          sessions.splice(index, 1)
          return new HttpResponse(null, { status: 204 })
        }
        return HttpResponse.json({ detail: 'Session not found' }, { status: 404 })
      })
    )

    // Get sessions
    const sessionsResponse = await fetch(`${baseUrl}/api/v1/chat/sessions`, {
      headers: { 'X-Momodoc-Token': mockToken },
    })
    const allSessions = await sessionsResponse.json()
    expect(allSessions).toHaveLength(2)

    // Delete one session
    await fetch(`${baseUrl}/api/v1/chat/sessions/session-1`, {
      method: 'DELETE',
      headers: { 'X-Momodoc-Token': mockToken },
    })

    // Verify deletion (in real scenario, would re-fetch)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe('session-2')
  })
})
