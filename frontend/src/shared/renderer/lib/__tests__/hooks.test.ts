import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDebounce, useInfiniteScroll } from '../hooks'

describe('hooks', () => {
  describe('useDebounce', () => {
    it('returns initial value immediately', () => {
      const { result } = renderHook(() => useDebounce('initial', 500))
      expect(result.current).toBe('initial')
    })

    it('debounces value changes with real timers', async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 'initial', delay: 100 } }
      )

      // Initial value
      expect(result.current).toBe('initial')

      // Update value
      rerender({ value: 'updated', delay: 100 })

      // Should still be initial immediately after update
      expect(result.current).toBe('initial')

      // Wait for debounce to complete
      await waitFor(() => {
        expect(result.current).toBe('updated')
      }, { timeout: 200 })
    })

    it('works with different types', async () => {
      const { result, rerender } = renderHook(
        ({ value, delay }) => useDebounce(value, delay),
        { initialProps: { value: 42, delay: 100 } }
      )

      expect(result.current).toBe(42)

      rerender({ value: 100, delay: 100 })

      await waitFor(() => {
        expect(result.current).toBe(100)
      }, { timeout: 200 })
    })
  })

  describe('useInfiniteScroll', () => {
    beforeEach(() => {
      // Mock IntersectionObserver
      global.IntersectionObserver = vi.fn().mockImplementation(() => ({
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        root: null,
        rootMargin: '200px',
        thresholds: [],
        takeRecords: () => [],
      }))
    })

    it('returns a ref object', () => {
      const loadMore = vi.fn()
      const { result } = renderHook(() => useInfiniteScroll(loadMore, true, false))

      // Should return a ref object
      expect(result.current).toBeDefined()
      expect(result.current).toHaveProperty('current')
    })

    it('does not create observer when hasMore is false', () => {
      const loadMore = vi.fn()
      vi.clearAllMocks()

      renderHook(() => useInfiniteScroll(loadMore, false, false))

      // IntersectionObserver should not be instantiated
      expect(global.IntersectionObserver).not.toHaveBeenCalled()
    })
  })
})
