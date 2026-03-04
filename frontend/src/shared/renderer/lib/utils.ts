import {
  FileText,
  Code,
  FileType2,
  File,
  type LucideIcon,
} from "lucide-react";

/**
 * Format a date string as a relative time (e.g., "2h ago", "3d ago").
 */
export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Format a byte count as a human-readable size (e.g., "1.2 MB").
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get the appropriate icon for a file type.
 */
const codeTypes = new Set([
  "py", "python", "js", "javascript", "ts", "typescript", "tsx", "jsx",
  "java", "go", "rust", "rs", "c", "cpp", "rb", "ruby", "php", "swift",
  "kotlin", "scala", "bash", "sh", "sql", "yaml", "yml", "json", "toml",
  "xml", "html", "css", "scss",
]);

const docTypes = new Set(["pdf", "docx", "doc", "txt", "rtf"]);

export function getFileIcon(fileType: string | undefined | null): LucideIcon {
  if (!fileType) return File;
  const ft = fileType.toLowerCase().replace(".", "");
  if (ft === "md" || ft === "markdown") return FileText;
  if (codeTypes.has(ft)) return Code;
  if (docTypes.has(ft)) return FileType2;
  return File;
}

/**
 * Get badge variant for issue priority.
 */
export function getPriorityVariant(priority: string): "error" | "warning" | "default" | "outline" {
  switch (priority) {
    case "critical": return "error";
    case "high": return "warning";
    case "medium": return "default";
    case "low": return "outline";
    default: return "default";
  }
}

/**
 * Debounce a function call.
 */
export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = (...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced as T & { cancel: () => void };
}
