import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { NotesSection } from '../NotesSection'
import { server } from '@tests/utils/mockApi/server'
import { http, HttpResponse } from 'msw'

const mockNotes = [
  {
    id: 'note-1',
    project_id: 'proj-1',
    content: 'This is a test note',
    tags: 'tag1,tag2',
    chunk_count: 1,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'note-2',
    project_id: 'proj-1',
    content: 'Another note',
    tags: null,
    chunk_count: 1,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
]

describe('NotesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should load and display notes on mount', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json(mockNotes)
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('This is a test note')).toBeInTheDocument()
      expect(screen.getByText('Another note')).toBeInTheDocument()
    })
  })

  it('should show loading state initially', () => {
    render(<NotesSection projectId="proj-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should handle loading errors', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json({ detail: 'Error' }, { status: 500 })
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load notes/i)).toBeInTheDocument()
    })
  })

  it('should show empty state when no notes', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json([])
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
    })
  })

  it('should show create form when clicking new note button', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json([])
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new note/i)
    await user.click(newButton)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/write a note/i)).toBeInTheDocument()
    })
  })

  it('should create a new note', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json([])
      }),
      http.post('/api/v1/projects/proj-1/notes', async ({ request }) => {
        const data = await request.json() as any
        return HttpResponse.json({
          id: 'note-new',
          project_id: 'proj-1',
          content: data.content,
          tags: null,
          chunk_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { status: 201 })
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new note/i)
    await user.click(newButton)

    const textarea = screen.getByPlaceholderText(/write a note/i)
    await user.type(textarea, 'My new note')

    const saveButton = screen.getByTitle(/save note/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('My new note')).toBeInTheDocument()
    })
  })

  it('should delete a note', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json(mockNotes)
      }),
      http.delete('/api/v1/projects/proj-1/notes/note-1', () => {
        return new HttpResponse(null, { status: 204 })
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('This is a test note')).toBeInTheDocument()
    })

    const noteItem = screen.getByText('This is a test note').closest('div')
    await user.hover(noteItem!)

    const deleteButton = screen.getAllByTitle(/delete note/i)[0]
    await user.click(deleteButton)

    await waitFor(() => {
      expect(screen.queryByText('This is a test note')).not.toBeInTheDocument()
    })
  })

  it('should edit a note', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json(mockNotes)
      }),
      http.patch('/api/v1/projects/proj-1/notes/note-1', async ({ request }) => {
        const data = await request.json() as any
        return HttpResponse.json({
          id: 'note-1',
          project_id: 'proj-1',
          content: data.content,
          tags: mockNotes[0].tags,
          chunk_count: 1,
          created_at: mockNotes[0].created_at,
          updated_at: new Date().toISOString(),
        })
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('This is a test note')).toBeInTheDocument()
    })

    const noteItem = screen.getByText('This is a test note').closest('div')
    await user.hover(noteItem!)

    const editButton = screen.getAllByTitle(/edit note/i)[0]
    await user.click(editButton)

    const textarea = screen.getByDisplayValue('This is a test note')
    await user.clear(textarea)
    await user.type(textarea, 'Updated note content')

    const saveButton = screen.getByTitle(/save/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText('Updated note content')).toBeInTheDocument()
    })
  })

  it('should cancel editing', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json(mockNotes)
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('This is a test note')).toBeInTheDocument()
    })

    const noteItem = screen.getByText('This is a test note').closest('div')
    await user.hover(noteItem!)

    const editButton = screen.getAllByTitle(/edit note/i)[0]
    await user.click(editButton)

    const textarea = screen.getByDisplayValue('This is a test note')
    await user.clear(textarea)
    await user.type(textarea, 'Changed my mind')

    const cancelButton = screen.getByTitle(/cancel/i)
    await user.click(cancelButton)

    await waitFor(() => {
      expect(screen.getByText('This is a test note')).toBeInTheDocument()
      expect(screen.queryByText('Changed my mind')).not.toBeInTheDocument()
    })
  })

  it('should display tags', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json(mockNotes)
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('tag1')).toBeInTheDocument()
      expect(screen.getByText('tag2')).toBeInTheDocument()
    })
  })

  it('should handle create errors', async () => {
    const user = userEvent.setup()

    server.use(
      http.get('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json([])
      }),
      http.post('/api/v1/projects/proj-1/notes', () => {
        return HttpResponse.json({ detail: 'Error' }, { status: 500 })
      })
    )

    render(<NotesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
    })

    const newButton = screen.getByTitle(/new note/i)
    await user.click(newButton)

    const textarea = screen.getByPlaceholderText(/write a note/i)
    await user.type(textarea, 'Failed note')

    const saveButton = screen.getByTitle(/save note/i)
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/failed to save note/i)).toBeInTheDocument()
    })
  })
})
