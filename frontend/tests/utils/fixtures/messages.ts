import type { ChatMessage, ChatSource } from '@/shared/renderer/lib/types'

export const mockChatSources: ChatSource[] = [
  {
    source_type: 'file',
    source_id: 'file-1',
    filename: 'example.py',
    original_path: '/path/to/example.py',
    chunk_text: 'def hello():\n    print("Hello, world!")',
    chunk_index: 0,
    score: 0.95,
  },
  {
    source_type: 'note',
    source_id: 'note-1',
    filename: null,
    original_path: null,
    chunk_text: 'Important note about the implementation',
    chunk_index: 0,
    score: 0.87,
  },
]

export const mockChatMessages: ChatMessage[] = [
  {
    id: 'msg-1',
    session_id: 'session-1',
    role: 'user',
    content: 'What does the hello function do?',
    sources: [],
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    session_id: 'session-1',
    role: 'assistant',
    content: 'The hello function prints "Hello, world!" to the console.',
    sources: mockChatSources,
    created_at: '2024-01-01T00:00:01Z',
  },
]
