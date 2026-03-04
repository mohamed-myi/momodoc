import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  MessageSquare,
  FolderOpen,
  Globe,
  Layers3,
  LifeBuoy,
  RefreshCw,
  Clock3,
} from "lucide-react";
import { api } from "@/lib/api";
import type { ChatSession, Project } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useInfiniteScroll } from "@/lib/hooks";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Spinner } from "./ui/spinner";
import { LoadingPage } from "./LoadingPage";
import { ErrorPage } from "./ErrorPage";
import { UnifiedSearchChat } from "./UnifiedSearchChat";

const PROJECTS_PER_PAGE = 20;
const RECENT_PROJECTS_KEY = "momodoc-desktop-recent-projects-v1";
const MAX_RECENT_PROJECTS = 5;
const MAX_RECENT_CHATS = 5;

interface RecentProjectEntry {
  id: string;
  name: string;
  openedAt: string;
}

interface DashboardHomeStatus {
  backend:
    | { state: "ready" | "starting" | "failed" | "stopped"; detail?: string | null }
    | null;
  provider:
    | { label: string; configured: boolean; detail?: string | null }
    | null;
  watcher:
    | { configured: boolean; folderCount: number }
    | null;
  updater:
    | { state: string; message: string }
    | null;
  onboardingStatus?: string | null;
}

interface DashboardProps {
  onSelectProject: (id: string, name?: string) => void;
  onOpenOverlay?: () => Promise<void> | void;
  onOpenWebUi?: () => Promise<void> | void;
  onOpenDiagnostics?: () => void;
  onResumeOnboarding?: () => Promise<void> | void;
  homeStatus?: DashboardHomeStatus | null;
}

export function Dashboard({
  onSelectProject,
  onOpenOverlay,
  onOpenWebUi,
  onOpenDiagnostics,
  onResumeOnboarding,
  homeStatus = null,
}: DashboardProps) {
  // Projects state (infinite scroll)
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageRef = useRef(0);

  // Project CRUD state
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newSourceDir, setNewSourceDir] = useState("");
  const [creating, setCreating] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSourceDir, setEditSourceDir] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Search/chat collapsible state
  const [expanded, setExpanded] = useState(false);
  const [projectScores, setProjectScores] = useState<Record<string, number>>({});
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const [launcherNotice, setLauncherNotice] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [recentProjects, setRecentProjects] = useState<RecentProjectEntry[]>([]);
  const [recentChats, setRecentChats] = useState<ChatSession[]>([]);
  const [recentChatsLoading, setRecentChatsLoading] = useState(true);
  const [requestedGlobalSessionId, setRequestedGlobalSessionId] = useState<string | null>(null);

  const readRecentProjects = useCallback((): RecentProjectEntry[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(RECENT_PROJECTS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is RecentProjectEntry => {
          return (
            !!entry &&
            typeof entry === "object" &&
            typeof (entry as RecentProjectEntry).id === "string" &&
            typeof (entry as RecentProjectEntry).name === "string" &&
            typeof (entry as RecentProjectEntry).openedAt === "string"
          );
        })
        .slice(0, MAX_RECENT_PROJECTS);
    } catch {
      return [];
    }
  }, []);

  const writeRecentProjects = useCallback((entries: RecentProjectEntry[]) => {
    setRecentProjects(entries);
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(entries.slice(0, MAX_RECENT_PROJECTS)));
    } catch {
      // Ignore storage failures
    }
  }, []);

  const rememberRecentProject = useCallback(
    (projectId: string, projectName: string) => {
      const next: RecentProjectEntry[] = [
        { id: projectId, name: projectName, openedAt: new Date().toISOString() },
        ...recentProjects.filter((entry) => entry.id !== projectId),
      ].slice(0, MAX_RECENT_PROJECTS);
      writeRecentProjects(next);
    },
    [recentProjects, writeRecentProjects]
  );

  const loadProjects = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      pageRef.current = 0;
      setHasMore(true);
    } else {
      setLoadingMore(true);
    }
    setError(null);
    try {
      const offset = reset ? 0 : pageRef.current * PROJECTS_PER_PAGE;
      const data = await api.getProjects(offset, PROJECTS_PER_PAGE);
      if (data.length < PROJECTS_PER_PAGE) setHasMore(false);
      if (reset) {
        setProjects(data);
        pageRef.current = 1;
      } else {
        setProjects((prev) => [...prev, ...data]);
        pageRef.current += 1;
      }
    } catch {
      setError("failed to load projects");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    loadProjects(true);
  }, [loadProjects]);

  useEffect(() => {
    writeRecentProjects(readRecentProjects());
  }, [readRecentProjects, writeRecentProjects]);

  useEffect(() => {
    let cancelled = false;
    const loadRecentChats = async () => {
      setRecentChatsLoading(true);
      try {
        const sessions = await api.getGlobalSessions();
        if (!cancelled) {
          const sorted = [...sessions].sort(
            (a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
          setRecentChats(sorted.slice(0, MAX_RECENT_CHATS));
        }
      } catch {
        if (!cancelled) {
          setRecentChats([]);
        }
      } finally {
        if (!cancelled) {
          setRecentChatsLoading(false);
        }
      }
    };
    void loadRecentChats();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) loadProjects(false);
  }, [loadProjects, loadingMore, hasMore]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMore, loadingMore);

  const hasScores = Object.keys(projectScores).length > 0;

  const sortedProjects = hasScores
    ? [...projects].sort((a, b) => {
        const sa = projectScores[a.id] || 0;
        const sb = projectScores[b.id] || 0;
        if (sa !== sb) return sb - sa; // More matches first
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
    : projects;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        expanded &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        // Don't collapse if there are active results or chat messages
        // Only collapse on outside click when idle
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        source_directory: newSourceDir.trim() || undefined,
      });
      setProjects((prev) => [project, ...prev]);
      setNewName("");
      setNewDescription("");
      setNewSourceDir("");
      setShowCreate(false);
      // If a sync was auto-triggered, navigate to project so user sees progress
      if (project.sync_job_id) {
        selectProject(project.id, project.name);
      }
    } catch {
      setError("failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const startEditing = (project: Project) => {
    setEditingId(project.id);
    setEditName(project.name);
    setEditDescription(project.description || "");
    setEditSourceDir(project.source_directory || "");
    setDeletingId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditName("");
    setEditDescription("");
    setEditSourceDir("");
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateProject(editingId, {
        name: editName.trim(),
        description: editDescription.trim() || undefined,
        source_directory: editSourceDir.trim() || undefined,
      });
      setProjects((prev) =>
        prev.map((p) => (p.id === editingId ? { ...p, ...updated } : p))
      );
      setEditingId(null);
    } catch {
      setError("failed to update project");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (projectId: string) => {
    if (deletingId !== projectId) {
      setDeletingId(projectId);
      setEditingId(null);
      return;
    }
    setError(null);
    try {
      await api.deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      setDeletingId(null);
    } catch {
      setError("failed to delete project");
      setDeletingId(null);
    }
  };

  const selectProject = (id: string, name?: string) => {
    if (name) {
      rememberRecentProject(id, name);
    }
    onSelectProject(id, name);
  };

  const handleQuickIndexFolder = async () => {
    setLauncherNotice(null);
    try {
      const dir = await window.momodoc?.selectDirectory();
      if (!dir) return;
      const guessedName = dir.split(/[\\/]/).filter(Boolean).at(-1) || "New Project";
      setNewSourceDir(dir);
      if (!newName.trim()) {
        setNewName(guessedName);
      }
      setShowCreate(true);
      setLauncherNotice({
        kind: "success",
        message: "Picked a folder. Finish the project form to start indexing.",
      });
    } catch (error) {
      setLauncherNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Failed to open folder picker.",
      });
    }
  };

  const runQuickAction = async (
    action: (() => Promise<void> | void) | undefined,
    successMessage: string
  ) => {
    if (!action) return;
    setLauncherNotice(null);
    try {
      await action();
      setLauncherNotice({ kind: "success", message: successMessage });
    } catch (error) {
      setLauncherNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Action failed.",
      });
    }
  };

  const openRecentGlobalChat = (sessionId: string) => {
    setRequestedGlobalSessionId(sessionId);
    setExpanded(true);
    setLauncherNotice({
      kind: "success",
      message: "Opened global chat and loaded the selected recent session.",
    });
  };

  if (loading) return <LoadingPage />;
  if (error && projects.length === 0)
    return <ErrorPage message={error} onRetry={() => loadProjects(true)} />;

  const totalCount = projects.length + (hasMore ? "+" : "");
  const recentProjectItems = recentProjects
    .map((recent) => {
      const live = projects.find((project) => project.id === recent.id);
      return {
        id: recent.id,
        name: live?.name || recent.name,
        updatedAt: live?.updated_at || recent.openedAt,
        existsInList: Boolean(live),
      };
    })
    .slice(0, MAX_RECENT_PROJECTS);
  const onboardingIncomplete =
    homeStatus?.onboardingStatus &&
    homeStatus.onboardingStatus !== "completed";

  return (
    <div className="min-h-screen px-6 pt-24 pb-16 container-dashboard animate-[fade-in_0.2s_ease-out]">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.045em] leading-none">
            momodoc
          </h1>
        </div>
        <Button
          variant={showCreate ? "ghost" : "secondary"}
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
        >
          {showCreate ? (
            <>
              <X size={13} />
              cancel
            </>
          ) : (
            <>
              <Plus size={13} />
              new project
            </>
          )}
        </Button>
      </div>

      {/* Home launcher */}
      <div className="mb-8 grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <div className="rounded-[var(--radius-default)] border border-border bg-bg-secondary/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[15px] font-medium tracking-[-0.02em] text-fg-primary">
                Home
              </p>
              <p className="text-[13px] text-fg-secondary tracking-[-0.01em] mt-1">
                Quick actions and system status for your desktop workspace.
              </p>
            </div>
            {onboardingIncomplete && onResumeOnboarding ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runQuickAction(onResumeOnboarding, "Reopened setup wizard.")}
              >
                <RefreshCw size={13} />
                Resume Setup
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowCreate(true);
                setLauncherNotice(null);
              }}
            >
              <Plus size={13} />
              Create Project
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void handleQuickIndexFolder()}>
              <FolderOpen size={13} />
              Index Folder
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runQuickAction(onOpenOverlay, "Opened overlay.")}
            >
              <Layers3 size={13} />
              Open Overlay
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void runQuickAction(onOpenWebUi, "Opened web UI in browser.")}
            >
              <Globe size={13} />
              Open Web UI
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onOpenDiagnostics?.();
                setLauncherNotice({
                  kind: "success",
                  message: "Opened Settings → Diagnostics.",
                });
              }}
            >
              <LifeBuoy size={13} />
              Open Diagnostics
            </Button>
          </div>

          {launcherNotice && (
            <div
              className={`mb-4 rounded-default border px-3 py-2 text-xs ${
                launcherNotice.kind === "error"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-border bg-bg-primary/40 text-fg-secondary"
              }`}
            >
              {launcherNotice.message}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge
              variant={
                homeStatus?.backend?.state === "ready"
                  ? "default"
                  : homeStatus?.backend
                    ? "outline"
                    : "outline"
              }
            >
              Backend: {homeStatus?.backend?.state === "ready"
                ? "Ready"
                : homeStatus?.backend?.state === "starting"
                  ? "Starting"
                  : homeStatus?.backend?.state === "failed"
                    ? "Failed"
                    : "Stopped"}
            </Badge>
            <Badge
              variant={
                homeStatus?.provider?.configured ? "default" : "outline"
              }
            >
              Provider: {homeStatus?.provider
                ? `${homeStatus.provider.label}${homeStatus.provider.configured ? "" : " (setup needed)"}`
                : "Unknown"}
            </Badge>
            <Badge
              variant={homeStatus?.watcher?.configured ? "default" : "outline"}
            >
              Watcher: {homeStatus?.watcher
                ? homeStatus.watcher.configured
                  ? `${homeStatus.watcher.folderCount} folder${homeStatus.watcher.folderCount === 1 ? "" : "s"}`
                  : "No folders selected"
                : "Unknown"}
            </Badge>
            <Badge
              variant={
                homeStatus?.updater?.state === "error" ? "outline" : "outline"
              }
            >
              Updates: {homeStatus?.updater
                ? homeStatus.updater.state === "downloaded"
                  ? "Ready to install"
                  : homeStatus.updater.state === "downloading"
                    ? "Downloading"
                    : homeStatus.updater.state === "checking"
                      ? "Checking"
                      : homeStatus.updater.state === "unsupported"
                        ? "Packaged builds only"
                        : "Idle"
                : "Unknown"}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <div className="rounded-[var(--radius-default)] border border-border bg-bg-secondary/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock3 size={14} className="text-fg-muted" />
              <p className="text-[13px] font-medium text-fg-primary">Recent projects</p>
            </div>
            {recentProjectItems.length === 0 ? (
              <p className="text-[12px] text-fg-secondary">
                Open a project and it will show up here for quick access.
              </p>
            ) : (
              <div className="space-y-1.5">
                {recentProjectItems.map((recent) => (
                  <button
                    key={recent.id}
                    className="w-full rounded-default border border-transparent hover:border-border hover:bg-bg-primary/30 px-2.5 py-2 text-left transition-colors"
                    onClick={() => selectProject(recent.id, recent.name)}
                  >
                    <p className="text-[13px] text-fg-primary truncate">{recent.name}</p>
                    <p className="text-[11px] text-fg-tertiary font-mono">
                      {recent.existsInList ? relativeTime(recent.updatedAt) : "recently opened"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-[var(--radius-default)] border border-border bg-bg-secondary/20 p-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={14} className="text-fg-muted" />
              <p className="text-[13px] font-medium text-fg-primary">Recent chats</p>
            </div>
            {recentChatsLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-fg-secondary">
                <Spinner size="sm" />
                Loading recent chats...
              </div>
            ) : recentChats.length === 0 ? (
              <p className="text-[12px] text-fg-secondary">
                Start a global chat and your recent sessions will appear here.
              </p>
            ) : (
              <div className="space-y-1.5">
                {recentChats.map((session) => (
                  <button
                    key={session.id}
                    className="w-full rounded-default border border-transparent hover:border-border hover:bg-bg-primary/30 px-2.5 py-2 text-left transition-colors"
                    onClick={() => openRecentGlobalChat(session.id)}
                  >
                    <p className="text-[13px] text-fg-primary truncate">
                      {session.title || "Untitled chat"}
                    </p>
                    <p className="text-[11px] text-fg-tertiary font-mono">
                      {relativeTime(session.updated_at)}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-8 border border-border rounded-[var(--radius-default)] bg-bg-secondary p-4 animate-[slide-down_0.15s_ease-out]">
          <form onSubmit={handleCreate} className="space-y-3">
            <Input
              placeholder="project name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <div className="flex gap-2">
              <Input
                placeholder="source directory (optional)"
                value={newSourceDir}
                readOnly
                className="flex-1 cursor-default"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const dir = await window.momodoc?.selectDirectory();
                  if (dir) setNewSourceDir(dir);
                }}
              >
                <FolderOpen size={14} />
              </Button>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreate(false)}
              >
                cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={creating || !newName.trim()}
              >
                {creating ? "creating..." : "create"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <p className="text-[14px] text-error mb-4 tracking-[-0.01em]">
          {error}
        </p>
      )}

      {/* Global Chat — collapsible */}
      <div ref={searchContainerRef} className="mb-10">
        <div
          className={`transition-all duration-200 ease-out overflow-hidden ${
            expanded ? "max-h-[600px]" : "max-h-[38px]"
          }`}
        >
          {expanded ? (
            <div className="h-[500px] animate-[fade-in_0.15s_ease-out]">
              <UnifiedSearchChat
                isGlobal
                onProjectScores={setProjectScores}
                className="h-full"
                requestedSessionId={requestedGlobalSessionId}
              />
            </div>
          ) : (
            <button
              onClick={() => setExpanded(true)}
              className="w-full h-[38px] flex items-center gap-2.5 px-3.5 bg-bg-secondary border border-border rounded-[var(--radius-default)] text-[13px] text-fg-muted tracking-[-0.01em] hover:border-border-strong hover:text-fg-secondary transition-colors duration-100 cursor-text"
            >
              <MessageSquare size={13} className="shrink-0 opacity-60" />
              Chat across all projects...
            </button>
          )}
        </div>
        {expanded && (
          <button
            onClick={() => {
              setExpanded(false);
              setProjectScores({});
              setRequestedGlobalSessionId(null);
            }}
            className="mt-2 text-[11px] text-fg-muted hover:text-fg-secondary transition-colors duration-100 font-mono"
          >
            collapse
          </button>
        )}
      </div>

      {/* Projects Section */}
      <div>
        <p className="text-[13px] text-fg-tertiary tracking-[-0.01em] font-mono mb-3">
          {totalCount} project{projects.length !== 1 ? "s" : ""}
        </p>

        {projects.length === 0 ? (
          <EmptyState
            icon={Plus}
            title="no projects"
            description="create one to get started"
            action={{
              label: "new project",
              onClick: () => setShowCreate(true),
            }}
          />
        ) : (
          <div className="border border-border rounded-[var(--radius-default)] overflow-hidden">
            {sortedProjects.map((project, i) => {
              const matchCount = projectScores[project.id] || 0;

              if (editingId === project.id) {
                return (
                  <div
                    key={project.id}
                    className={`px-4 py-3.5 bg-bg-secondary ${
                      i !== 0 ? "border-t border-border" : ""
                    }`}
                  >
                    <form onSubmit={handleUpdate} className="space-y-3">
                      <Input
                        placeholder="project name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <Input
                        placeholder="description (optional)"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Input
                          placeholder="source directory (optional)"
                          value={editSourceDir}
                          readOnly
                          className="flex-1 cursor-default"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={async () => {
                            const dir = await window.momodoc?.selectDirectory();
                            if (dir) setEditSourceDir(dir);
                          }}
                        >
                          <FolderOpen size={14} />
                        </Button>
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={cancelEditing}
                        >
                          cancel
                        </Button>
                        <Button
                          type="submit"
                          variant="primary"
                          size="sm"
                          disabled={saving || !editName.trim()}
                        >
                          {saving ? "saving..." : "save"}
                        </Button>
                      </div>
                    </form>
                  </div>
                );
              }

              return (
                <div
                  key={project.id}
                  className={`relative flex items-center gap-4 px-4 py-3.5 transition-colors duration-100 hover:bg-bg-elevated group ${
                    i !== 0 ? "border-t border-border" : ""
                  } ${matchCount > 0 ? "border-l-2 border-l-info" : ""}`}
                  onMouseEnter={() => setHoveredId(project.id)}
                  onMouseLeave={() => {
                    setHoveredId(null);
                    if (deletingId === project.id) setDeletingId(null);
                  }}
                >
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => selectProject(project.id, project.name)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-[15px] font-medium tracking-[-0.02em] truncate">
                        {project.name}
                      </span>
                      {matchCount > 0 && (
                        <Badge variant="default">
                          {matchCount} result{matchCount !== 1 ? "s" : ""}
                        </Badge>
                      )}
                      <span className="text-[12px] text-fg-muted font-mono shrink-0">
                        {relativeTime(project.updated_at)}
                      </span>
                    </div>
                    {project.description && (
                      <p className="text-[14px] text-fg-tertiary tracking-[-0.01em] truncate mt-0.5">
                        {project.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-[12px] text-fg-muted font-mono">
                      <span>{project.file_count} files</span>
                      <span className="text-fg-muted/40">&middot;</span>
                      <span>{project.note_count} notes</span>
                      <span className="text-fg-muted/40">&middot;</span>
                      <span>{project.issue_count} issues</span>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    {deletingId === project.id ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(project.id);
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)] text-[12px] text-error hover:bg-error/10 transition-colors duration-100"
                      >
                        <Check size={12} />
                        confirm
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditing(project);
                          }}
                          className={`p-1.5 rounded-[var(--radius-xs)] text-fg-muted hover:text-fg-primary transition-all duration-100 ${
                            hoveredId === project.id
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                          title="Edit project"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(project.id);
                          }}
                          className={`p-1.5 rounded-[var(--radius-xs)] text-fg-muted hover:text-error transition-all duration-100 ${
                            hoveredId === project.id
                              ? "opacity-100"
                              : "opacity-0"
                          }`}
                          title="Delete project"
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                    <ChevronRight
                      size={14}
                      className="text-fg-muted shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100 ml-1"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        <div ref={sentinelRef} className="h-1" />
        {loadingMore && (
          <div className="flex justify-center py-6">
            <Spinner size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}
