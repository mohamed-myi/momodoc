import { render, screen, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { ChatInputBar } from '../ChatInputBar'
import { createRef } from 'react'

describe('ChatInputBar', () => {
  const mockOnSubmit = vi.fn()
  const mockOnChatInputChange = vi.fn()
  const mockOnChatKeyDown = vi.fn()
  const mockOnStopStreaming = vi.fn()
  const mockOnIncludeHistoryChange = vi.fn()
  const mockOnToggleModeDropdown = vi.fn()
  const mockOnModeChange = vi.fn()

  const defaultProps = {
    onSubmit: mockOnSubmit,
    chatInput: '',
    onChatInputChange: mockOnChatInputChange,
    onChatKeyDown: mockOnChatKeyDown,
    textareaRef: createRef<HTMLTextAreaElement>(),
    isLoading: false,
    onStopStreaming: mockOnStopStreaming,
    isSearchMode: false,
    projectId: 'proj-1',
    llmEnabled: true,
    includeHistory: false,
    onIncludeHistoryChange: mockOnIncludeHistoryChange,
    modeDropdownRef: createRef<HTMLDivElement>(),
    modeDropdownOpen: false,
    onToggleModeDropdown: mockOnToggleModeDropdown,
    currentModeLabel: 'Gemini',
    modeOptions: [
      { value: 'gemini', label: 'Gemini', available: true, model: 'gemini-2.5-flash' },
      { value: 'claude', label: 'Claude', available: true, model: 'claude-sonnet-4-6' },
      { value: 'openai', label: 'OpenAI', available: false, model: '' },
      { value: 'search', label: 'Search only', available: true, model: '' },
    ],
    llmMode: 'gemini',
    onModeChange: mockOnModeChange,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render textarea with correct placeholder for project chat', () => {
    render(<ChatInputBar {...defaultProps} />)

    expect(screen.getByPlaceholderText('Ask about this project...')).toBeInTheDocument()
  })

  it('should render textarea with correct placeholder for project search', () => {
    render(<ChatInputBar {...defaultProps} isSearchMode={true} />)

    expect(screen.getByPlaceholderText('Search this project...')).toBeInTheDocument()
  })

  it('should render textarea with correct placeholder for global chat', () => {
    render(<ChatInputBar {...defaultProps} projectId={undefined} />)

    expect(screen.getByPlaceholderText('Ask across all projects...')).toBeInTheDocument()
  })

  it('should render textarea with correct placeholder for global search', () => {
    render(<ChatInputBar {...defaultProps} projectId={undefined} isSearchMode={true} />)

    expect(screen.getByPlaceholderText('Search all projects...')).toBeInTheDocument()
  })

  it('should call onChatInputChange when typing in textarea', async () => {
    const user = userEvent.setup()
    render(<ChatInputBar {...defaultProps} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hello')

    expect(mockOnChatInputChange).toHaveBeenCalled()
  })

  it('should display send button when not loading', () => {
    render(<ChatInputBar {...defaultProps} chatInput="test" />)

    const sendButton = screen.getByRole('button', { name: /submit/i })
    expect(sendButton).toBeInTheDocument()
  })

  it('should disable send button when input is empty', () => {
    render(<ChatInputBar {...defaultProps} chatInput="" />)

    const sendButton = screen.getByRole('button', { name: /submit/i })
    expect(sendButton).toBeDisabled()
  })

  it('should enable send button when input has text', () => {
    render(<ChatInputBar {...defaultProps} chatInput="test message" />)

    const sendButton = screen.getByRole('button', { name: /submit/i })
    expect(sendButton).not.toBeDisabled()
  })

  it('should display stop button when loading', () => {
    render(<ChatInputBar {...defaultProps} isLoading={true} />)

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
  })

  it('should call onStopStreaming when stop button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatInputBar {...defaultProps} isLoading={true} />)

    const stopButton = screen.getByRole('button', { name: /stop/i })
    await user.click(stopButton)

    expect(mockOnStopStreaming).toHaveBeenCalled()
  })

  it('should call onSubmit when send button is clicked', async () => {
    const user = userEvent.setup()
    render(<ChatInputBar {...defaultProps} chatInput="test message" />)

    const sendButton = screen.getByRole('button', { name: /submit/i })
    await user.click(sendButton)

    expect(mockOnSubmit).toHaveBeenCalled()
  })

  describe('Mode Dropdown', () => {
    it('should display current mode label', () => {
      render(<ChatInputBar {...defaultProps} currentModeLabel="Gemini" />)

      expect(screen.getByText('Gemini')).toBeInTheDocument()
    })

    it('should toggle dropdown when mode button is clicked', async () => {
      const user = userEvent.setup()
      render(<ChatInputBar {...defaultProps} />)

      const modeButton = screen.getByTitle('Select AI model')
      await user.click(modeButton)

      expect(mockOnToggleModeDropdown).toHaveBeenCalled()
    })

    it('should display mode options when dropdown is open', () => {
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} />)

      expect(screen.getByText('Claude')).toBeInTheDocument()
      expect(screen.getByText('OpenAI')).toBeInTheDocument()
      expect(screen.getByText('Search only')).toBeInTheDocument()
    })

    it('should show "no key" for unavailable providers', () => {
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} />)

      // OpenAI is marked as unavailable in defaultProps
      const openAIOption = screen.getByText('OpenAI').closest('button')
      expect(openAIOption).toHaveTextContent('no key')
    })

    it('should disable unavailable providers', () => {
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} />)

      const openAIOption = screen.getByText('OpenAI').closest('button')
      expect(openAIOption).toBeDisabled()
    })

    it('should call onModeChange when selecting a mode', async () => {
      const user = userEvent.setup()
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} />)

      const claudeOption = screen.getByText('Claude').closest('button')
      await user.click(claudeOption!)

      expect(mockOnModeChange).toHaveBeenCalledWith('claude')
    })

    it('should highlight current mode', () => {
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} llmMode="claude" />)

      const claudeOption = screen.getByText('Claude').closest('button')
      expect(claudeOption).toHaveClass('bg-bg-elevated')
    })

    it('should display model name for available providers', () => {
      render(<ChatInputBar {...defaultProps} modeDropdownOpen={true} />)

      expect(screen.getByText('gemini-2.5-flash')).toBeInTheDocument()
      expect(screen.getByText('claude-sonnet-4-6')).toBeInTheDocument()
    })
  })

  describe('Context Toggle', () => {
    it('should show context toggle when LLM is enabled', () => {
      render(<ChatInputBar {...defaultProps} llmEnabled={true} />)

      expect(screen.getByText('ctx')).toBeInTheDocument()
    })

    it('should not show context toggle when in search mode', () => {
      render(<ChatInputBar {...defaultProps} llmEnabled={false} isSearchMode={true} />)

      expect(screen.queryByText('ctx')).not.toBeInTheDocument()
    })

    it('should call onIncludeHistoryChange when toggled', async () => {
      const user = userEvent.setup()
      render(<ChatInputBar {...defaultProps} llmEnabled={true} includeHistory={false} />)

      const toggleLabel = screen.getByText('ctx').closest('label')
      await user.click(toggleLabel!)

      expect(mockOnIncludeHistoryChange).toHaveBeenCalled()
    })

    it('should reflect includeHistory state', () => {
      const { rerender } = render(
        <ChatInputBar {...defaultProps} llmEnabled={true} includeHistory={false} />
      )

      let toggle = screen.getByRole('switch')
      expect(toggle).not.toBeChecked()

      rerender(<ChatInputBar {...defaultProps} llmEnabled={true} includeHistory={true} />)

      toggle = screen.getByRole('switch')
      expect(toggle).toBeChecked()
    })
  })

  describe('Keyboard Handling', () => {
    it('should call onChatKeyDown when key is pressed in textarea', async () => {
      const user = userEvent.setup()
      render(<ChatInputBar {...defaultProps} />)

      const textarea = screen.getByRole('textbox')
      await user.type(textarea, 'test')

      expect(mockOnChatKeyDown).toHaveBeenCalled()
    })
  })

  describe('Search Mode Styling', () => {
    it('should apply different styling in search mode', () => {
      render(<ChatInputBar {...defaultProps} isSearchMode={true} />)

      const modeButton = screen.getByTitle('Select AI model')
      expect(modeButton).toHaveClass('bg-bg-tertiary')
    })

    it('should apply LLM styling in chat mode', () => {
      render(<ChatInputBar {...defaultProps} isSearchMode={false} />)

      const modeButton = screen.getByTitle('Select AI model')
      expect(modeButton).toHaveClass('bg-fg-muted/20')
    })
  })
})
