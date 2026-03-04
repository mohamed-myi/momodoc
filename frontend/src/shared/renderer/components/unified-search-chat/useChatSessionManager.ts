import { useCallback, useEffect, useState } from "react";
import type { ChatMessage, ChatSession } from "@/lib/types";
import type { UnifiedChatMessage } from "./types";

interface UseChatSessionManagerOptions {
  createSessionApi: () => Promise<ChatSession>;
  getSessionsApi: () => Promise<ChatSession[]>;
  getMessagesApi: (sessionId: string) => Promise<ChatMessage[]>;
  deleteSessionApi: (sessionId: string) => Promise<unknown>;
  updateSessionApi: (sessionId: string, data: { title: string }) => Promise<ChatSession>;
  onResetChat: () => void;
  onMessagesLoaded: (messages: UnifiedChatMessage[]) => void;
}

function mapChatMessage(message: ChatMessage): UnifiedChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources,
  };
}

export function useChatSessionManager({
  createSessionApi,
  getSessionsApi,
  getMessagesApi,
  deleteSessionApi,
  updateSessionApi,
  onResetChat,
  onMessagesLoaded,
}: UseChatSessionManagerOptions) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    const fetchSessions = async () => {
      setLoadingSessions(true);
      try {
        const data = await getSessionsApi();
        setSessions(data);
      } catch {
        // Silent fail
      } finally {
        setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [getSessionsApi]);

  const loadSession = useCallback(
    async (sid: string) => {
      setSessionId(sid);
      onMessagesLoaded([]);
      try {
        const msgs = await getMessagesApi(sid);
        onMessagesLoaded(msgs.map(mapChatMessage));
      } catch {
        // Failed to load messages
      }
    },
    [getMessagesApi, onMessagesLoaded]
  );

  const startNewChat = useCallback(() => {
    setSessionId(null);
    onResetChat();
  }, [onResetChat]);

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      if (deletingSessionId !== sid) {
        setDeletingSessionId(sid);
        setRenamingSessionId(null);
        return;
      }
      try {
        await deleteSessionApi(sid);
        setSessions((prev) => prev.filter((session) => session.id !== sid));
        setDeletingSessionId(null);
        if (sessionId === sid) startNewChat();
      } catch {
        // Silent fail
      }
    },
    [deleteSessionApi, deletingSessionId, sessionId, startNewChat]
  );

  const startRenaming = useCallback((session: ChatSession) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title || "");
    setDeletingSessionId(null);
  }, []);

  const cancelRenaming = useCallback(() => {
    setRenamingSessionId(null);
    setRenameValue("");
  }, []);

  const handleRename = useCallback(async () => {
    if (!renamingSessionId || !renameValue.trim()) return;
    try {
      const updated = await updateSessionApi(renamingSessionId, {
        title: renameValue.trim(),
      });
      setSessions((prev) =>
        prev.map((session) => (session.id === renamingSessionId ? updated : session))
      );
      setRenamingSessionId(null);
    } catch {
      // Silent fail
    }
  }, [renameValue, renamingSessionId, updateSessionApi]);

  const ensureSession = useCallback(async () => {
    if (sessionId) return sessionId;
    const session = await createSessionApi();
    setSessionId(session.id);
    setSessions((prev) => [session, ...prev]);
    return session.id;
  }, [createSessionApi, sessionId]);

  const handleSessionMouseLeave = useCallback((sid: string) => {
    setHoveredSessionId(null);
    setDeletingSessionId((current) => (current === sid ? null : current));
  }, []);

  return {
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
  };
}
