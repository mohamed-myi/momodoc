import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRendererApiClient, ApiError, type RendererApiBootstrap } from '../apiClientCore'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../../tests/utils/mockApi/server'

describe('apiClientCore', () => {
  const mockBootstrap: RendererApiBootstrap = {
    getBaseUrl: vi.fn().mockResolvedValue(''),
    getToken: vi.fn().mockResolvedValue('test-token-123'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('request function', () => {
    it('includes auth token in headers', async () => {
      let receivedHeaders: Headers | undefined
      server.use(
        http.get('/api/v1/test', ({ request }) => {
          receivedHeaders = request.headers
          return HttpResponse.json({ ok: true })
        })
      )

      const { request } = createRendererApiClient(mockBootstrap)
      await request('/api/v1/test')

      expect(receivedHeaders?.get('X-Momodoc-Token')).toBe('test-token-123')
    })

    it('includes Content-Type JSON header by default', async () => {
      let receivedHeaders: Headers | undefined
      server.use(
        http.get('/api/v1/test', ({ request }) => {
          receivedHeaders = request.headers
          return HttpResponse.json({ ok: true })
        })
      )

      const { request } = createRendererApiClient(mockBootstrap)
      await request('/api/v1/test')

      expect(receivedHeaders?.get('Content-Type')).toBe('application/json')
    })

    it('throws ApiError on non-ok responses', async () => {
      server.use(
        http.get('/api/v1/test', () => {
          return HttpResponse.json({ detail: 'Not found' }, { status: 404 })
        })
      )

      const { request } = createRendererApiClient(mockBootstrap)

      await expect(request('/api/v1/test')).rejects.toThrow(ApiError)
      await expect(request('/api/v1/test')).rejects.toMatchObject({
        status: 404,
        message: 'Not found',
      })
    })

    it('handles 204 No Content responses', async () => {
      server.use(
        http.delete('/api/v1/test', () => {
          return new HttpResponse(null, { status: 204 })
        })
      )

      const { request } = createRendererApiClient(mockBootstrap)
      const result = await request('/api/v1/test', { method: 'DELETE' })
      expect(result).toEqual({})
    })

    it('handles errors without detail field', async () => {
      server.use(
        http.get('/api/v1/test', () => {
          return new HttpResponse('Server error', { status: 500 })
        })
      )

      const { request } = createRendererApiClient(mockBootstrap)
      await expect(request('/api/v1/test')).rejects.toMatchObject({
        status: 500,
        message: 'Request failed',
      })
    })
  })

  describe('api.getProjects', () => {
    it('fetches projects without pagination params', async () => {
      const { api } = createRendererApiClient(mockBootstrap)
      const projects = await api.getProjects()
      expect(projects).toHaveLength(2)
      expect(projects[0].id).toBe('proj-1')
    })

    it('includes pagination params when provided', async () => {
      let requestUrl: URL | undefined
      server.use(
        http.get('/api/v1/projects', ({ request }) => {
          requestUrl = new URL(request.url)
          return HttpResponse.json([])
        })
      )

      const { api } = createRendererApiClient(mockBootstrap)
      await api.getProjects(10, 20)

      expect(requestUrl?.searchParams.get('offset')).toBe('10')
      expect(requestUrl?.searchParams.get('limit')).toBe('20')
    })
  })

  describe('api.createProject', () => {
    it('creates a new project', async () => {
      const { api } = createRendererApiClient(mockBootstrap)
      const project = await api.createProject({
        name: 'Test Project',
        description: 'A test',
      })
      expect(project.name).toBe('Test Project')
      expect(project.id).toBeDefined()
    })
  })

  describe('api.uploadFile', () => {
    it('sets multipart/form-data Content-Type for file upload', async () => {
      let receivedHeaders: Headers | undefined
      server.use(
        http.post('/api/v1/projects/:projectId/files/upload', ({ request }) => {
          receivedHeaders = request.headers
          return HttpResponse.json({
            id: 'file-1',
            project_id: 'proj-1',
            filename: 'test.txt',
            file_type: 'text/plain',
            file_size: 100,
            chunk_count: 0,
            original_path: null,
            indexed_at: null,
            created_at: new Date().toISOString(),
          })
        })
      )

      const { api } = createRendererApiClient(mockBootstrap)
      const file = new File(['content'], 'test.txt')
      await api.uploadFile('proj-1', file)

      // FormData sets its own Content-Type with boundary
      expect(receivedHeaders?.get('Content-Type')).toContain('multipart/form-data')
    })
  })

  describe('api.createSession', () => {
    it('creates project chat session', async () => {
      const { api } = createRendererApiClient(mockBootstrap)
      const session = await api.createSession('proj-1')
      expect(session.project_id).toBe('proj-1')
      expect(session.id).toBeDefined()
    })
  })

  describe('api.createGlobalSession', () => {
    it('creates global chat session', async () => {
      const { api } = createRendererApiClient(mockBootstrap)
      const session = await api.createGlobalSession()
      expect(session.project_id).toBeNull()
      expect(session.id).toBeDefined()
    })
  })

  describe('api.search', () => {
    it('searches without project_id', async () => {
      let requestPath: string | undefined
      server.use(
        http.post('/api/v1/search', ({ request }) => {
          requestPath = new URL(request.url).pathname
          return HttpResponse.json([])
        })
      )

      const { api } = createRendererApiClient(mockBootstrap)
      await api.search('test query')
      expect(requestPath).toBe('/api/v1/search')
    })

    it('searches with project_id', async () => {
      let requestPath: string | undefined
      server.use(
        http.post('/api/v1/projects/:projectId/search', ({ request }) => {
          requestPath = new URL(request.url).pathname
          return HttpResponse.json([])
        })
      )

      const { api } = createRendererApiClient(mockBootstrap)
      await api.search('test query', 'proj-1')
      expect(requestPath).toBe('/api/v1/projects/proj-1/search')
    })
  })

  describe('api.getProviders', () => {
    it('fetches LLM providers', async () => {
      const { api } = createRendererApiClient(mockBootstrap)
      const providers = await api.getProviders()
      expect(providers).toHaveLength(2)
      expect(providers[0].name).toBe('claude')
    })
  })

  describe('bootstrap integration', () => {
    it('calls getBaseUrl and getToken on each request', async () => {
      const bootstrap: RendererApiBootstrap = {
        getBaseUrl: vi.fn().mockResolvedValue(''),
        getToken: vi.fn().mockResolvedValue('token-456'),
      }

      const { api } = createRendererApiClient(bootstrap)
      await api.getProjects()

      expect(bootstrap.getBaseUrl).toHaveBeenCalled()
      expect(bootstrap.getToken).toHaveBeenCalled()
    })

    it('waits for both getBaseUrl and getToken in parallel', async () => {
      const delays: string[] = []
      const bootstrap: RendererApiBootstrap = {
        getBaseUrl: vi.fn(async () => {
          delays.push('baseUrl-start')
          await new Promise(r => setTimeout(r, 10))
          delays.push('baseUrl-end')
          return ''
        }),
        getToken: vi.fn(async () => {
          delays.push('token-start')
          await new Promise(r => setTimeout(r, 10))
          delays.push('token-end')
          return 'token'
        }),
      }

      const { api } = createRendererApiClient(bootstrap)
      await api.getProjects()

      // Should start both before waiting for either
      expect(delays.indexOf('baseUrl-start')).toBeLessThan(delays.indexOf('baseUrl-end'))
      expect(delays.indexOf('token-start')).toBeLessThan(delays.indexOf('token-end'))
    })
  })
})
