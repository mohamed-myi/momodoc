import { describe, it, expect, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../utils/mockApi/server'

/**
 * Project CRUD Integration Tests
 *
 * Tests complete project lifecycle using MSW mock handlers
 * Validates state transitions across multiple API calls
 */
describe('Project CRUD Integration', () => {
  const baseUrl = 'http://localhost:8000'
  const mockToken = 'mock-session-token'

  // Helper functions to make API calls with fetch
  const apiCall = async (path: string, options?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Momodoc-Token': mockToken,
        ...options?.headers,
      },
    })
    if (response.status === 204) return {}
    return response.json()
  }

  const api = {
    createProject: (data: any) => apiCall('/api/v1/projects', { method: 'POST', body: JSON.stringify(data) }),
    getProject: (id: string) => apiCall(`/api/v1/projects/${id}`),
    updateProject: (id: string, data: any) => apiCall(`/api/v1/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    deleteProject: async (id: string) => {
      await fetch(`${baseUrl}/api/v1/projects/${id}`, {
        method: 'DELETE',
        headers: { 'X-Momodoc-Token': mockToken },
      })
    },
    uploadFile: async (projectId: string, file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/upload`, {
        method: 'POST',
        headers: { 'X-Momodoc-Token': mockToken },
        body: formData,
      })
      return response.json()
    },
    getFiles: (projectId: string) => apiCall(`/api/v1/projects/${projectId}/files`),
    deleteFile: async (projectId: string, fileId: string) => {
      await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'X-Momodoc-Token': mockToken },
      })
    },
    getProjects: (offset?: number, limit?: number) => {
      const params = new URLSearchParams()
      if (offset !== undefined) params.set('offset', String(offset))
      if (limit !== undefined) params.set('limit', String(limit))
      const qs = params.toString()
      return apiCall(`/api/v1/projects${qs ? `?${qs}` : ''}`)
    },
    createNote: (projectId: string, data: any) => apiCall(`/api/v1/projects/${projectId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
    getNotes: (projectId: string) => apiCall(`/api/v1/projects/${projectId}/notes`),
    createIssue: (projectId: string, data: any) => apiCall(`/api/v1/projects/${projectId}/issues`, { method: 'POST', body: JSON.stringify(data) }),
    getIssues: (projectId: string) => apiCall(`/api/v1/projects/${projectId}/issues`),
  }

  beforeEach(() => {
    // Reset to clean state
  })

  it.skip('completes full project lifecycle: create -> upload file -> view -> delete file -> delete project', { timeout: 10000 }, async () => {
    // SKIP: File upload with FormData doesn't work reliably in jsdom
    // This is better tested in E2E tests with real browser
    const projectId = 'proj-integration-test'
    const fileId = 'file-integration-test'
    let createdProject: any = null
    let uploadedFile: any = null
    let projectFiles: any[] = []

    // Setup handlers for full lifecycle
    server.use(
      // 1. Create project
      http.post(`${baseUrl}/api/v1/projects`, async ({ request }) => {
        const data = await request.json() as any
        createdProject = {
          id: projectId,
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
        return HttpResponse.json(createdProject, { status: 201 })
      }),

      // 2. Upload file
      http.post(`${baseUrl}/api/v1/projects/:projectId/files/upload`, async ({ request, params }) => {
        const formData = await request.formData()
        const file = formData.get('file') as File

        uploadedFile = {
          id: fileId,
          project_id: params.projectId,
          filename: file.name,
          original_path: null,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          chunk_count: 0,
          indexed_at: null,
          created_at: new Date().toISOString(),
        }

        projectFiles.push(uploadedFile)

        if (createdProject) {
          createdProject.file_count++
        }

        return HttpResponse.json(uploadedFile, { status: 201 })
      }),

      // 3. View project details
      http.get(`${baseUrl}/api/v1/projects/${projectId}`, () => {
        if (!createdProject) {
          return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
        }
        return HttpResponse.json(createdProject)
      }),

      // Get project files
      http.get(`${baseUrl}/api/v1/projects/${projectId}/files`, () => {
        return HttpResponse.json(projectFiles)
      }),

      // 4. Delete file
      http.delete(`${baseUrl}/api/v1/projects/:projectId/files/:fileId`, ({ params }) => {
        const index = projectFiles.findIndex(f => f.id === params.fileId)
        if (index >= 0) {
          projectFiles.splice(index, 1)
          if (createdProject) {
            createdProject.file_count--
          }
          return new HttpResponse(null, { status: 204 })
        }
        return HttpResponse.json({ detail: 'File not found' }, { status: 404 })
      }),

      // 5. Delete project
      http.delete(`${baseUrl}/api/v1/projects/${projectId}`, () => {
        if (!createdProject) {
          return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
        }
        createdProject = null
        return new HttpResponse(null, { status: 204 })
      })
    )


    // 1. Create project
    const project = await api.createProject({
      name: 'Integration Test Project',
      description: 'A project for testing the full lifecycle',
    })

    expect(project.id).toBe(projectId)
    expect(project.name).toBe('Integration Test Project')
    expect(project.file_count).toBe(0)

    // 2. Upload file
    const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
    const uploadedFileRecord = await api.uploadFile(projectId, file)

    expect(uploadedFileRecord.id).toBe(fileId)
    expect(uploadedFileRecord.filename).toBe('test.txt')
    expect(uploadedFileRecord.project_id).toBe(projectId)

    // 3. View project details (should show file_count = 1)
    const projectDetails = await api.getProject(projectId)
    expect(projectDetails.file_count).toBe(1)

    // Get files
    const files = await api.getFiles(projectId)
    expect(files).toHaveLength(1)
    expect(files[0].filename).toBe('test.txt')

    // 4. Delete file
    await api.deleteFile(projectId, fileId)

    // Verify file deleted
    const filesAfterDelete = await api.getFiles(projectId)
    expect(filesAfterDelete).toHaveLength(0)

    // Project should reflect updated file count
    const projectAfterFileDelete = await api.getProject(projectId)
    expect(projectAfterFileDelete.file_count).toBe(0)

    // 5. Delete project
    await api.deleteProject(projectId)

    // Verify project deleted (should return 404)
    await expect(api.getProject(projectId)).rejects.toThrow('Project not found')
  })

  it.skip('handles concurrent file uploads to same project', { timeout: 10000 }, async () => {
    // SKIP: File upload with FormData doesn't work reliably in jsdom
    // This is better tested in E2E tests with real browser
    const projectId = 'proj-concurrent-test'
    const uploadedFiles: any[] = []

    server.use(
      http.post(`${baseUrl}/api/v1/projects/${projectId}/files/upload`, async ({ request }) => {
        const formData = await request.formData()
        const file = formData.get('file') as File

        const fileRecord = {
          id: `file-${Date.now()}-${Math.random()}`,
          project_id: projectId,
          filename: file.name,
          original_path: null,
          file_type: file.type || 'application/octet-stream',
          file_size: file.size,
          chunk_count: 0,
          indexed_at: null,
          created_at: new Date().toISOString(),
        }

        uploadedFiles.push(fileRecord)
        return HttpResponse.json(fileRecord, { status: 201 })
      })
    )


    // Upload multiple files concurrently
    const files = [
      new File(['content 1'], 'file1.txt', { type: 'text/plain' }),
      new File(['content 2'], 'file2.txt', { type: 'text/plain' }),
      new File(['content 3'], 'file3.txt', { type: 'text/plain' }),
    ]

    const results = await Promise.all(
      files.map(file => api.uploadFile(projectId, file))
    )

    expect(results).toHaveLength(3)
    expect(uploadedFiles).toHaveLength(3)
    expect(new Set(results.map(r => r.id)).size).toBe(3) // All unique IDs
    expect(results.map(r => r.filename).sort()).toEqual(['file1.txt', 'file2.txt', 'file3.txt'])
  })

  it('validates project update flow', async () => {
    const projectId = 'proj-update-test'
    let project = {
      id: projectId,
      name: 'Original Name',
      description: 'Original Description',
      source_directory: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      file_count: 0,
      note_count: 0,
      issue_count: 0,
      last_sync_at: null,
      last_sync_status: null,
      sync_job_id: null,
    }

    server.use(
      http.get(`${baseUrl}/api/v1/projects/${projectId}`, () => {
        return HttpResponse.json(project)
      }),

      http.patch(`${baseUrl}/api/v1/projects/${projectId}`, async ({ request }) => {
        const data = await request.json() as any
        project = {
          ...project,
          ...data,
          updated_at: new Date().toISOString(),
        }
        return HttpResponse.json(project)
      })
    )


    // Get initial project
    const initialProject = await api.getProject(projectId)
    expect(initialProject.name).toBe('Original Name')

    // Update project
    const updatedProject = await api.updateProject(projectId, {
      name: 'Updated Name',
      description: 'Updated Description',
    })

    expect(updatedProject.name).toBe('Updated Name')
    expect(updatedProject.description).toBe('Updated Description')
    expect(updatedProject.id).toBe(projectId)

    // Verify update persisted
    const refetchedProject = await api.getProject(projectId)
    expect(refetchedProject.name).toBe('Updated Name')
  })

  it('handles pagination when listing projects', async () => {
    const totalProjects = 25
    const allProjects = Array.from({ length: totalProjects }, (_, i) => ({
      id: `proj-${i}`,
      name: `Project ${i}`,
      description: null,
      source_directory: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      file_count: 0,
      note_count: 0,
      issue_count: 0,
      last_sync_at: null,
      last_sync_status: null,
      sync_job_id: null,
    }))

    server.use(
      http.get(`${baseUrl}/api/v1/projects`, ({ request }) => {
        const url = new URL(request.url)
        const offset = parseInt(url.searchParams.get('offset') || '0')
        const limit = parseInt(url.searchParams.get('limit') || '10')
        const results = allProjects.slice(offset, offset + limit)
        return HttpResponse.json(results)
      })
    )


    // Get first page
    const page1 = await api.getProjects(0, 10)
    expect(page1).toHaveLength(10)
    expect(page1[0].name).toBe('Project 0')

    // Get second page
    const page2 = await api.getProjects(10, 10)
    expect(page2).toHaveLength(10)
    expect(page2[0].name).toBe('Project 10')

    // Get third page (only 5 items)
    const page3 = await api.getProjects(20, 10)
    expect(page3).toHaveLength(5)
    expect(page3[0].name).toBe('Project 20')

    // Get beyond range
    const page4 = await api.getProjects(100, 10)
    expect(page4).toHaveLength(0)
  })

  it('validates notes and issues integration with project', async () => {
    const projectId = 'proj-content-test'
    const notes: any[] = []
    const issues: any[] = []

    server.use(
      http.post(`${baseUrl}/api/v1/projects/${projectId}/notes`, async ({ request }) => {
        const data = await request.json() as any
        const note = {
          id: `note-${Date.now()}`,
          project_id: projectId,
          content: data.content,
          tags: data.tags || null,
          chunk_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        notes.push(note)
        return HttpResponse.json(note, { status: 201 })
      }),

      http.get(`${baseUrl}/api/v1/projects/${projectId}/notes`, () => {
        return HttpResponse.json(notes)
      }),

      http.post(`${baseUrl}/api/v1/projects/${projectId}/issues`, async ({ request }) => {
        const data = await request.json() as any
        const issue = {
          id: `issue-${Date.now()}`,
          project_id: projectId,
          title: data.title,
          description: data.description || null,
          status: 'open',
          priority: data.priority || 'medium',
          chunk_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        issues.push(issue)
        return HttpResponse.json(issue, { status: 201 })
      }),

      http.get(`${baseUrl}/api/v1/projects/${projectId}/issues`, () => {
        return HttpResponse.json(issues)
      })
    )


    // Create note
    const note = await api.createNote(projectId, {
      content: 'Test note content',
      tags: 'tag1,tag2',
    })

    expect(note.project_id).toBe(projectId)
    expect(note.content).toBe('Test note content')

    // Create issue
    const issue = await api.createIssue(projectId, {
      title: 'Test issue',
      description: 'Issue description',
      priority: 'high',
    })

    expect(issue.project_id).toBe(projectId)
    expect(issue.title).toBe('Test issue')
    expect(issue.priority).toBe('high')

    // Verify both are listed
    const projectNotes = await api.getNotes(projectId)
    expect(projectNotes).toHaveLength(1)

    const projectIssues = await api.getIssues(projectId)
    expect(projectIssues).toHaveLength(1)
  })

  it('handles project deletion with cascading effects', async () => {
    const projectId = 'proj-cascade-test'
    let projectExists = true
    const files: any[] = [
      { id: 'file-1', project_id: projectId, filename: 'test1.txt' },
      { id: 'file-2', project_id: projectId, filename: 'test2.txt' },
    ]

    server.use(
      http.get(`${baseUrl}/api/v1/projects/${projectId}`, () => {
        if (!projectExists) {
          return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
        }
        return HttpResponse.json({
          id: projectId,
          name: 'Cascade Test',
          description: null,
          source_directory: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          file_count: files.length,
          note_count: 0,
          issue_count: 0,
          last_sync_at: null,
          last_sync_status: null,
          sync_job_id: null,
        })
      }),

      http.get(`${baseUrl}/api/v1/projects/${projectId}/files`, () => {
        if (!projectExists) {
          return HttpResponse.json({ detail: 'Project not found' }, { status: 404 })
        }
        return HttpResponse.json(files)
      }),

      http.delete(`${baseUrl}/api/v1/projects/${projectId}`, () => {
        projectExists = false
        files.length = 0 // Simulate cascade delete
        return new HttpResponse(null, { status: 204 })
      })
    )


    // Verify project and files exist
    const project = await api.getProject(projectId)
    expect(project.file_count).toBe(2)

    const projectFiles = await api.getFiles(projectId)
    expect(projectFiles).toHaveLength(2)

    // Delete project
    await api.deleteProject(projectId)

    // Verify cascade: project and files should be gone
    const projectAfterDelete = await fetch(`${baseUrl}/api/v1/projects/${projectId}`, {
      headers: { 'X-Momodoc-Token': mockToken },
    })
    expect(projectAfterDelete.status).toBe(404)

    const filesAfterDelete = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files`, {
      headers: { 'X-Momodoc-Token': mockToken },
    })
    expect(filesAfterDelete.status).toBe(404)
  })
})
