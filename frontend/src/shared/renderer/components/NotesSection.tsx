
import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, StickyNote, X, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import type { Note } from "@/lib/types";
import { relativeTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Spinner } from "./ui/spinner";

interface NotesSectionProps {
  projectId: string;
}

export function NotesSection({ projectId }: NotesSectionProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getNotes(projectId);
      setNotes(data);
    } catch {
      setError("failed to load notes");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const handleSave = async () => {
    if (!newContent.trim()) return;
    setSaving(true);
    try {
      const note = await api.createNote(projectId, {
        content: newContent.trim(),
      });
      setNotes((prev) => [note, ...prev]);
      setNewContent("");
      setCreating(false);
    } catch {
      setError("failed to save note");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId: string) => {
    try {
      await api.deleteNote(projectId, noteId);
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch {
      setError("failed to delete note");
    }
  };

  const startEditing = (note: Note) => {
    setEditingId(note.id);
    setEditContent(note.content);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent("");
  };

  const handleUpdate = async () => {
    if (!editingId || !editContent.trim()) return;
    setEditSaving(true);
    setError(null);
    try {
      const updated = await api.updateNote(projectId, editingId, {
        content: editContent.trim(),
      });
      setNotes((prev) =>
        prev.map((n) => (n.id === editingId ? updated : n))
      );
      setEditingId(null);
    } catch {
      setError("failed to update note");
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="flex-1 w-full p-6 lg:p-10 container-content animate-[fade-in_0.2s_ease-out]">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-[16px] font-semibold tracking-[-0.03em]">
          notes
        </h3>
        <Button
          variant={creating ? "ghost" : "secondary"}
          size="sm"
          title={creating ? "Cancel note" : "New note"}
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
          <Textarea
            autoResize
            placeholder="write a note..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-3">
            <Button
              variant="ghost"
              size="sm"
              title="Cancel note"
              onClick={() => {
                setCreating(false);
                setNewContent("");
              }}
            >
              cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              title="Save note"
              onClick={handleSave}
              disabled={saving || !newContent.trim()}
            >
              {saving ? "saving..." : "save"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title="no notes yet"
          description="Capture key context, findings, or reminders so chat can reference them later."
          action={{ label: "add note", onClick: () => setCreating(true) }}
        />
      ) : (
        <div className="border border-border rounded-[var(--radius-default)] overflow-hidden">
          {notes.map((note, i) =>
            editingId === note.id ? (
              <div
                key={note.id}
                className={`px-4 py-3 bg-bg-secondary ${
                  i !== 0 ? "border-t border-border" : ""
                }`}
              >
                <Textarea
                  autoResize
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Cancel"
                    onClick={cancelEditing}
                  >
                    cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    title="Save"
                    onClick={handleUpdate}
                    disabled={editSaving || !editContent.trim()}
                  >
                    {editSaving ? "saving..." : "save"}
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={note.id}
                className={`flex items-start gap-4 px-4 py-3 transition-colors duration-100 hover:bg-bg-elevated ${
                  i !== 0 ? "border-t border-border" : ""
                }`}
                onMouseEnter={() => setHoveredId(note.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] tracking-[-0.01em] whitespace-pre-wrap line-clamp-3 leading-relaxed">
                    {note.content}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[12px] text-fg-muted font-mono">
                      {relativeTime(note.created_at)}
                    </span>
                    {note.tags &&
                      note.tags.split(",").map((tag) => (
                        <Badge key={tag.trim()} variant="outline">
                          {tag.trim()}
                        </Badge>
                      ))}
                    {note.chunk_count > 0 && (
                      <span className="text-[12px] text-fg-muted font-mono">
                        {note.chunk_count} chunks
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => startEditing(note)}
                    className={`p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-fg-primary transition-all duration-100 ${
                      hoveredId === note.id ? "opacity-100" : "opacity-0"
                    }`}
                    title="Edit note"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className={`p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-error transition-all duration-100 ${
                      hoveredId === note.id ? "opacity-100" : "opacity-0"
                    }`}
                    title="Delete note"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
