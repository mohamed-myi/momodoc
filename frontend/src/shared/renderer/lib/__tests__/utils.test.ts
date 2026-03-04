import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { relativeTime, formatSize, getFileIcon, getPriorityVariant, debounce } from '../utils'
import { FileText, Code, FileType2, File } from 'lucide-react'

describe('utils', () => {
  describe('relativeTime', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns "just now" for times less than 60 seconds ago', () => {
      const time = new Date('2024-01-15T11:59:30Z').toISOString()
      expect(relativeTime(time)).toBe('just now')
    })

    it('returns minutes ago for times less than 60 minutes ago', () => {
      const time = new Date('2024-01-15T11:30:00Z').toISOString()
      expect(relativeTime(time)).toBe('30m ago')
    })

    it('returns hours ago for times less than 24 hours ago', () => {
      const time = new Date('2024-01-15T09:00:00Z').toISOString()
      expect(relativeTime(time)).toBe('3h ago')
    })

    it('returns days ago for times less than 30 days ago', () => {
      const time = new Date('2024-01-10T12:00:00Z').toISOString()
      expect(relativeTime(time)).toBe('5d ago')
    })

    it('returns months ago for times less than 12 months ago', () => {
      const time = new Date('2023-11-15T12:00:00Z').toISOString()
      expect(relativeTime(time)).toBe('2mo ago')
    })

    it('returns years ago for times more than 12 months ago', () => {
      const time = new Date('2022-01-15T12:00:00Z').toISOString()
      expect(relativeTime(time)).toBe('2y ago')
    })
  })

  describe('formatSize', () => {
    it('formats bytes when less than 1KB', () => {
      expect(formatSize(512)).toBe('512 B')
      expect(formatSize(0)).toBe('0 B')
    })

    it('formats KB when less than 1MB', () => {
      expect(formatSize(1024)).toBe('1.0 KB')
      expect(formatSize(2560)).toBe('2.5 KB')
      expect(formatSize(1024 * 500)).toBe('500.0 KB')
    })

    it('formats MB when 1MB or greater', () => {
      expect(formatSize(1024 * 1024)).toBe('1.0 MB')
      expect(formatSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
      expect(formatSize(1024 * 1024 * 1024)).toBe('1024.0 MB')
    })
  })

  describe('getFileIcon', () => {
    it('returns FileText for markdown files', () => {
      expect(getFileIcon('md')).toBe(FileText)
      expect(getFileIcon('markdown')).toBe(FileText)
      expect(getFileIcon('.md')).toBe(FileText)
    })

    it('returns Code for code files', () => {
      expect(getFileIcon('py')).toBe(Code)
      expect(getFileIcon('js')).toBe(Code)
      expect(getFileIcon('ts')).toBe(Code)
      expect(getFileIcon('tsx')).toBe(Code)
      expect(getFileIcon('cpp')).toBe(Code)
    })

    it('returns FileType2 for document files', () => {
      expect(getFileIcon('pdf')).toBe(FileType2)
      expect(getFileIcon('docx')).toBe(FileType2)
      expect(getFileIcon('txt')).toBe(FileType2)
    })

    it('returns File as default', () => {
      expect(getFileIcon('unknown')).toBe(File)
      expect(getFileIcon('exe')).toBe(File)
      expect(getFileIcon(null)).toBe(File)
      expect(getFileIcon(undefined)).toBe(File)
    })

    it('handles case insensitivity', () => {
      expect(getFileIcon('PY')).toBe(Code)
      expect(getFileIcon('MD')).toBe(FileText)
      expect(getFileIcon('PDF')).toBe(FileType2)
    })
  })

  describe('getPriorityVariant', () => {
    it('returns correct variants for priorities', () => {
      expect(getPriorityVariant('critical')).toBe('error')
      expect(getPriorityVariant('high')).toBe('warning')
      expect(getPriorityVariant('medium')).toBe('default')
      expect(getPriorityVariant('low')).toBe('outline')
    })

    it('returns default for unknown priority', () => {
      expect(getPriorityVariant('unknown')).toBe('default')
      expect(getPriorityVariant('')).toBe('default')
    })
  })

  describe('debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('delays function execution', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced()
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('resets timer on repeated calls', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced()
      vi.advanceTimersByTime(50)
      debounced()
      vi.advanceTimersByTime(50)
      expect(fn).not.toHaveBeenCalled()

      vi.advanceTimersByTime(50)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('passes arguments to the debounced function', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced('arg1', 'arg2')
      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
    })

    it('can be cancelled', () => {
      const fn = vi.fn()
      const debounced = debounce(fn, 100)

      debounced()
      debounced.cancel()
      vi.advanceTimersByTime(100)
      expect(fn).not.toHaveBeenCalled()
    })
  })
})
