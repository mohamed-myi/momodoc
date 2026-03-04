import { Check, PanelLeftClose, Pencil, Plus, Trash2, X } from "lucide-react";
import type { ChatSession } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { Spinner } from "../ui/spinner";

interface SessionSidebarProps {
  sessions: ChatSession[];
  sessionId: string | null;
  loadingSessions: boolean;
  hoveredSessionId: string | null;
  deletingSessionId: string | null;
  renamingSessionId: string | null;
  renameValue: string;
  onStartNewChat: () => void;
  onHideSessions: () => void;
  onLoadSession: (sessionId: string) => void;
  onSessionMouseEnter: (sessionId: string) => void;
  onSessionMouseLeave: (sessionId: string) => void;
  onStartRenaming: (session: ChatSession) => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameValueChange: (value: string) => void;
  onConfirmRename: () => void;
  onCancelRenaming: () => void;
  width?: number;
}

export function SessionSidebar({
  sessions,
  sessionId,
  loadingSessions,
  hoveredSessionId,
  deletingSessionId,
  renamingSessionId,
  renameValue,
  onStartNewChat,
  onHideSessions,
  onLoadSession,
  onSessionMouseEnter,
  onSessionMouseLeave,
  onStartRenaming,
  onDeleteSession,
  onRenameValueChange,
  onConfirmRename,
  onCancelRenaming,
  width,
}: SessionSidebarProps) {
  return (
    <div
      className="flex flex-col border-r border-border bg-bg-primary shrink-0"
      style={width ? { width } : { width: 192 }}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <span className="text-[11px] text-fg-secondary tracking-[0.05em] uppercase font-medium">
          chats
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={onStartNewChat}
            className="p-1 rounded-[var(--radius-xs)] text-fg-secondary hover:text-fg-primary transition-colors duration-100"
            title="New chat"
          >
            <Plus size={12} />
          </button>
          <button
            onClick={onHideSessions}
            className="p-1 rounded-[var(--radius-xs)] text-fg-secondary hover:text-fg-primary transition-colors duration-100"
            title="Hide sessions"
          >
            <PanelLeftClose size={12} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {loadingSessions ? (
          <div className="flex justify-center py-6">
            <Spinner size="sm" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-[11px] text-fg-secondary text-center py-6 font-mono">no chats</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`relative w-full text-left px-2 py-1.5 rounded-[var(--radius-sm)] text-[13px] tracking-[-0.01em] transition-colors duration-100 mb-px ${
                sessionId === session.id
                  ? "bg-bg-elevated text-fg-primary border-l-2 border-l-fg-primary"
                  : "text-fg-secondary hover:text-fg-primary border-l-2 border-l-transparent"
              }`}
              onMouseEnter={() => onSessionMouseEnter(session.id)}
              onMouseLeave={() => onSessionMouseLeave(session.id)}
            >
              {renamingSessionId === session.id ? (
                <div>
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(event) => onRenameValueChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") onConfirmRename();
                      if (event.key === "Escape") onCancelRenaming();
                    }}
                    autoFocus
                    className="w-full bg-bg-tertiary border border-border rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[12px] text-fg-primary outline-none focus:border-fg-muted/40"
                  />
                  <div className="flex items-center gap-0.5 mt-1">
                    <button
                      onClick={onConfirmRename}
                      className="p-0.5 rounded-[var(--radius-xs)] text-fg-secondary hover:text-fg-primary transition-colors duration-100"
                    >
                      <Check size={10} />
                    </button>
                    <button
                      onClick={onCancelRenaming}
                      className="p-0.5 rounded-[var(--radius-xs)] text-fg-secondary hover:text-fg-primary transition-colors duration-100"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ) : (
                <button className="w-full text-left" onClick={() => onLoadSession(session.id)}>
                  <p className="truncate pr-8 text-[12px] text-fg-primary">
                    {session.title || "Untitled"}
                  </p>
                  <p className="text-[11px] text-fg-secondary font-mono mt-0.5">
                    {relativeTime(session.updated_at)}
                  </p>
                </button>
              )}

              {renamingSessionId !== session.id && (
                <div
                  className={`absolute right-1 top-1 flex items-center gap-0 transition-opacity duration-100 ${
                    hoveredSessionId === session.id ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {deletingSessionId === session.id ? (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      className="flex items-center gap-0.5 px-1 py-0.5 rounded-[var(--radius-xs)] text-[10px] text-error hover:bg-error/10 transition-colors duration-100"
                    >
                      <Check size={9} />
                      delete?
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onStartRenaming(session);
                        }}
                        className="p-0.5 rounded-[var(--radius-xs)] text-fg-secondary hover:text-fg-primary transition-colors duration-100"
                        title="Rename"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onDeleteSession(session.id);
                        }}
                        className="p-0.5 rounded-[var(--radius-xs)] text-fg-secondary hover:text-error transition-colors duration-100"
                        title="Delete"
                      >
                        <Trash2 size={10} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
