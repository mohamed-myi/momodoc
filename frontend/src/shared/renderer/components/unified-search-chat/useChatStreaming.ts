import { useCallback, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";
import type { ChatSource } from "@/lib/types";
import { dispatchMomodocSSEEvent, parseSSEEvents, type SSEEvent } from "@/lib/momodocSse";
import type { UnifiedChatMessage } from "./types";

interface UseChatStreamingOptions {
  projectId?: string;
  isGlobal: boolean;
  onProjectScores?: (scores: Record<string, number>) => void;
  includeHistory: boolean;
  llmMode: string;
  ensureSession: () => Promise<string>;
  getStreamUrl: (sessionId: string) => Promise<string>;
}

export function useChatStreaming({
  projectId,
  isGlobal,
  onProjectScores,
  includeHistory,
  llmMode,
  ensureSession,
  getStreamUrl,
}: UseChatStreamingOptions) {
  const [messages, setMessages] = useState<UnifiedChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const replaceMessages = useCallback((nextMessages: UnifiedChatMessage[]) => {
    setMessages(nextMessages);
  }, []);

  const resetMessages = useCallback(() => {
    setMessages([]);
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const sid = await ensureSession();
      const userMsg: UnifiedChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const assistantId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", isStreaming: true },
      ]);
      setIsLoading(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const token = await getToken();
        const url = await getStreamUrl(sid);
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Momodoc-Token": token,
          },
          body: JSON.stringify({
            query: content,
            include_history: includeHistory,
            llm_mode: llmMode,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed: ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let sources: ChatSource[] = [];
        let buffer = "";

        const applyEvents = (events: SSEEvent[]) => {
          for (const event of events) {
            dispatchMomodocSSEEvent(
              event,
              {
                onSources: (nextSources) => {
                  sources = nextSources as ChatSource[];
                },
                onError: (message) => {
                  throw new Error(message);
                },
                onToken: (tokenChunk) => {
                  fullContent += tokenChunk;
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
            applyEvents(finalParsed.events);
            buffer = finalParsed.remainder;
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSSEEvents(buffer);
          buffer = parsed.remainder;
          applyEvents(parsed.events);

          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: fullContent, sources } : message
            )
          );
        }

        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: fullContent, sources, isStreaming: false }
              : message
          )
        );
      } catch (error) {
        if (error instanceof Error && error.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId
                ? {
                    ...message,
                    content: "Error: failed to get response. Is the API key configured?",
                    isStreaming: false,
                  }
                : message
            )
          );
        }
      } finally {
        setIsLoading(false);
      }
    },
    [ensureSession, getStreamUrl, includeHistory, llmMode]
  );

  const searchOnly = useCallback(
    async (content: string) => {
      const userMsg: UnifiedChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
      };
      const assistantId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", content: "", isStreaming: true, searchResults: [] },
      ]);
      setIsLoading(true);

      try {
        const results = await api.search(content.trim(), projectId);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content:
                    results.length > 0
                      ? `Found ${results.length} result${results.length !== 1 ? "s" : ""}`
                      : `No results found for "${content}"`,
                  searchResults: results,
                  isStreaming: false,
                }
              : message
          )
        );

        if (isGlobal && onProjectScores) {
          const scores: Record<string, number> = {};
          for (const result of results) {
            scores[result.project_id] = (scores[result.project_id] || 0) + 1;
          }
          onProjectScores(scores);
        }
      } catch {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? { ...message, content: "Search failed. Please try again.", isStreaming: false }
              : message
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, isGlobal, onProjectScores]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isLoading,
    replaceMessages,
    resetMessages,
    sendMessage,
    searchOnly,
    stopStreaming,
  };
}
