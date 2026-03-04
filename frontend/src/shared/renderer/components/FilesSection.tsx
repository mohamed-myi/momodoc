
import { useEffect, useRef, useState, useCallback } from "react";
import { Upload, Trash2, FileText, FolderOpen, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { FileRecord, SyncJob } from "@/lib/types";
import { formatSize, relativeTime, getFileIcon } from "@/lib/utils";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { EmptyState } from "./ui/empty-state";
import { Spinner } from "./ui/spinner";

interface FilesSectionProps {
  projectId: string;
  sourceDirectory?: string | null;
  initialSyncJobId?: string | null;
}

export function FilesSection({ projectId, sourceDirectory, initialSyncJobId }: FilesSectionProps) {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [syncJob, setSyncJob] = useState<SyncJob | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getFiles(projectId);
      setFiles(data);
    } catch {
      setError("failed to load files");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [projectId]);

  // On mount: check for active sync job or use initialSyncJobId
  useEffect(() => {
    if (initialSyncJobId) {
      // Start polling immediately for the auto-triggered sync
      api.getJob(projectId, initialSyncJobId).then(setSyncJob).catch(() => {});
      return;
    }
    // Check if there's already a running sync job for this project
    if (sourceDirectory) {
      api.getSyncStatus(projectId).then((job) => {
        if (job && (job.status === "pending" || job.status === "running")) {
          setSyncJob(job);
        }
      }).catch(() => {});
    }
  }, [projectId, initialSyncJobId, sourceDirectory]);

  // Poll for sync job status
  useEffect(() => {
    if (!syncJob || syncJob.status === "completed" || syncJob.status === "failed") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      if (syncJob?.status === "completed") {
        fetchFiles();
      }
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const job = await api.getJob(projectId, syncJob.id);
        setSyncJob(job);
      } catch {
        // ignore polling errors
      }
    }, 1000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [syncJob?.status, syncJob?.id, projectId]);

  const uploadFiles = async (fileList: File[]) => {
    if (fileList.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadProgress({ current: 0, total: fileList.length });
    const newFiles: FileRecord[] = [];
    const errors: string[] = [];
    for (let i = 0; i < fileList.length; i++) {
      setUploadProgress({ current: i + 1, total: fileList.length });
      try {
        const record = await api.uploadFile(projectId, fileList[i]);
        newFiles.push(record);
      } catch {
        errors.push(fileList[i].name);
      }
    }
    setFiles((prev) => [...newFiles, ...prev]);
    if (errors.length > 0) {
      setError(`failed to upload: ${errors.join(", ")}`);
    }
    setUploading(false);
    setUploadProgress(null);
    if (inputRef.current) inputRef.current.value = "";
    if (dirInputRef.current) dirInputRef.current.value = "";
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    await uploadFiles(Array.from(fileList));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const fileList = e.dataTransfer.files;
    if (fileList && fileList.length > 0) uploadFiles(Array.from(fileList));
  }, [projectId]);

  const handleSync = async () => {
    setError(null);
    try {
      const job = await api.startSync(projectId);
      setSyncJob(job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start sync");
    }
  };

  const handleDelete = async (fileId: string) => {
    try {
      await api.deleteFile(projectId, fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      setError("failed to delete file");
    }
  };

  const isSyncing = syncJob?.status === "pending" || syncJob?.status === "running";
  const completedFiles = syncJob?.completed_files ?? syncJob?.processed_files ?? 0;
  const succeededFiles =
    syncJob?.succeeded_files ??
    Math.max(
      completedFiles - (syncJob?.skipped_files ?? 0) - (syncJob?.failed_files ?? 0),
      0
    );

  return (
    <div className="flex-1 w-full p-6 lg:p-10 container-content animate-[fade-in_0.2s_ease-out]">
      <div className="flex items-center justify-between mb-8">
        <h3 className="text-[16px] font-semibold tracking-[-0.03em]">
          files
        </h3>
        <div className="flex items-center gap-2">
          {uploading && uploadProgress && (
            <span className="text-[12px] text-fg-muted font-mono">
              {uploadProgress.current}/{uploadProgress.total}
            </span>
          )}
          {uploading && <Spinner size="sm" />}
          {sourceDirectory && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              disabled={uploading || isSyncing}
            >
              <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
              sync
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dirInputRef.current?.click()}
            disabled={uploading}
          >
            <FolderOpen size={13} />
            folder
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            <Upload size={13} />
            upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            data-testid="file-upload-input"
            onChange={handleUpload}
            multiple
          />
          <input
            ref={dirInputRef}
            type="file"
            className="hidden"
            onChange={handleUpload}
            {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)}
            multiple
          />
        </div>
      </div>

      {error && (
        <p className="text-[14px] text-error mb-4 tracking-[-0.01em]">
          {error}
        </p>
      )}

      {/* Sync progress */}
      {syncJob && isSyncing && (
        <div className="mb-4 p-3 border border-border rounded-[var(--radius-default)] bg-bg-secondary">
          <div className="flex items-center justify-between text-[13px] mb-2">
            <span className="text-fg-secondary tracking-[-0.01em]">
              syncing... {completedFiles}/{syncJob.total_files} files
            </span>
            {syncJob.current_file && (
              <span className="text-[11px] text-fg-muted font-mono truncate ml-4 max-w-[200px]">
                {syncJob.current_file}
              </span>
            )}
          </div>
          <div className="w-full h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-fg-secondary transition-all duration-200 rounded-full"
              style={{
                width: syncJob.total_files > 0
                  ? `${(completedFiles / syncJob.total_files) * 100}%`
                  : "0%",
              }}
            />
          </div>
          {syncJob.failed_files > 0 && (
            <p className="text-[11px] text-error mt-1.5 tracking-[-0.01em]">
              {syncJob.failed_files} error{syncJob.failed_files !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Sync completed summary */}
      {syncJob?.status === "completed" && (
        <div className="mb-4 p-3 border border-border rounded-[var(--radius-default)] bg-bg-secondary">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-fg-secondary tracking-[-0.01em]">
              sync complete — {completedFiles} files completed, {succeededFiles} succeeded,{" "}
              {syncJob.skipped_files} unchanged, {syncJob.total_chunks} chunks
            </span>
            <button
              onClick={() => setSyncJob(null)}
              className="text-[11px] text-fg-muted hover:text-fg-secondary transition-colors"
            >
              dismiss
            </button>
          </div>
          {syncJob.failed_files > 0 && (
            <p className="text-[11px] text-error mt-1 tracking-[-0.01em]">
              {syncJob.failed_files} error{syncJob.failed_files !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border border-dashed rounded-[var(--radius-default)] py-6 mb-8 text-center transition-colors duration-100 ${
          dragOver
            ? "border-fg-secondary bg-fg-primary/[0.02]"
            : "border-border hover:border-border-strong"
        }`}
      >
        <p className="text-[13px] text-fg-muted tracking-[-0.01em]">
          drop files or folders here or{" "}
          <button
            onClick={() => inputRef.current?.click()}
            className="text-fg-secondary underline underline-offset-2 decoration-fg-muted hover:decoration-fg-secondary transition-colors"
          >
            browse
          </button>
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="no files"
          description={
            sourceDirectory
              ? "Upload files, drop a folder, or run sync to index your source directory."
              : "Upload files now or set a source directory for one-click syncing."
          }
          action={{
            label: "browse files",
            onClick: () => inputRef.current?.click(),
          }}
        />
      ) : (
        <div className="border border-border rounded-[var(--radius-default)] overflow-hidden">
          {files.map((file, i) => {
            const Icon = getFileIcon(file.file_type);
            return (
              <div
                key={file.id}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors duration-100 hover:bg-bg-elevated ${
                  i !== 0 ? "border-t border-border" : ""
                }`}
                onMouseEnter={() => setHoveredId(file.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <Icon size={14} className="text-fg-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-[14px] font-medium tracking-[-0.01em] truncate block">
                    {file.filename}
                  </span>
                </div>
                <Badge variant="outline">{file.file_type}</Badge>
                <span className="text-[12px] text-fg-muted font-mono shrink-0">
                  {formatSize(file.file_size)}
                </span>
                {file.chunk_count > 0 && (
                  <span className="text-[12px] text-fg-muted font-mono shrink-0">
                    {file.chunk_count} chunks
                  </span>
                )}
                <span className="text-[12px] text-fg-muted font-mono shrink-0">
                  {relativeTime(file.created_at)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(file.id);
                  }}
                  className={`p-1 rounded-[var(--radius-xs)] text-fg-muted hover:text-error transition-all duration-100 shrink-0 ${
                    hoveredId === file.id ? "opacity-100" : "opacity-0"
                  }`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
