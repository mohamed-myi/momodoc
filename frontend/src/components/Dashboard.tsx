"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X, ChevronRight, Pencil, Trash2, Check, MessageSquare, FolderOpen, Settings } from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { useInfiniteScroll } from "@/lib/hooks";
import { DirectoryBrowserModal } from "@/shared/renderer/components/DirectoryBrowserModal";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Spinner } from "./ui/spinner";
import { LoadingPage } from "./LoadingPage";
import { ErrorPage } from "./ErrorPage";
import { UnifiedSearchChat } from "./UnifiedSearchChat";

const PROJECTS_PER_PAGE = 20;

interface DashboardProps {
  onSelectProject: (id: string) => void;
  onOpenSettings?: () => void;
}

export function Dashboard({ onSelectProject, onOpenSettings }: DashboardProps) {
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

  // Directory browser modal state
  const [browseTarget, setBrowseTarget] = useState<"create" | "edit" | null>(null);

  // Search/chat collapsible state
  const [expanded, setExpanded] = useState(false);
  const [projectScores, setProjectScores] = useState<Record<string, number>>({});
  const searchContainerRef = useRef<HTMLDivElement>(null);

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
        onSelectProject(project.id);
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

  if (loading) return <LoadingPage />;
  if (error && projects.length === 0)
    return <ErrorPage message={error} onRetry={() => loadProjects(true)} />;

  const totalCount = projects.length + (hasMore ? "+" : "");

  return (
    <div className="min-h-screen px-6 pt-24 pb-16 container-dashboard animate-[fade-in_0.2s_ease-out]">
      {/* Header */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.045em] leading-none">
            momodoc
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {onOpenSettings && (
            <Button variant="ghost" size="sm" onClick={onOpenSettings} title="Settings">
              <Settings size={13} />
            </Button>
          )}
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
                onClick={() => setBrowseTarget("create")}
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
                          onClick={() => setBrowseTarget("edit")}
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
                    onClick={() => onSelectProject(project.id)}
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

      <DirectoryBrowserModal
        open={browseTarget !== null}
        onClose={() => setBrowseTarget(null)}
        onSelect={(path) => {
          if (browseTarget === "create") setNewSourceDir(path);
          else if (browseTarget === "edit") setEditSourceDir(path);
          setBrowseTarget(null);
        }}
        browse={(path) => api.browseDirectories(path)}
      />
    </div>
  );
}
