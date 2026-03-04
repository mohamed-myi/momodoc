import { render, RenderOptions } from '@testing-library/react'
import { ReactElement, ReactNode } from 'react'

interface WrapperProps {
  children: ReactNode
}

function Wrapper({ children }: WrapperProps) {
  return <>{children}</>
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: Wrapper, ...options })
}

export * from '@testing-library/react'
export { renderWithProviders as render }
