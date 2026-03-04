import { useState, type HTMLAttributes, type RefObject } from "react";
import { MessageSquare, StickyNote } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import type { ChatSource, SearchResult } from "@/lib/types";
import { getFileIcon } from "@/lib/utils";
import { Badge } from "../ui/badge";
import { Spinner } from "../ui/spinner";
import type { ScoreVariant, UnifiedChatMessage } from "./types";

interface ChatMessagesPaneProps {
  messages: UnifiedChatMessage[];
  scrollRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  isSearchMode: boolean;
  currentModeLabel: string;
  getScoreVariant: (score: number) => ScoreVariant;
}

export function ChatMessagesPane({
  messages,
  scrollRef,
  projectId,
  isSearchMode,
  currentModeLabel,
  getScoreVariant,
}: ChatMessagesPaneProps) {
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 lg:px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] animate-[fade-in_0.2s_ease-out]">
            <MessageSquare size={20} className="text-fg-secondary mb-3" />
            <p className="text-[16px] text-fg-primary font-medium tracking-[-0.02em]">
              {projectId ? "chat with your project" : "chat across all projects"}
            </p>
            <p className="text-[14px] text-fg-secondary tracking-[-0.01em] mt-1 text-center">
              {isSearchMode
                ? "search your documents with semantic similarity"
                : `AI-powered answers via ${currentModeLabel}`}
            </p>
            <div className="mt-4 space-y-1 text-center">
              <p className="text-[12px] text-fg-tertiary">
                {projectId
                  ? "Try asking for a summary, TODOs, or files related to a feature."
                  : "Ask a cross-project question or switch to Search only for retrieval-first results."}
              </p>
              <p className="text-[12px] text-fg-tertiary">
                Start with one sentence. Momodoc will create a chat session automatically.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((message) => (
              <MessageBlock
                key={message.id}
                message={message}
                getScoreVariant={getScoreVariant}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBlock({
  message,
  getScoreVariant,
}: {
  message: UnifiedChatMessage;
  getScoreVariant: (score: number) => ScoreVariant;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-bg-elevated border border-border rounded-[var(--radius-default)] px-3 py-2">
          <div className="text-[13px] text-fg-primary whitespace-pre-wrap leading-relaxed tracking-[-0.01em]">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  const hasSearchResults = message.searchResults && message.searchResults.length > 0;

  return (
    <div className="border-l border-border pl-3">
      {hasSearchResults ? (
        <SearchResultsBlock
          results={message.searchResults!}
          getScoreVariant={getScoreVariant}
        />
      ) : (
        <div className="prose-chat text-[13px] text-fg-primary leading-[1.7] tracking-[-0.01em]">
          {message.content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
                code: ({ className, children, ...props }) => {
                  const codeElementProps = props as unknown as HTMLAttributes<HTMLElement>;
                  const isBlock =
                    className?.startsWith("hljs") || className?.startsWith("language-");
                  if (isBlock) {
                    return (
                      <code className={className} {...codeElementProps}>
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code
                      className="bg-bg-tertiary px-1 py-px rounded-[2px] text-[12px] font-[var(--font-mono)] text-fg-primary"
                      {...codeElementProps}
                    >
                      {children}
                    </code>
                  );
                },
                pre: ({ children }) => (
                  <pre className="my-2.5 overflow-x-auto rounded-[var(--radius-sm)] bg-bg-tertiary border border-border text-[12px]">
                    {children}
                  </pre>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc pl-5 mb-2.5 space-y-1">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal pl-5 mb-2.5 space-y-1">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-[13px] leading-relaxed">{children}</li>
                ),
                h1: ({ children }) => (
                  <h1 className="text-[18px] font-semibold tracking-[-0.03em] mt-4 mb-2">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-[16px] font-semibold tracking-[-0.025em] mt-3 mb-1.5">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-[14px] font-semibold tracking-[-0.02em] mt-2.5 mb-1">
                    {children}
                  </h3>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-fg-primary underline underline-offset-2 decoration-fg-muted hover:decoration-fg-primary transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l border-fg-muted pl-3 my-2.5 text-fg-secondary">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="my-2.5 overflow-x-auto border border-border rounded-[var(--radius-sm)]">
                    <table className="w-full text-[12px] border-collapse">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border-b border-border px-2.5 py-1 bg-bg-tertiary text-left text-[11px] font-medium uppercase text-fg-secondary tracking-[0.03em]">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border-b border-border px-2.5 py-1">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          ) : null}
          {message.isStreaming && (
            <span className="inline-block w-[1.5px] h-[13px] bg-fg-primary ml-0.5 animate-pulse" />
          )}
        </div>
      )}

      {message.isStreaming && hasSearchResults !== true && !message.content && (
        <div className="flex items-center gap-2 py-1">
          <Spinner size="sm" />
        </div>
      )}

      {!message.isStreaming &&
        !hasSearchResults &&
        message.sources &&
        message.sources.length > 0 && <SourceList sources={message.sources} />}
    </div>
  );
}

function SearchResultsBlock({
  results,
  getScoreVariant,
}: {
  results: SearchResult[];
  getScoreVariant: (score: number) => ScoreVariant;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  if (results.length === 0) return null;

  return (
    <div className="mt-1">
      <p className="text-[11px] text-fg-muted font-mono mb-2">
        {results.length} result{results.length !== 1 ? "s" : ""}
      </p>
      <div className="border border-border rounded-[var(--radius-default)] overflow-hidden">
        {results.map((result, index) => {
          const isFile = result.source_type === "file";
          const Icon = isFile ? getFileIcon(result.file_type) : StickyNote;
          const isExpanded = expandedIndex === index;

          return (
            <div
              key={`${result.source_id}-${result.chunk_index}`}
              className={`px-3 py-2 transition-colors duration-100 hover:bg-bg-elevated cursor-pointer ${
                index !== 0 ? "border-t border-border" : ""
              }`}
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
            >
              <div className="flex items-center gap-2">
                <Icon size={12} className="text-fg-muted shrink-0" />
                <span className="text-[13px] text-fg-primary font-medium tracking-[-0.01em] truncate">
                  {result.filename || "note"}
                </span>
                <Badge variant="outline">{isFile ? result.file_type : "note"}</Badge>
                <span className="ml-auto shrink-0">
                  <Badge variant={getScoreVariant(result.score)}>
                    {(result.score * 100).toFixed(0)}%
                  </Badge>
                </span>
              </div>
              <p
                className={`text-[12px] text-fg-primary/80 tracking-[-0.01em] mt-1 leading-relaxed ${
                  isExpanded ? "" : "line-clamp-2"
                }`}
              >
                {result.chunk_text}
              </p>
              {result.original_path && (
                <p className="text-[11px] text-fg-muted font-mono mt-0.5 truncate">
                  {result.original_path}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visibleSources = showAll ? sources : sources.slice(0, 4);
  const hiddenCount = sources.length - 4;

  return (
    <div className="mt-2 pt-1.5 border-t border-border">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        {visibleSources.map((source, index) => {
          const baseLabel = source.filename || "note";
          const label = source.section_header ? `${baseLabel} > ${source.section_header}` : baseLabel;
          const score = `${(source.score * 100).toFixed(0)}%`;
          return (
            <button
              key={index}
              onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              className={`text-[11px] font-mono tracking-[-0.02em] transition-colors duration-100 ${
                expandedIndex === index
                  ? "text-fg-primary"
                  : "text-fg-muted hover:text-fg-secondary"
              }`}
            >
              <span className="text-fg-muted">[{index + 1}]</span> {label}{" "}
              <span className="text-fg-muted">{score}</span>
            </button>
          );
        })}
        {!showAll && hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="text-[11px] text-fg-muted hover:text-fg-secondary font-mono tracking-[-0.02em] transition-colors duration-100"
          >
            +{hiddenCount} more
          </button>
        )}
      </div>

      {expandedIndex !== null && (
        <div className="mt-1.5 animate-[slide-down_0.1s_ease-out]">
          <SourceDetail source={sources[expandedIndex]} index={expandedIndex} />
        </div>
      )}
    </div>
  );
}

function SourceDetail({
  source,
  index,
}: {
  source: ChatSource;
  index: number;
}) {
  return (
    <div className="border border-border rounded-[var(--radius-sm)] overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1 border-b border-border bg-bg-tertiary/30">
        <span className="text-[11px] font-mono text-fg-secondary">
          [{index + 1}] {source.filename || "note"}{source.section_header ? ` > ${source.section_header}` : ""}
        </span>
        {source.original_path && (
          <span className="text-[11px] text-fg-muted font-mono truncate">
            {source.original_path}
          </span>
        )}
        <span className="text-[11px] font-mono text-fg-muted ml-auto">
          {(source.score * 100).toFixed(0)}%
        </span>
      </div>
      <pre className="whitespace-pre-wrap text-[12px] leading-relaxed font-[var(--font-mono)] p-2.5 max-h-36 overflow-y-auto text-fg-secondary">
        {source.chunk_text}
      </pre>
    </div>
  );
}
