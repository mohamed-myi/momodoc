import { ChevronDown, Send, Square } from "lucide-react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { Toggle } from "../ui/toggle";
import { Textarea } from "../ui/textarea";
import type { ModeOption } from "./types";

interface ChatInputBarProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onChatKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  isLoading: boolean;
  onStopStreaming: () => void;
  isSearchMode: boolean;
  projectId?: string;
  llmEnabled: boolean;
  includeHistory: boolean;
  onIncludeHistoryChange: (value: boolean) => void;
  modeDropdownRef: RefObject<HTMLDivElement | null>;
  modeDropdownOpen: boolean;
  onToggleModeDropdown: () => void;
  currentModeLabel: string;
  modeOptions: ModeOption[];
  llmMode: string;
  onModeChange: (mode: string) => void;
}

export function ChatInputBar({
  onSubmit,
  chatInput,
  onChatInputChange,
  onChatKeyDown,
  textareaRef,
  isLoading,
  onStopStreaming,
  isSearchMode,
  projectId,
  llmEnabled,
  includeHistory,
  onIncludeHistoryChange,
  modeDropdownRef,
  modeDropdownOpen,
  onToggleModeDropdown,
  currentModeLabel,
  modeOptions,
  llmMode,
  onModeChange,
}: ChatInputBarProps) {
  return (
    <div className="border-t border-border">
      <div className="max-w-3xl mx-auto px-4 py-3">
        <form onSubmit={onSubmit}>
          {/* Main row: textarea + send */}
          <div className="flex items-end gap-2 border border-white/20 rounded-[var(--radius-default)] bg-bg-secondary p-1 focus-within:border-white/40 transition-colors duration-100">
            <Textarea
              ref={textareaRef}
              autoResize
              value={chatInput}
              onChange={(event) => onChatInputChange(event.target.value)}
              onKeyDown={onChatKeyDown}
              placeholder={
                projectId
                  ? isSearchMode
                    ? "Search this project..."
                    : "Ask about this project..."
                  : isSearchMode
                  ? "Search all projects..."
                  : "Ask across all projects..."
              }
              rows={1}
              className="flex-1 border-0 shadow-none bg-transparent focus:ring-0 min-h-[30px] py-1 px-2 text-[13px] text-fg-primary placeholder:text-fg-muted/50"
            />
            {isLoading ? (
              <button
                type="button"
                aria-label="Stop"
                onClick={onStopStreaming}
                className="h-7 w-7 flex items-center justify-center rounded-[var(--radius-sm)] text-fg-tertiary hover:text-fg-primary transition-colors duration-100 shrink-0"
              >
                <Square size={12} />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Submit"
                disabled={!chatInput.trim()}
                className="h-7 w-7 flex items-center justify-center rounded-[var(--radius-sm)] bg-fg-primary text-bg-primary disabled:opacity-15 disabled:pointer-events-none transition-opacity duration-100 shrink-0"
              >
                <Send size={12} />
              </button>
            )}
          </div>

          {/* Below row: model pill + context pill */}
          <div className="flex items-center gap-2 mt-1.5 px-1">
            <div className="relative" ref={modeDropdownRef}>
              <button
                type="button"
                onClick={onToggleModeDropdown}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium tracking-[-0.01em] transition-colors duration-100 border ${
                  isSearchMode
                    ? "bg-bg-tertiary border-border text-fg-muted"
                    : "bg-fg-muted/20 border-fg-muted/30 text-fg-secondary hover:text-fg-primary"
                }`}
                title="Select AI model"
              >
                {currentModeLabel}
                <ChevronDown size={9} className="opacity-50" />
              </button>

              {modeDropdownOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-44 bg-bg-secondary border border-border rounded-[var(--radius-default)] shadow-lg overflow-hidden z-50 animate-[fade-in_0.1s_ease-out]">
                  {modeOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onModeChange(option.value)}
                      disabled={!option.available}
                      className={`w-full text-left px-3 py-1.5 text-[12px] transition-colors duration-100 ${
                        llmMode === option.value
                          ? "bg-bg-elevated text-fg-primary"
                          : option.available
                          ? "text-fg-secondary hover:bg-bg-elevated hover:text-fg-primary"
                          : "text-fg-muted/40 cursor-not-allowed"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{option.label}</span>
                        {!option.available && (
                          <span className="text-[10px] text-fg-muted/50">no key</span>
                        )}
                      </div>
                      {option.model && option.available && (
                        <p className="text-[10px] text-fg-muted font-mono mt-0.5 truncate">
                          {option.model}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {llmEnabled && (
              <label
                className="flex items-center gap-1 cursor-pointer select-none px-2 py-0.5 rounded-full border border-transparent hover:border-fg-muted/20 transition-colors duration-100"
                title="Include conversation history for context"
              >
                <Toggle
                  checked={includeHistory}
                  onChange={onIncludeHistoryChange}
                  label="Context"
                  className={includeHistory ? "!bg-fg-muted/50" : "!bg-bg-tertiary"}
                />
                <span className="text-[11px] tracking-[-0.01em] text-fg-muted/70">ctx</span>
              </label>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
