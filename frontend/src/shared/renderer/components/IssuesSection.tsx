
import { useEffect, useState } from "react";
import { Plus, Trash2, CheckCircle, Circle, X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import type { Issue } from "@/lib/types";
import { relativeTime, getPriorityVariant } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Spinner } from "./ui/spinner";

interface IssuesSectionProps {
  projectId: string;
}

export function IssuesSection({ projectId }: IssuesSectionProps) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPriority, setNewPriority] = useState<Issue["priority"]>("medium");
  const [saving, setSaving] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const fetchIssues = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getIssues(projectId);
      setIssues(data);
    } catch {
      setError("failed to load issues");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues();
  }, [projectId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const issue = await api.createIssue(projectId, {
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        priority: newPriority,
      });
      setIssues((prev) => [issue, ...prev]);
      setNewTitle("");
      setNewDescription("");
      setNewPriority("medium");
      setCreating(false);
    } catch {
      setError("failed to create issue");
    } finally {
      setSaving(false);
    }
  };

  const cycleStatus = async (issue: Issue) => {
    const nextStatus: Record<string, "open" | "in_progress" | "done"> = {
      open: "in_progress",
      in_progress: "done",
      done: "open",
    };
    const newStatus = nextStatus[issue.status] || "open";
    try {
      const updated = await api.updateIssue(projectId, issue.id, {
        status: newStatus,
      });
      setIssues((prev) =>
        prev.map((i) => (i.id === issue.id ? updated : i))
      );
    } catch {
      setError("failed to update issue");
    }
  };

  const handleDelete = async (issueId: string) => {
    try {
      await api.deleteIssue(projectId, issueId);
      setIssues((prev) => prev.filter((i) => i.id !== issueId));
    } catch {
      setError("failed to delete issue");
    }
  };

  const openIssues = issues.filter((i) => i.status !== "done");
  const doneIssues = issues.filter((i) => i.status === "done");

  return (
    <div className="flex-1 w-full p-6 lg:p-10 container-content animate-[fade-in_0.2s_ease-out]">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-[16px] font-semibold tracking-[-0.03em]">
          issues
        </h3>
        <Button
          variant={creating ? "ghost" : "secondary"}
          size="sm"
          onClick={() => setCreating(!creating)}
        >
          {creating ? (
            <>
              <X size={13} />
              cancel
            </>
          ) : (
            <>
              <Plus size={13} />
              add
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="text-[14px] text-error mb-4 tracking-[-0.01em]">
          {error}
        </p>
      )}

      {creating && (
        <div className="mb-8 border border-border rounded-[var(--radius-default)] bg-bg-secondary p-4 animate-[slide-down_0.15s_ease-out]">
          <form onSubmit={handleCreate} className="space-y-3">
            <Input
              placeholder="issue title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="description (optional)"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Select
                value={newPriority}
                onChange={(e) =>
                  setNewPriority(e.target.value as Issue["priority"])
                }
              >
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </Select>
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreating(false)}
              >
                cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={saving || !newTitle.trim()}
              >
                {saving ? "creating..." : "create"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : issues.length === 0 ? (
        <EmptyState
          icon={CheckCircle}
          title="no issues"
          description="Track tasks, bugs, and follow-ups you want Momodoc to keep visible while you work."
          action={{ label: "add issue", onClick: () => setCreating(true) }}
        />
      ) : (
        <>
          {/* Open issues */}
          {openIssues.length > 0 && (
            <div className="border border-border rounded-[var(--radius-default)] overflow-hidden mb-8">
              {openIssues.map((issue, i) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  onCycleStatus={cycleStatus}
                  onDelete={handleDelete}
                  showBorder={i !== 0}
                />
              ))}
            </div>
          )}

          {/* Done issues */}
          {doneIssues.length > 0 && (
            <div>
              <button
                onClick={() => setShowDone(!showDone)}
                className="flex items-center gap-1.5 text-[13px] text-fg-muted tracking-[-0.01em] mb-3 hover:text-fg-secondary transition-colors duration-100 font-mono"
              >
                {showDone ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {doneIssues.length} completed
              </button>
              {showDone && (
                <div className="border border-border rounded-[var(--radius-default)] overflow-hidden animate-[slide-down_0.1s_ease-out]">
                  {doneIssues.map((issue, i) => (
                    <IssueRow
                      key={issue.id}
                      issue={issue}
                      hoveredId={hoveredId}
                      onHover={setHoveredId}
                      onCycleStatus={cycleStatus}
                      onDelete={handleDelete}
                      showBorder={i !== 0}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IssueRow({
  issue,
  hoveredId,
  onHover,
  onCycleStatus,
  onDelete,
  showBorder,
}: {
  issue: Issue;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onCycleStatus: (issue: Issue) => void;
  onDelete: (id: string) => void;
  showBorder: boolean;
}) {
  const isDone = issue.status === "done";
  const isInProgress = issue.status === "in_progress";

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-bg-elevated ${
        showBorder ? "border-t border-border" : ""
      }`}
      onMouseEnter={() => onHover(issue.id)}
      onMouseLeave={() => onHover(null)}
    >
      <button
        onClick={() => onCycleStatus(issue)}
        className="shrink-0 transition-colors duration-100"
        title={`Status: ${issue.status}. Click to cycle.`}
      >
        {isDone ? (
          <CheckCircle size={16} className="text-success" />
        ) : isInProgress ? (
          <Loader2 size={16} className="text-fg-secondary animate-[spin_2s_linear_infinite]" />
        ) : (
          <Circle size={16} className="text-fg-muted hover:text-fg-secondary" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p
          className={`text-[14px] tracking-[-0.01em] truncate ${
            isDone ? "line-through text-fg-muted" : ""
          }`}
        >
          {issue.title}
        </p>
        {issue.description && !isDone && (
          <p className="text-[13px] text-fg-muted tracking-[-0.01em] truncate mt-0.5">
            {issue.description}
          </p>
        )}
      </div>
      <Badge variant={getPriorityVariant(issue.priority)}>
        {issue.priority}
      </Badge>
      <span className="text-[12px] text-fg-muted font-mono shrink-0">
        {relativeTime(issue.created_at)}
      </span>
      <button
        onClick={() => onDelete(issue.id)}
        className={`p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-error transition-all duration-100 shrink-0 ${
          hoveredId === issue.id ? "opacity-100" : "opacity-0"
        }`}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
