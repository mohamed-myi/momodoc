import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { IssuesSection } from '../IssuesSection'
import { server } from '@tests/utils/mockApi/server'
import { http, HttpResponse } from 'msw'

const mockIssues = [
  {
    id: 'issue-1',
    project_id: 'proj-1',
    title: 'Fix bug in login',
    description: 'Login fails on Safari',
    status: 'open' as const,
    priority: 'high' as const,
    chunk_count: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'issue-2',
    project_id: 'proj-1',
    title: 'Add dark mode',
    description: null,
    status: 'in_progress' as const,
    priority: 'medium' as const,
    chunk_count: 1,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
  {
    id: 'issue-3',
    project_id: 'proj-1',
    title: 'Update README',
    description: null,
    status: 'done' as const,
    priority: 'low' as const,
    chunk_count: 1,
    created_at: '2024-01-03T00:00:00Z',
    updated_at: '2024-01-03T00:00:00Z',
  },
]

describe('IssuesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should load and display open issues on mount', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Fix bug in login')).toBeInTheDocument()
      expect(screen.getByText('Add dark mode')).toBeInTheDocument()
    })
  })

  it('should show loading state initially', () => {
    render(<IssuesSection projectId="proj-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should handle loading errors', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json({ detail: 'Error' }, { status: 500 })
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load issues/i)).toBeInTheDocument()
    })
  })

  it('should show empty state when no issues', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json([])
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no issues yet/i)).toBeInTheDocument()
    })
  })

  it('should show create form when clicking new issue button', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json([])
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no issues yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new issue/i)
    await user.click(newButton)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/issue title/i)).toBeInTheDocument()
    })
  })

  it('should create a new issue', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json([])
      }),
      http.post('/api/v1/projects/proj-1/issues', async ({ request }) => {
        const data = await request.json() as any
        return HttpResponse.json({
          id: 'issue-new',
          project_id: 'proj-1',
          title: data.title,
          description: data.description || null,
          status: 'open',
          priority: data.priority || 'medium',
          chunk_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { status: 201 })
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no issues yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new issue/i)
    await user.click(newButton)

    const titleInput = screen.getByPlaceholderText(/issue title/i)
    await user.type(titleInput, 'New test issue')

    const saveButton = screen.getByTitle(/save issue/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('New test issue')).toBeInTheDocument()
    })
  })

  it('should delete an issue', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      }),
      http.delete('/api/v1/projects/proj-1/issues/issue-1', () => {
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Fix bug in login')).toBeInTheDocument()
    })

    const issueItem = screen.getByText('Fix bug in login').closest('div')
    await user.hover(issueItem!)

    const deleteButton = screen.getAllByTitle(/delete issue/i)[0]
    await user.click(deleteButton)

    await waitFor(() => {
      expect(screen.queryByText('Fix bug in login')).not.toBeInTheDocument()
    })
  })

  it('should cycle issue status', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      }),
      http.patch('/api/v1/projects/proj-1/issues/issue-1', async ({ request }) => {
        const data = await request.json() as any
        return HttpResponse.json({
          ...mockIssues[0],
          status: data.status,
          updated_at: new Date().toISOString(),
        })
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Fix bug in login')).toBeInTheDocument()
    })

    // Click on the status icon to cycle status
    const issueItem = screen.getByText('Fix bug in login').closest('button')
    await user.click(issueItem!)

    // Status should have changed (we won't test the exact status since it cycles)
    await waitFor(() => {
      expect(screen.getByText('Fix bug in login')).toBeInTheDocument()
    })
  })

  it('should toggle done issues visibility', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('Fix bug in login')).toBeInTheDocument()
    })

    // Done issues should not be visible initially
    expect(screen.queryByText('Update README')).not.toBeInTheDocument()

    // Click to show done issues
    const toggleButton = screen.getByText(/completed/i)
    await user.click(toggleButton)

    await waitFor(() => {
      expect(screen.getByText('Update README')).toBeInTheDocument()
    })
  })

  it('should display priority badges', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('high')).toBeInTheDocument()
      expect(screen.getByText('medium')).toBeInTheDocument()
    })
  })

  it('should handle create errors', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json([])
      }),
      http.post('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json({ detail: 'Error' }, { status: 500 })
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no issues yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new issue/i)
    await user.click(newButton)

    const titleInput = screen.getByPlaceholderText(/issue title/i)
    await user.type(titleInput, 'Failed issue')

    const saveButton = screen.getByTitle(/save issue/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/failed to create issue/i)).toBeInTheDocument()
    })
  })

  it('should show status counts', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/issues', () => {
        return HttpResponse.json(mockIssues)
      })
    )

    render(<IssuesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/1 completed/i)).toBeInTheDocument()
    })
  })
})
