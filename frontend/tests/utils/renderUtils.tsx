import React, { ReactElement } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import type { RendererApiBootstrap } from '@/shared/renderer/lib/apiClientCore'

// Mock bootstrap for API client
export const mockBootstrap: RendererApiBootstrap = {
  getBaseUrl: async () => '',
  getToken: async () => 'test-token-123',
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  bootstrap?: RendererApiBootstrap
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export function renderWithProviders(
  ui: ReactElement,
  options?: CustomRenderOptions
) {
  return render(ui, { wrapper: Wrapper, ...options })
}

// Re-export everything from @testing-library/react
export * from '@testing-library/react'
export { renderWithProviders as render }
