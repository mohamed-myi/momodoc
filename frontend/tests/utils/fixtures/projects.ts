import type { Project } from '@/shared/renderer/lib/types'

export const mockProjects: Project[] = [
  {
    id: 'proj-1',
    name: 'Test Project 1',
    description: 'A test project for unit tests',
    source_directory: '/path/to/source',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    file_count: 5,
    note_count: 3,
    issue_count: 2,
    last_sync_at: '2024-01-01T00:00:00Z',
    last_sync_status: 'completed',
    sync_job_id: 'job-1',
  },
  {
    id: 'proj-2',
    name: 'Test Project 2',
    description: null,
    source_directory: null,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    file_count: 0,
    note_count: 0,
    issue_count: 0,
    last_sync_at: null,
    last_sync_status: null,
    sync_job_id: null,
  },
]

export const mockProject = mockProjects[0]
