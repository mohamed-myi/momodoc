
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileText,
  StickyNote,
  CheckCircle,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Project } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { FilesSection } from "./FilesSection";
import { NotesSection } from "./NotesSection";
import { IssuesSection } from "./IssuesSection";
import { UnifiedSearchChat } from "./UnifiedSearchChat";
import { LoadingPage } from "./LoadingPage";
import { ErrorPage } from "./ErrorPage";

type Section = "files" | "notes" | "issues" | "chat";

interface ProjectViewProps {
  projectId: string;
  onBack: () => void;
}

const sections: { key: Section; label: string; icon: typeof FileText }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "files", label: "Files", icon: FileText },
  { key: "notes", label: "Notes", icon: StickyNote },
  { key: "issues", label: "Issues", icon: CheckCircle },
];

const NAV_COLLAPSED_KEY = "momodoc-nav-collapsed-v2";

export function ProjectView({ projectId, onBack }: ProjectViewProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("chat");
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "true";
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAV_COLLAPSED_KEY, String(next));
      return next;
    });
  };

  const fetchProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProject(projectId);
      setProject(data);
    } catch {
      setError("failed to load project");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProject();
  }, [projectId]);

  if (loading) return <LoadingPage />;
  if (error || !project)
    return <ErrorPage message={error || "project not found"} onRetry={fetchProject} />;

  const sectionCounts: Record<string, number> = {
    files: project.file_count,
    notes: project.note_count,
    issues: project.issue_count,
  };

  const renderSection = () => {
    switch (activeSection) {
      case "files":
        return <FilesSection projectId={projectId} sourceDirectory={project.source_directory} initialSyncJobId={project.sync_job_id} />;
      case "notes":
        return <NotesSection projectId={projectId} />;
      case "issues":
        return <IssuesSection projectId={projectId} />;
      case "chat":
        return (
          <div className="flex-1 min-h-0 flex flex-col">
            <UnifiedSearchChat projectId={projectId} className="h-full" />
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-row">
      <aside
        className="flex flex-col shrink-0 bg-bg-secondary border-r border-border overflow-hidden transition-[width] duration-200 ease-out"
        style={{ width: collapsed ? 48 : 220 }}
      >
        {/* Header: back + project info (expanded) or just back icon (collapsed) */}
        <div className={`shrink-0 ${collapsed ? "px-0 pt-3 pb-2" : "px-3 pt-3 pb-2"}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={onBack}
                className="p-1.5 text-fg-muted hover:text-fg-primary transition-colors duration-100"
                title="Back to projects"
              >
                <ArrowLeft size={14} />
              </button>
              <button
                onClick={toggleCollapsed}
                className="p-1.5 text-fg-muted hover:text-fg-primary transition-colors duration-100"
                title="Expand sidebar"
              >
                <PanelLeftOpen size={14} />
              </button>
            </div>
          ) : (
            <div className="overflow-hidden">
              <div className="flex items-center justify-between gap-1">
                <button
                  onClick={onBack}
                  className="flex items-center gap-1 text-[11px] text-fg-muted tracking-[-0.01em] hover:text-fg-primary transition-colors duration-100 group shrink-0"
                >
                  <ArrowLeft size={10} className="group-hover:-translate-x-0.5 transition-transform duration-100" />
                  <span>back</span>
                </button>
                <button
                  onClick={toggleCollapsed}
                  className="p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-fg-primary transition-colors duration-100 shrink-0"
                  title="Collapse sidebar"
                >
                  <PanelLeftClose size={12} />
                </button>
              </div>
              <h2 className="mt-2 text-[13px] font-semibold tracking-[-0.02em] leading-tight truncate text-fg-primary">
                {project.name}
              </h2>
              {project.last_sync_at && (
                <p className="mt-0.5 text-[10px] text-fg-muted font-mono truncate">
                  {project.last_sync_status === "failed" ? "sync failed" : "synced"}{" "}
                  {relativeTime(project.last_sync_at)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Separator */}
        {!collapsed && <div className="mx-3 border-t border-border" />}

        {/* Nav items */}
        <nav className={`flex-1 mt-1 ${collapsed ? "px-0" : "px-1.5"}`}>
          {sections.map(({ key, label, icon: Icon }) => {
            const isActive = activeSection === key;
            const count = sectionCounts[key];

            if (collapsed) {
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className={`w-full flex items-center justify-center py-3 transition-colors duration-100 ${
                    isActive
                      ? "text-fg-primary bg-bg-elevated border-l-2 border-l-fg-primary"
                      : "text-fg-secondary hover:text-fg-primary border-l-2 border-l-transparent"
                  }`}
                  title={label}
                >
                  <Icon size={15} className={isActive ? "text-fg-primary" : "text-fg-muted"} />
                </button>
              );
            }

            return (
              <button
                key={key}
                onClick={() => setActiveSection(key)}
                className={`w-full flex items-center gap-3 px-3 py-3 text-[15px] tracking-[-0.01em] transition-colors duration-100 ${
                  isActive
                    ? "text-fg-primary bg-bg-elevated border-l-2 border-l-fg-primary rounded-r-[var(--radius-sm)]"
                    : "text-fg-secondary hover:text-fg-primary border-l-2 border-l-transparent"
                }`}
              >
                <Icon size={18} className={isActive ? "text-fg-primary" : "text-fg-muted"} />
                <span className="flex-1 text-left truncate">{label}</span>
                {count !== undefined && count > 0 && (
                  <span className="text-[13px] font-mono text-fg-muted shrink-0">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

      </aside>

      {/* Content area */}
      <main className="flex-1 min-h-0 min-w-0 flex flex-col">
        {renderSection()}
      </main>
    </div>
  );
}
