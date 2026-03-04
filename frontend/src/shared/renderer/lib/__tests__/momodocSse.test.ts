import { describe, it, expect, vi } from 'vitest'
import { parseSSEEvents, dispatchMomodocSSEEvent, type MomodocSSEEventHandlers } from '../momodocSse'

describe('momodocSse', () => {
  describe('parseSSEEvents', () => {
    it('parses simple SSE events', () => {
      const chunk = 'event: test\ndata: hello\n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({ event: 'test', data: 'hello' })
      expect(result.remainder).toBe('')
    })

    it('parses multiple events', () => {
      const chunk = 'event: sources\ndata: []\n\nevent: token\ndata: {"token":"Hi"}\n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events).toHaveLength(2)
      expect(result.events[0]).toEqual({ event: 'sources', data: '[]' })
      expect(result.events[1]).toEqual({ event: 'token', data: '{"token":"Hi"}' })
    })

    it('handles incomplete events as remainder', () => {
      const chunk = 'event: test\ndata: hello\n\nevent: incomplete\ndata: partial'
      const result = parseSSEEvents(chunk)
      expect(result.events).toHaveLength(1)
      expect(result.remainder).toBe('event: incomplete\ndata: partial')
    })

    it('handles default "message" event when no event type specified', () => {
      const chunk = 'data: hello world\n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events[0].event).toBe('message')
      expect(result.events[0].data).toBe('hello world')
    })

    it('normalizes CRLF line endings', () => {
      const chunk = 'event: test\r\ndata: hello\r\n\r\n'
      const result = parseSSEEvents(chunk)
      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toEqual({ event: 'test', data: 'hello' })
    })

    it('joins multi-line data with newlines', () => {
      const chunk = 'event: test\ndata: line1\ndata: line2\ndata: line3\n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events[0].data).toBe('line1\nline2\nline3')
    })

    it('skips empty events', () => {
      const chunk = '\n\nevent: test\ndata: hello\n\n\n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events).toHaveLength(1)
    })

    it('trims whitespace after colon in data lines', () => {
      const chunk = 'data:   hello world   \n\n'
      const result = parseSSEEvents(chunk)
      expect(result.events[0].data).toBe('hello world   ')
    })
  })

  describe('dispatchMomodocSSEEvent', () => {
    it('calls onSources with array payload for sources event', () => {
      const handlers: MomodocSSEEventHandlers = {
        onSources: vi.fn(),
      }
      const event = { event: 'sources', data: '["source1", "source2"]' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onSources).toHaveBeenCalledWith(['source1', 'source2'])
    })

    it('calls onInvalidSources when sources is not an array', () => {
      const handlers: MomodocSSEEventHandlers = {
        onInvalidSources: vi.fn(),
      }
      const event = { event: 'sources', data: '{"not":"array"}' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onInvalidSources).toHaveBeenCalledWith({ not: 'array' })
    })

    it('calls onToken with token string', () => {
      const handlers: MomodocSSEEventHandlers = {
        onToken: vi.fn(),
      }
      const event = { event: 'content_block_delta', data: '{"token":"Hello"}' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onToken).toHaveBeenCalledWith('Hello')
    })

    it('calls onRetrievalMetadata with parsed metadata object', () => {
      const handlers: MomodocSSEEventHandlers = {
        onRetrievalMetadata: vi.fn(),
      }
      const metadata = { query_plan: { type: 'CONCEPTUAL', hyde: true }, candidates_fetched: 50 }
      const event = { event: 'retrieval_metadata', data: JSON.stringify(metadata) }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onRetrievalMetadata).toHaveBeenCalledWith(metadata)
    })

    it('calls onDone with message_id', () => {
      const handlers: MomodocSSEEventHandlers = {
        onDone: vi.fn(),
      }
      const event = { event: 'done', data: '{"message_id":"msg-123"}' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onDone).toHaveBeenCalledWith('msg-123')
    })

    it('calls onError with error string', () => {
      const handlers: MomodocSSEEventHandlers = {
        onError: vi.fn(),
      }
      const event = { event: 'error', data: '{"error":"Something went wrong"}' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onError).toHaveBeenCalledWith('Something went wrong')
    })

    it('uses errorFallbackMessage when error event has no error field', () => {
      const handlers: MomodocSSEEventHandlers = {
        onError: vi.fn(),
      }
      const event = { event: 'error', data: '{}' }
      dispatchMomodocSSEEvent(event, handlers, { errorFallbackMessage: 'Default error' })
      expect(handlers.onError).toHaveBeenCalledWith('Default error')
    })

    it('calls onMalformedJson when data is not valid JSON', () => {
      const handlers: MomodocSSEEventHandlers = {
        onMalformedJson: vi.fn(),
      }
      const event = { event: 'token', data: 'not valid json' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onMalformedJson).toHaveBeenCalledWith('not valid json')
    })

    it('ignores events with empty data', () => {
      const handlers: MomodocSSEEventHandlers = {
        onToken: vi.fn(),
      }
      const event = { event: 'token', data: '  ' }
      dispatchMomodocSSEEvent(event, handlers)
      expect(handlers.onToken).not.toHaveBeenCalled()
    })

    it('does not call handlers if they are not provided', () => {
      const event = { event: 'token', data: '{"token":"test"}' }
      // Should not throw
      expect(() => dispatchMomodocSSEEvent(event, {})).not.toThrow()
    })

    it('handles token in various event types', () => {
      const handlers: MomodocSSEEventHandlers = {
        onToken: vi.fn(),
      }
      const events = [
        { event: 'content_block_delta', data: '{"token":"A"}' },
        { event: 'message_delta', data: '{"token":"B"}' },
        { event: 'unknown_event', data: '{"token":"C"}' },
      ]
      events.forEach(evt => dispatchMomodocSSEEvent(evt, handlers))
      expect(handlers.onToken).toHaveBeenCalledTimes(3)
      expect(handlers.onToken).toHaveBeenNthCalledWith(1, 'A')
      expect(handlers.onToken).toHaveBeenNthCalledWith(2, 'B')
      expect(handlers.onToken).toHaveBeenNthCalledWith(3, 'C')
    })
  })
})
