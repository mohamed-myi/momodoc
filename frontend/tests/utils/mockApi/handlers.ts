import { http, HttpResponse } from 'msw'
import { mockProjects, mockProject } from '../fixtures/projects'
import { mockChatSessions, mockChatSession } from '../fixtures/chatSessions'
import { mockChatMessages } from '../fixtures/messages'

const baseUrl = ''

export const handlers = [
  // Session token
  http.get(`${baseUrl}/api/v1/token`, () => {
    return HttpResponse.json({ token: 'mock-session-token' })
  }),

  // Health check
  http.get(`${baseUrl}/api/v1/health`, () => {
    return HttpResponse.json({ status: 'ok' })
  }),

  // Projects
  http.get(`${baseUrl}/api/v1/projects`, ({ request }) => {
    const url = new URL(request.url)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const limit = parseInt(url.searchParams.get('limit') || '100')
    const results = mockProjects.slice(offset, offset + limit)
    return HttpResponse.json(results)
  }),

  http.get(`${baseUrl}/api/v1/projects/:id`, ({ params }) => {
    const project = mockProjects.find(p => p.id === params.id)
    if (!project) {
      return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
    }
    return HttpResponse.json(project)
  }),

  http.post(`${baseUrl}/api/v1/projects`, async ({ request }) => {
    const data = await request.json() as any
    const newProject = {
      id: `proj-${Date.now()}`,
      name: data.name,
      description: data.description || null,
      source_directory: data.source_directory || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      file_count: 0,
      note_count: 0,
      issue_count: 0,
      last_sync_at: null,
      last_sync_status: null,
      sync_job_id: null,
    }
    return HttpResponse.json(newProject, { status: 201 })
  }),

  http.patch(`${baseUrl}/api/v1/projects/:id`, async ({ params, request }) => {
    const data = await request.json() as any
    const project = mockProjects.find(p => p.id === params.id)
    if (!project) {
      return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
    }
    const updated = { ...project, ...data, updated_at: new Date().toISOString() }
    return HttpResponse.json(updated)
  }),

  http.delete(`${baseUrl}/api/v1/projects/:id`, ({ params }) => {
    const project = mockProjects.find(p => p.id === params.id)
    if (!project) {
      return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
    }
    return new HttpResponse(null, { status: 204 })
  }),

  // Files
  http.get(`${baseUrl}/api/v1/projects/:projectId/files`, () => {
    return HttpResponse.json([])
  }),

  http.post(`${baseUrl}/api/v1/projects/:projectId/files/upload`, async ({ request }) => {
    const formData = await request.formData()
    const file = formData.get('file') as File
    return HttpResponse.json({
      id: `file-${Date.now()}`,
      project_id: 'proj-1',
      filename: file.name,
      original_path: null,
      file_type: file.type || 'application/octet-stream',
      file_size: file.size,
      chunk_count: 0,
      indexed_at: null,
      created_at: new Date().toISOString(),
    })
  }),

  http.delete(`${baseUrl}/api/v1/projects/:projectId/files/:fileId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Notes
  http.get(`${baseUrl}/api/v1/projects/:projectId/notes`, () => {
    return HttpResponse.json([])
  }),

  http.post(`${baseUrl}/api/v1/projects/:projectId/notes`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      id: `note-${Date.now()}`,
      project_id: 'proj-1',
      content: data.content,
      tags: data.tags || null,
      chunk_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { status: 201 })
  }),

  http.patch(`${baseUrl}/api/v1/projects/:projectId/notes/:noteId`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      id: 'note-1',
      project_id: 'proj-1',
      content: data.content || 'Updated content',
      tags: data.tags || null,
      chunk_count: 0,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
    })
  }),

  http.delete(`${baseUrl}/api/v1/projects/:projectId/notes/:noteId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Issues
  http.get(`${baseUrl}/api/v1/projects/:projectId/issues`, () => {
    return HttpResponse.json([])
  }),

  http.post(`${baseUrl}/api/v1/projects/:projectId/issues`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      id: `issue-${Date.now()}`,
      project_id: 'proj-1',
      title: data.title,
      description: data.description || null,
      status: 'open',
      priority: data.priority || 'medium',
      chunk_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { status: 201 })
  }),

  http.patch(`${baseUrl}/api/v1/projects/:projectId/issues/:issueId`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      id: 'issue-1',
      project_id: 'proj-1',
      title: data.title || 'Updated issue',
      description: data.description || null,
      status: data.status || 'open',
      priority: data.priority || 'medium',
      chunk_count: 0,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
    })
  }),

  http.delete(`${baseUrl}/api/v1/projects/:projectId/issues/:issueId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Project Chat Sessions
  http.post(`${baseUrl}/api/v1/projects/:projectId/chat/sessions`, ({ params }) => {
    return HttpResponse.json({
      id: `session-${Date.now()}`,
      project_id: params.projectId,
      title: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { status: 201 })
  }),

  http.get(`${baseUrl}/api/v1/projects/:projectId/chat/sessions`, () => {
    return HttpResponse.json(mockChatSessions.filter(s => s.project_id === 'proj-1'))
  }),

  http.get(`${baseUrl}/api/v1/projects/:projectId/chat/sessions/:sessionId/messages`, () => {
    return HttpResponse.json(mockChatMessages)
  }),

  http.delete(`${baseUrl}/api/v1/projects/:projectId/chat/sessions/:sessionId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  http.patch(`${baseUrl}/api/v1/projects/:projectId/chat/sessions/:sessionId`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      ...mockChatSession,
      title: data.title,
      updated_at: new Date().toISOString(),
    })
  }),

  // Global Chat Sessions
  http.post(`${baseUrl}/api/v1/chat/sessions`, () => {
    return HttpResponse.json({
      id: `session-${Date.now()}`,
      project_id: null,
      title: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { status: 201 })
  }),

  http.get(`${baseUrl}/api/v1/chat/sessions`, () => {
    return HttpResponse.json(mockChatSessions.filter(s => s.project_id === null))
  }),

  http.get(`${baseUrl}/api/v1/chat/sessions/:sessionId/messages`, () => {
    return HttpResponse.json(mockChatMessages)
  }),

  http.delete(`${baseUrl}/api/v1/chat/sessions/:sessionId`, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  http.patch(`${baseUrl}/api/v1/chat/sessions/:sessionId`, async ({ request }) => {
    const data = await request.json() as any
    return HttpResponse.json({
      id: 'session-1',
      project_id: null,
      title: data.title,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: new Date().toISOString(),
    })
  }),

  // Search
  http.post(`${baseUrl}/api/v1/search`, () => {
    return HttpResponse.json([])
  }),

  // Sync
  http.post(`${baseUrl}/api/v1/projects/:projectId/sync`, () => {
    return HttpResponse.json({
      id: `job-${Date.now()}`,
      project_id: 'proj-1',
      status: 'pending',
      total_files: 0,
      processed_files: 0,
      completed_files: 0,
      succeeded_files: 0,
      skipped_files: 0,
      failed_files: 0,
      total_chunks: 0,
      current_file: '',
      errors: [],
      created_at: new Date().toISOString(),
      completed_at: null,
      error: null,
    }, { status: 201 })
  }),

  http.get(`${baseUrl}/api/v1/sync/jobs/:jobId`, () => {
    return HttpResponse.json({
      id: 'job-1',
      project_id: 'proj-1',
      status: 'completed',
      total_files: 5,
      processed_files: 5,
      completed_files: 5,
      succeeded_files: 5,
      skipped_files: 0,
      failed_files: 0,
      total_chunks: 15,
      current_file: '',
      errors: [],
      created_at: '2024-01-01T00:00:00Z',
      completed_at: '2024-01-01T00:01:00Z',
      error: null,
    })
  }),

  // LLM Providers
  http.get(`${baseUrl}/api/v1/llm/providers`, () => {
    return HttpResponse.json([
      { name: 'claude', available: true, model: 'claude-sonnet-4-6' },
      { name: 'openai', available: false, model: '' },
    ])
  }),

  // Directory browsing
  http.get(`${baseUrl}/api/v1/browse`, () => {
    return HttpResponse.json({
      current_path: '/home/user',
      parent_path: '/home',
      entries: [
        { name: 'Documents', path: '/home/user/Documents' },
        { name: 'Downloads', path: '/home/user/Downloads' },
      ],
    })
  }),
]
