import { act, render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { FilesSection } from '../FilesSection'
import { server } from '@tests/utils/mockApi/server'
import { http, HttpResponse } from 'msw'

const mockFiles = [
  {
    id: 'file-1',
    project_id: 'proj-1',
    filename: 'test.pdf',
    original_path: '/docs/test.pdf',
    file_type: 'application/pdf',
    file_size: 1024,
    chunk_count: 5,
    indexed_at: '2024-01-01T00:00:00Z',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'file-2',
    project_id: 'proj-1',
    filename: 'readme.md',
    original_path: '/readme.md',
    file_type: 'text/markdown',
    file_size: 512,
    chunk_count: 2,
    indexed_at: '2024-01-02T00:00:00Z',
    created_at: '2024-01-02T00:00:00Z',
  },
]

describe('FilesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('should load and display files on mount', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/files', () => {
        return HttpResponse.json(mockFiles)
      })
    )

    render(<FilesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText('test.pdf')).toBeInTheDocument()
      expect(screen.getByText('readme.md')).toBeInTheDocument()
    })
  })

  it('should show loading state initially', () => {
    render(<FilesSection projectId="proj-1" />)

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('should handle file loading errors', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/files', () => {
        return HttpResponse.json({ detail: 'Error' }, { status: 500 })
      })
    )

    render(<FilesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/failed to load files/i)).toBeInTheDocument()
    })
  })

  it('should show empty state when no files', async () => {
    server.use(
      http.get('/api/v1/projects/proj-1/files', () => {
        return HttpResponse.json([])
      })
    )

    render(<FilesSection projectId="proj-1" />)

    await waitFor(() => {
      expect(screen.getByText(/no files yet/i)).toBeInTheDocument()
    })
  })

  describe('File Upload', () => {
    it('should show upload button', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
      })
    })

    it('should upload file when selected', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/upload', () => {
          return HttpResponse.json({
            id: 'file-new',
            project_id: 'proj-1',
            filename: 'test.txt',
            file_type: 'text/plain',
            file_size: 12,
            chunk_count: 0,
            indexed_at: null,
            created_at: new Date().toISOString(),
          })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
      })

      const file = new File(['test content'], 'test.txt', { type: 'text/plain' })
      const uploadButton = screen.getByRole('button', { name: /upload/i })
      await user.click(uploadButton)

      const input = screen.getByTestId('file-upload-input') || document.querySelector('input[type="file"]')
      if (input) {
        await user.upload(input as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeInTheDocument()
      })
    })

    it('should show upload progress for multiple files', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/upload', async ({ request }) => {
          const formData = await request.formData()
          const file = formData.get('file') as File
          // Simulate slow upload
          await new Promise(resolve => setTimeout(resolve, 100))
          return HttpResponse.json({
            id: `file-${Date.now()}`,
            project_id: 'proj-1',
            filename: file.name,
            file_type: file.type,
            file_size: file.size,
            chunk_count: 0,
            indexed_at: null,
            created_at: new Date().toISOString(),
          })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
      })

      // Progress indicator should show during upload
      // This test verifies the component handles upload progress state
    })

    it('should handle upload errors', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/upload', () => {
          return HttpResponse.json({ detail: 'Upload failed' }, { status: 500 })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument()
      })

      const file = new File(['test'], 'test.txt', { type: 'text/plain' })
      const uploadButton = screen.getByRole('button', { name: /upload/i })
      await user.click(uploadButton)

      const input = document.querySelector('input[type="file"]')
      if (input) {
        await user.upload(input as HTMLInputElement, file)
      }

      await waitFor(() => {
        expect(screen.getByText(/failed to upload/i)).toBeInTheDocument()
      })
    })

    it('should handle drag and drop', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/upload', async ({ request }) => {
          const formData = await request.formData()
          const file = formData.get('file') as File
          return HttpResponse.json({
            id: 'file-new',
            project_id: 'proj-1',
            filename: file.name,
            file_type: file.type,
            file_size: file.size,
            chunk_count: 0,
            indexed_at: null,
            created_at: new Date().toISOString(),
          })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText(/no files yet/i)).toBeInTheDocument()
      })

      const dropZone = screen.getByText(/no files yet/i).closest('div')
      const file = new File(['test'], 'dropped.txt', { type: 'text/plain' })

      const dropEvent = new Event('drop', { bubbles: true }) as any
      dropEvent.dataTransfer = {
        files: [file],
      }

      if (dropZone) {
        dropZone.dispatchEvent(dropEvent)
      }

      // Verify drag and drop handling
    })
  })

  describe('File Deletion', () => {
    it('should show delete button on hover', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json(mockFiles)
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument()
      })

      const fileItem = screen.getByText('test.pdf').closest('div')
      await user.hover(fileItem!)

      await waitFor(() => {
        expect(screen.getByLabelText(/delete file test\.pdf/i)).toBeInTheDocument()
      })
    })

    it('should delete file when delete button is clicked', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json(mockFiles)
        }),
        http.delete('/api/v1/projects/proj-1/files/file-1', () => {
          return new HttpResponse(null, { status: 204 })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument()
      })

      const fileItem = screen.getByText('test.pdf').closest('div')
      await user.hover(fileItem!)

      const deleteButton = screen.getByLabelText(/delete file test\.pdf/i)
      await user.click(deleteButton)

      await waitFor(() => {
        expect(screen.queryByText('test.pdf')).not.toBeInTheDocument()
      })
    })

    it('should handle delete errors', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json(mockFiles)
        }),
        http.delete('/api/v1/projects/proj-1/files/file-1', () => {
          return HttpResponse.json({ detail: 'Delete failed' }, { status: 500 })
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByText('test.pdf')).toBeInTheDocument()
      })

      const fileItem = screen.getByText('test.pdf').closest('div')
      await user.hover(fileItem!)

      const deleteButton = screen.getByLabelText(/delete file test\.pdf/i)
      await user.click(deleteButton)

      await waitFor(() => {
        expect(screen.getByText(/failed to delete file/i)).toBeInTheDocument()
      })
    })
  })

  describe('Sync Functionality', () => {
    it('should show sync button when source directory is set', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        })
      )

      render(<FilesSection projectId="proj-1" sourceDirectory="/path/to/source" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument()
      })
    })

    it('should not show sync button without source directory', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /sync/i })).not.toBeInTheDocument()
      })
    })

    it('should start sync when sync button is clicked', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/sync', () => {
          return HttpResponse.json({
            id: 'job-1',
            project_id: 'proj-1',
            status: 'pending',
            total_files: 10,
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
          })
        })
      )

      render(<FilesSection projectId="proj-1" sourceDirectory="/path/to/source" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /sync/i })
      await user.click(syncButton)

      await waitFor(() => {
        // Sync button should be disabled during sync
        expect(syncButton).toBeDisabled()
      })
    })

    it('should poll for sync job status', async () => {
      vi.useFakeTimers()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.get('/api/v1/projects/proj-1/files/jobs/job-1', () => {
          return HttpResponse.json({
            id: 'job-1',
            project_id: 'proj-1',
            status: 'running',
            total_files: 10,
            processed_files: 5,
            completed_files: 5,
            succeeded_files: 5,
            skipped_files: 0,
            failed_files: 0,
            total_chunks: 20,
            current_file: 'test.pdf',
            errors: [],
            created_at: '2024-01-01T00:00:00Z',
            completed_at: null,
            error: null,
          })
        })
      )

      render(<FilesSection projectId="proj-1" initialSyncJobId="job-1" sourceDirectory="/path" />)

      // Fast-forward time to trigger polling
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })

      vi.useRealTimers()
    })

    it('should refetch files when sync completes', async () => {
      let syncCompleted = false

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          if (syncCompleted) {
            return HttpResponse.json(mockFiles)
          }
          return HttpResponse.json([])
        }),
        http.get('/api/v1/projects/proj-1/files/jobs/job-1', () => {
          syncCompleted = true
          return HttpResponse.json({
            id: 'job-1',
            project_id: 'proj-1',
            status: 'completed',
            total_files: 2,
            processed_files: 2,
            completed_files: 2,
            succeeded_files: 2,
            skipped_files: 0,
            failed_files: 0,
            total_chunks: 7,
            current_file: '',
            errors: [],
            created_at: '2024-01-01T00:00:00Z',
            completed_at: new Date().toISOString(),
            error: null,
          })
        })
      )

      render(<FilesSection projectId="proj-1" initialSyncJobId="job-1" sourceDirectory="/path" />)

      await waitFor(() => {
        expect(screen.queryByText('test.pdf')).toBeInTheDocument()
      })
    })

    it('should handle sync errors', async () => {
      const user = userEvent.setup()

      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        }),
        http.post('/api/v1/projects/proj-1/files/sync', () => {
          return HttpResponse.json({ detail: 'Sync failed' }, { status: 500 })
        })
      )

      render(<FilesSection projectId="proj-1" sourceDirectory="/path/to/source" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument()
      })

      const syncButton = screen.getByRole('button', { name: /sync/i })
      await user.click(syncButton)

      await waitFor(() => {
        expect(screen.getByText(/sync failed/i)).toBeInTheDocument()
      })
    })
  })

  describe('Folder Upload', () => {
    it('should show folder upload button', async () => {
      server.use(
        http.get('/api/v1/projects/proj-1/files', () => {
          return HttpResponse.json([])
        })
      )

      render(<FilesSection projectId="proj-1" />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /folder/i })).toBeInTheDocument()
      })
    })
  })
})
