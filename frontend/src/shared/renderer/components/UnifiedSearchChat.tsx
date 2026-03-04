import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { getApiBaseUrl, api } from "@/lib/api";
import type { LLMProviderInfo } from "@/lib/types";
import { ChatInputBar } from "./unified-search-chat/ChatInputBar";
import { ChatMessagesPane } from "./unified-search-chat/ChatMessagesPane";
import { SessionSidebar } from "./unified-search-chat/SessionSidebar";
import { ResizeHandle } from "./ui/resize-handle";
import {
  MODE_LABELS,
  SEARCH_MODE,
  getScoreVariant,
  type UnifiedChatMessage,
} from "./unified-search-chat/types";
import { useChatSessionManager } from "./unified-search-chat/useChatSessionManager";
import { useChatStreaming } from "./unified-search-chat/useChatStreaming";

const SESSION_WIDTH_KEY = "momodoc-session-width";
const SESSION_WIDTH_DEFAULT = 200;
const SESSION_WIDTH_MIN = 120;
const SESSION_WIDTH_MAX = 320;

interface UnifiedSearchChatProps {
  projectId?: string;
  isGlobal?: boolean;
  onProjectScores?: (scores: Record<string, number>) => void;
  className?: string;
  requestedSessionId?: string | null;
}

export function UnifiedSearchChat({
  projectId,
  isGlobal = false,
  onProjectScores,
  className = "",
  requestedSessionId = null,
}: UnifiedSearchChatProps) {
  const storageKey = `momodoc-llm-mode-${projectId || "global"}`;
  const [llmMode, setLlmMode] = useState<string>(() => {
    if (typeof window === "undefined") return "gemini";
    return localStorage.getItem(storageKey) || "gemini";
  });

  const [providers, setProviders] = useState<LLMProviderInfo[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [showSessions, setShowSessions] = useState(true);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [sessionWidth, setSessionWidth] = useState(() => {
    if (typeof window === "undefined") return SESSION_WIDTH_DEFAULT;
    const stored = localStorage.getItem(SESSION_WIDTH_KEY);
    return stored ? Math.max(SESSION_WIDTH_MIN, Math.min(SESSION_WIDTH_MAX, Number(stored))) : SESSION_WIDTH_DEFAULT;
  });

  const modeDropdownRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isSearchMode = llmMode === SEARCH_MODE;
  const llmEnabled = !isSearchMode;

  useEffect(() => {
    api.getProviders().then(setProviders).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(SESSION_WIDTH_KEY, String(sessionWidth));
  }, [sessionWidth]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (
        modeDropdownOpen &&
        modeDropdownRef.current &&
        !modeDropdownRef.current.contains(event.target as Node)
      ) {
        setModeDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [modeDropdownOpen]);

  const handleModeChange = useCallback(
    (mode: string) => {
      setLlmMode(mode);
      localStorage.setItem(storageKey, mode);
      setModeDropdownOpen(false);
    },
    [storageKey]
  );

  const handleSessionResize = useCallback((delta: number) => {
    setSessionWidth((prev) => {
      const next = Math.max(SESSION_WIDTH_MIN, Math.min(SESSION_WIDTH_MAX, prev + delta));
      localStorage.setItem(SESSION_WIDTH_KEY, String(next));
      return next;
    });
  }, []);

  const modeOptions = [
    ...providers.map((provider) => ({
      value: provider.name,
      label: MODE_LABELS[provider.name] || provider.name,
      available: provider.available,
      model: provider.model,
    })),
    { value: SEARCH_MODE, label: "Search only", available: true, model: "" },
  ];

  const currentModeLabel = MODE_LABELS[llmMode] || llmMode;

  const createSessionApi = useCallback(() => {
    return isGlobal ? api.createGlobalSession() : api.createSession(projectId!);
  }, [isGlobal, projectId]);

  const getSessionsApi = useCallback(() => {
    return isGlobal ? api.getGlobalSessions() : api.getSessions(projectId!);
  }, [isGlobal, projectId]);

  const getMessagesApi = useCallback(
    (sid: string) => {
      return isGlobal ? api.getGlobalMessages(sid) : api.getMessages(projectId!, sid);
    },
    [isGlobal, projectId]
  );

  const deleteSessionApi = useCallback(
    (sid: string) => {
      return isGlobal ? api.deleteGlobalSession(sid) : api.deleteSession(projectId!, sid);
    },
    [isGlobal, projectId]
  );

  const updateSessionApi = useCallback(
    (sid: string, data: { title: string }) => {
      return isGlobal ? api.updateGlobalSession(sid, data) : api.updateSession(projectId!, sid, data);
    },
    [isGlobal, projectId]
  );

  const streamUrl = useCallback(
    async (sid: string) => {
      const base = await getApiBaseUrl();
      return isGlobal
        ? `${base}/api/v1/chat/sessions/${sid}/messages/stream`
        : `${base}/api/v1/projects/${projectId}/chat/sessions/${sid}/messages/stream`;
    },
    [isGlobal, projectId]
  );

  const resetChatRef = useRef<() => void>(() => {});
  const messagesLoadedRef = useRef<(messages: UnifiedChatMessage[]) => void>(() => {});

  const onResetChatFromSession = useCallback(() => {
    resetChatRef.current();
  }, []);

  const onMessagesLoadedFromSession = useCallback((messages: UnifiedChatMessage[]) => {
    messagesLoadedRef.current(messages);
  }, []);

  const {
    sessionId,
    sessions,
    loadingSessions,
    hoveredSessionId,
    deletingSessionId,
    renamingSessionId,
    renameValue,
    setHoveredSessionId,
    setRenameValue,
    loadSession,
    startNewChat,
    handleDeleteSession,
    startRenaming,
    cancelRenaming,
    handleRename,
    ensureSession,
    handleSessionMouseLeave,
  } = useChatSessionManager({
    createSessionApi,
    getSessionsApi,
    getMessagesApi,
    deleteSessionApi,
    updateSessionApi,
    onResetChat: onResetChatFromSession,
    onMessagesLoaded: onMessagesLoadedFromSession,
  });

  useEffect(() => {
    if (!requestedSessionId) return;
    if (sessionId === requestedSessionId) return;
    void loadSession(requestedSessionId);
  }, [loadSession, requestedSessionId, sessionId]);

  const {
    messages,
    isLoading,
    replaceMessages,
    resetMessages,
    sendMessage,
    searchOnly,
    stopStreaming,
  } = useChatStreaming({
    projectId,
    isGlobal,
    onProjectScores,
    includeHistory,
    llmMode,
    ensureSession,
    getStreamUrl: streamUrl,
  });

  useEffect(() => {
    messagesLoadedRef.current = replaceMessages;
  }, [replaceMessages]);

  useEffect(() => {
    resetChatRef.current = () => {
      resetMessages();
      onProjectScores?.({});
      textareaRef.current?.focus();
    };
  }, [onProjectScores, resetMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleChatSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = chatInput.trim();
      if (!trimmed || isLoading) return;
      setChatInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      if (isSearchMode) {
        searchOnly(trimmed);
      } else {
        sendMessage(trimmed);
      }
    },
    [chatInput, isLoading, isSearchMode, searchOnly, sendMessage]
  );

  const handleChatKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleChatSubmit(event as unknown as FormEvent<HTMLFormElement>);
      }
    },
    [handleChatSubmit]
  );

  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex flex-1 min-h-0">
        {llmEnabled && showSessions && (
          <>
            <SessionSidebar
              sessions={sessions}
              sessionId={sessionId}
              loadingSessions={loadingSessions}
              hoveredSessionId={hoveredSessionId}
              deletingSessionId={deletingSessionId}
              renamingSessionId={renamingSessionId}
              renameValue={renameValue}
              onStartNewChat={startNewChat}
              onHideSessions={() => setShowSessions(false)}
              onLoadSession={loadSession}
              onSessionMouseEnter={setHoveredSessionId}
              onSessionMouseLeave={handleSessionMouseLeave}
              onStartRenaming={startRenaming}
              onDeleteSession={handleDeleteSession}
              onRenameValueChange={setRenameValue}
              onConfirmRename={handleRename}
              onCancelRenaming={cancelRenaming}
              width={sessionWidth}
            />
            <ResizeHandle onResize={handleSessionResize} />
          </>
        )}

        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <ChatMessagesPane
            messages={messages}
            scrollRef={scrollRef}
            projectId={projectId}
            isSearchMode={isSearchMode}
            currentModeLabel={currentModeLabel}
            getScoreVariant={getScoreVariant}
          />

          <ChatInputBar
            onSubmit={handleChatSubmit}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onChatKeyDown={handleChatKeyDown}
            textareaRef={textareaRef}
            isLoading={isLoading}
            onStopStreaming={stopStreaming}
            isSearchMode={isSearchMode}
            projectId={projectId}
            llmEnabled={llmEnabled}
            includeHistory={includeHistory}
            onIncludeHistoryChange={setIncludeHistory}
            modeDropdownRef={modeDropdownRef}
            modeDropdownOpen={modeDropdownOpen}
            onToggleModeDropdown={() => setModeDropdownOpen(!modeDropdownOpen)}
            currentModeLabel={currentModeLabel}
            modeOptions={modeOptions}
            llmMode={llmMode}
            onModeChange={handleModeChange}
          />
        </div>
      </div>
    </div>
  );
}
