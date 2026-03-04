"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Folder, ArrowLeft } from "lucide-react";
import type { BrowseResponse } from "../lib/types";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

interface DirectoryBrowserModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  browse: (path?: string) => Promise<BrowseResponse>;
}

export function DirectoryBrowserModal({
  open,
  onClose,
  onSelect,
  browse,
}: DirectoryBrowserModalProps) {
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      setSelectedPath(null);
      try {
        const res = await browse(path);
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to browse directories");
      } finally {
        setLoading(false);
      }
    },
    [browse],
  );

  useEffect(() => {
    if (open) {
      load();
    } else {
      setData(null);
      setError(null);
      setSelectedPath(null);
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const pathSegments = data?.current_path?.split("/").filter(Boolean) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-[fade-in_0.1s_ease-out]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-bg-primary border border-border rounded-[var(--radius-default)] shadow-2xl animate-[slide-down_0.15s_ease-out] flex flex-col max-h-[70vh]">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          {data?.current_path && (
            <button
              onClick={() => {
                if (data.parent_path) {
                  load(data.parent_path);
                } else {
                  load();
                }
              }}
              className="p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-fg-primary transition-colors duration-100"
            >
              <ArrowLeft size={14} />
            </button>
          )}
          <span className="text-[14px] font-medium tracking-[-0.01em] text-fg-primary">
            select folder
          </span>
        </div>

        {/* Breadcrumb */}
        {data?.current_path && (
          <div className="flex items-center gap-0.5 px-4 py-2 border-b border-border text-[12px] font-mono text-fg-muted overflow-x-auto shrink-0">
            <button
              onClick={() => load()}
              className="hover:text-fg-primary transition-colors duration-100 shrink-0"
            >
              roots
            </button>
            {pathSegments.map((segment, i) => {
              const segmentPath = "/" + pathSegments.slice(0, i + 1).join("/");
              const isLast = i === pathSegments.length - 1;
              return (
                <span key={segmentPath} className="flex items-center gap-0.5">
                  <ChevronRight size={10} className="opacity-40 shrink-0" />
                  {isLast ? (
                    <span className="text-fg-primary shrink-0">{segment}</span>
                  ) : (
                    <button
                      onClick={() => load(segmentPath)}
                      className="hover:text-fg-primary transition-colors duration-100 shrink-0"
                    >
                      {segment}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Spinner size="sm" />
            </div>
          )}

          {error && (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-error tracking-[-0.01em]">{error}</p>
              <button
                onClick={() => load(data?.current_path ?? undefined)}
                className="mt-2 text-[12px] text-fg-muted hover:text-fg-primary transition-colors duration-100 font-mono"
              >
                retry
              </button>
            </div>
          )}

          {!loading && !error && data && data.entries.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-[13px] text-fg-muted tracking-[-0.01em]">
                {data.current_path ? "no subdirectories" : "no allowed paths configured"}
              </p>
            </div>
          )}

          {!loading &&
            !error &&
            data?.entries.map((entry) => (
              <button
                key={entry.path}
                onClick={() => setSelectedPath(entry.path)}
                onDoubleClick={() => load(entry.path)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left transition-colors duration-100 ${
                  selectedPath === entry.path
                    ? "bg-bg-elevated text-fg-primary"
                    : "text-fg-secondary hover:bg-bg-secondary"
                }`}
              >
                <Folder size={14} className="shrink-0 text-fg-muted" />
                <span className="text-[13px] tracking-[-0.01em] truncate">
                  {entry.name}
                </span>
                <ChevronRight size={12} className="ml-auto shrink-0 text-fg-muted opacity-40" />
              </button>
            ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border shrink-0">
          <span className="text-[11px] font-mono text-fg-muted truncate flex-1">
            {selectedPath ?? data?.current_path ?? ""}
          </span>
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose}>
              cancel
            </Button>
            {data?.current_path && !selectedPath && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSelect(data.current_path!)}
              >
                select this folder
              </Button>
            )}
            {selectedPath && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSelect(selectedPath)}
              >
                select
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
