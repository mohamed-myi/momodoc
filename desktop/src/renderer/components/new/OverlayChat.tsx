import { useEffect, useRef, useState } from "react";
import { Send, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getApiBaseUrl, getToken } from "@/lib/api";
import { dispatchMomodocSSEEvent, parseSSEEvents, type SSEEvent } from "@/lib/momodocSse";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function OverlayChat() {
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Use ref for session ID to avoid stale closure issues
  const sessionIdRef = useRef<string | null>(null);
  const creatingSessionRef = useRef<Promise<string> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Abort any in-flight stream on unmount
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (window.momodoc) {
      const unsub = window.momodoc.onOverlayExpanded((exp) => {
        setExpanded(exp);
      });
      return unsub;
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [expanded]);

  // Get or create a session — deduplicates concurrent calls
  async function getOrCreateSession(): Promise<string> {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (creatingSessionRef.current) return creatingSessionRef.current;

    const promise = (async () => {
      const base = await getApiBaseUrl();
      const token = await getToken();
      const res = await fetch(`${base}/api/v1/chat/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Momodoc-Token": token,
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      sessionIdRef.current = data.id;
      creatingSessionRef.current = null;
      return data.id as string;
    })();

    creatingSessionRef.current = promise;
    return promise;
  }

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content }]);

    // Auto-expand on first message
    if (!expanded && window.momodoc) {
      window.momodoc.expandOverlay();
    }

    setIsLoading(true);

    try {
      const sid = await getOrCreateSession();
      const base = await getApiBaseUrl();
      const token = await getToken();

      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(
        `${base}/api/v1/chat/sessions/${sid}/messages/stream`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Momodoc-Token": token,
          },
          body: JSON.stringify({ query: content }),
          signal: controller.signal,
        }
      );

      if (!response.ok || !response.body) {
        throw new Error(`Stream failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      // Add placeholder assistant message
      if (mountedRef.current) {
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      }

      const applyEvents = (events: SSEEvent[], updateAssistantMessage: boolean) => {
        for (const evt of events) {
          dispatchMomodocSSEEvent(
            evt,
            {
              onError: (message) => {
                throw new Error(message);
              },
              onToken: (token) => {
                fullContent += token;
                if (!updateAssistantMessage || !mountedRef.current) {
                  return;
                }
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: fullContent,
                  };
                  return updated;
                });
              },
            },
            { errorFallbackMessage: "stream error" }
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          const finalParsed = parseSSEEvents(`${buffer}\n\n`);
          buffer = finalParsed.remainder;
          applyEvents(finalParsed.events, false);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsedEvents = parseSSEEvents(buffer);
        buffer = parsedEvents.remainder;
        applyEvents(parsedEvents.events, true);
      }

      if (mountedRef.current) {
        setMessages((prev) => {
          if (prev.length === 0 || prev[prev.length - 1].role !== "assistant") {
            return prev;
          }
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: "assistant",
            content: fullContent,
          };
          return updated;
        });
      }
    } catch (err: unknown) {
      const error = err as Error;
      if (error?.name !== "AbortError" && mountedRef.current) {
        setMessages((prev) => {
          // Remove empty placeholder if it exists at the end
          const cleaned = prev.length > 0 && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content
            ? prev.slice(0, -1)
            : prev;
          return [
            ...cleaned,
            { role: "assistant", content: "Error: " + (error?.message || "Unknown error") },
          ];
        });
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      if (window.momodoc) {
        if (expanded) {
          window.momodoc.collapseOverlay();
        } else {
          window.momodoc.toggleOverlay();
        }
      }
    }
  };

  return (
    <div className="flex flex-col h-screen">
      {/* Pill bar (always visible, draggable) */}
      <div className="flex items-center gap-2 px-3 h-[52px] bg-bg-secondary/95 backdrop-blur-xl border border-border-strong rounded-xl shadow-elevated titlebar-drag">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask momodoc..."
          className="flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary outline-none titlebar-no-drag"
        />
        <div className="flex items-center gap-1 titlebar-no-drag">
          {isLoading ? (
            <div className="w-4 h-4 border-2 border-fg-tertiary border-t-fg-primary rounded-full animate-spin" />
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-1.5 text-fg-secondary hover:text-fg-primary disabled:opacity-30 transition-colors"
            >
              <Send size={14} />
            </button>
          )}
          <button
            onClick={() => {
              if (window.momodoc) {
                expanded ? window.momodoc.collapseOverlay() : window.momodoc.expandOverlay();
              }
            }}
            className="p-1.5 text-fg-secondary hover:text-fg-primary transition-colors"
          >
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded chat area */}
      {expanded && (
        <div className="flex-1 flex flex-col bg-bg-secondary/95 backdrop-blur-xl border border-t-0 border-border-strong rounded-b-xl shadow-elevated overflow-hidden mt-[-1px]">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-fg-tertiary text-center mt-8">
                Ask anything across all your projects
              </p>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`text-sm ${
                  msg.role === "user"
                    ? "text-fg-primary bg-bg-elevated rounded-lg px-3 py-2"
                    : "text-fg-primary"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm prose-invert max-w-none text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content || "..."}
                    </ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-3 py-2 border-t border-border">
            <button
              onClick={() => window.momodoc?.openMainWindow()}
              className="flex items-center gap-1 text-[11px] text-fg-tertiary hover:text-fg-secondary transition-colors"
            >
              <ExternalLink size={11} />
              Open full app
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
