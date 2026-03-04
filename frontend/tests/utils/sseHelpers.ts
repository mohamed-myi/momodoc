import { vi } from 'vitest'

export interface MockSSEEvent {
  event?: string
  data: string
  id?: string
}

export class MockEventSource {
  url: string
  readyState: number = 0
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null

  private listeners: Map<string, Set<EventListener>> = new Map()

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  constructor(url: string) {
    this.url = url
    this.readyState = MockEventSource.CONNECTING
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  close() {
    this.readyState = MockEventSource.CLOSED
  }

  // Test helper to simulate events
  simulateOpen() {
    this.readyState = MockEventSource.OPEN
    const event = new Event('open')
    this.onopen?.(event)
    this.listeners.get('open')?.forEach(listener => listener(event))
  }

  simulateMessage(data: string, eventType?: string, id?: string) {
    const event = new MessageEvent('message', {
      data,
      lastEventId: id || '',
    })

    if (eventType && eventType !== 'message') {
      // Custom event type
      this.listeners.get(eventType)?.forEach(listener => listener(event))
    } else {
      // Standard message event
      this.onmessage?.(event)
      this.listeners.get('message')?.forEach(listener => listener(event))
    }
  }

  simulateError() {
    this.readyState = MockEventSource.CLOSED
    const event = new Event('error')
    this.onerror?.(event)
    this.listeners.get('error')?.forEach(listener => listener(event))
  }
}

export function createMockEventSource() {
  const instances: MockEventSource[] = []

  const MockEventSourceConstructor = vi.fn((url: string) => {
    const instance = new MockEventSource(url)
    instances.push(instance)
    return instance
  })

  // Copy static properties
  MockEventSourceConstructor.CONNECTING = MockEventSource.CONNECTING
  MockEventSourceConstructor.OPEN = MockEventSource.OPEN
  MockEventSourceConstructor.CLOSED = MockEventSource.CLOSED

  return {
    MockEventSource: MockEventSourceConstructor as any,
    instances,
    getLatest: () => instances[instances.length - 1],
  }
}

export function simulateSSEStream(
  eventSource: MockEventSource,
  events: MockSSEEvent[],
  options: { delay?: number; autoClose?: boolean } = {}
) {
  const { delay = 10, autoClose = true } = options

  return new Promise<void>((resolve) => {
    eventSource.simulateOpen()

    const sendEvents = async () => {
      for (const event of events) {
        await new Promise(r => setTimeout(r, delay))
        eventSource.simulateMessage(event.data, event.event, event.id)
      }

      if (autoClose) {
        eventSource.close()
      }
      resolve()
    }

    sendEvents()
  })
}

export const mockChatStreamEvents: MockSSEEvent[] = [
  { event: 'message_start', data: JSON.stringify({ message_id: 'msg-1' }) },
  { event: 'content_block_start', data: JSON.stringify({ index: 0 }) },
  { event: 'content_block_delta', data: JSON.stringify({ delta: { text: 'Hello' } }) },
  { event: 'content_block_delta', data: JSON.stringify({ delta: { text: ' world' } }) },
  { event: 'content_block_delta', data: JSON.stringify({ delta: { text: '!' } }) },
  { event: 'content_block_stop', data: JSON.stringify({ index: 0 }) },
  { event: 'message_stop', data: JSON.stringify({}) },
  { event: 'done', data: JSON.stringify({ message_id: 'msg-1' }) },
]
