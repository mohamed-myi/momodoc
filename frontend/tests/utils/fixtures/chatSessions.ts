import type { ChatSession } from '@/shared/renderer/lib/types'

export const mockChatSessions: ChatSession[] = [
  {
    id: 'session-1',
    project_id: 'proj-1',
    title: 'Test Session 1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'session-2',
    project_id: 'proj-1',
    title: 'Test Session 2',
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
  {
    id: 'global-session-1',
    project_id: null,
    title: 'Global Session',
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
  },
]

export const mockChatSession = mockChatSessions[0]
export const mockGlobalChatSession = mockChatSessions[2]
