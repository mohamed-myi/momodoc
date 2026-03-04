import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  FolderOpen,
  FileText,
  Layers,
  MessageSquare,
  HardDrive,
  Clock,
  ArrowUpDown,
  RefreshCw,
} from "lucide-react";
import { Card } from "../ui/card";
import { Spinner } from "../ui/spinner";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { api } from "@/lib/api";
import { formatSize } from "@/lib/utils";
import type {
  MetricsOverview,
  ProjectMetric,
  ChatMetrics,
  StorageMetrics,
  SyncMetrics,
} from "@/lib/metrics-types";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

type SortKey = "project_name" | "file_count" | "chunk_count" | "message_count" | "storage_bytes";

export function MetricsDashboard() {
  const [overview, setOverview] = useState<MetricsOverview | null>(null);
  const [projects, setProjects] = useState<ProjectMetric[]>([]);
  const [chat, setChat] = useState<ChatMetrics | null>(null);
  const [storage, setStorage] = useState<StorageMetrics | null>(null);
  const [sync, setSync] = useState<SyncMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("project_name");
  const [sortAsc, setSortAsc] = useState(true);

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, p, c, s, sy] = await Promise.all([
        api.getMetricsOverview(),
        api.getProjectMetrics(),
        api.getChatMetrics(30),
        api.getStorageMetrics(),
        api.getSyncMetrics(30),
      ]);
      setOverview(o);
      setProjects(p);
      setChat(c);
      setStorage(s);
      setSync(sy);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const sortedProjects = [...projects].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") {
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-dashboard py-8 px-4">
        <div className="text-center">
          <p className="text-fg-secondary mb-3">{error}</p>
          <Button variant="secondary" size="sm" onClick={loadMetrics}>
            <RefreshCw size={13} />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container-dashboard py-8 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 font-semibold text-fg-primary">Metrics</h1>
        <Button variant="ghost" size="sm" onClick={loadMetrics}>
          <RefreshCw size={13} />
        </Button>
      </div>

      {/* Overview stat cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={FolderOpen} label="Projects" value={overview.total_projects} />
          <StatCard icon={FileText} label="Files" value={overview.total_files} />
          <StatCard icon={Layers} label="Chunks" value={overview.total_chunks.toLocaleString()} />
          <StatCard icon={MessageSquare} label="Messages" value={overview.total_messages} />
          <StatCard icon={HardDrive} label="Storage" value={formatSize(overview.total_storage_bytes)} />
          <StatCard icon={Clock} label="Uptime" value={formatUptime(overview.uptime_seconds)} />
        </div>
      )}

      {/* Per-project table */}
      {projects.length > 0 && (
        <Card>
          <div className="p-4">
            <h2 className="text-h3 font-medium text-fg-primary mb-3">Projects</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <SortHeader label="Name" sortKey="project_name" currentKey={sortKey} asc={sortAsc} onSort={handleSort} />
                    <SortHeader label="Files" sortKey="file_count" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                    <SortHeader label="Chunks" sortKey="chunk_count" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                    <SortHeader label="Messages" sortKey="message_count" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                    <SortHeader label="Storage" sortKey="storage_bytes" currentKey={sortKey} asc={sortAsc} onSort={handleSort} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sortedProjects.map((p) => (
                    <tr key={p.project_id} className="border-b border-border/50 hover:bg-hover">
                      <td className="py-2 pr-4 text-fg-primary">{p.project_name}</td>
                      <td className="py-2 pr-4 text-fg-secondary text-right">{p.file_count}</td>
                      <td className="py-2 pr-4 text-fg-secondary text-right">{p.chunk_count.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-fg-secondary text-right">{p.message_count}</td>
                      <td className="py-2 text-fg-secondary text-right">{formatSize(p.storage_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* Activity charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Daily messages */}
        {chat && chat.daily.length > 0 && (
          <Card>
            <div className="p-4">
              <h2 className="text-h3 font-medium text-fg-primary mb-1">Chat Activity (30d)</h2>
              <p className="text-xs text-fg-secondary mb-3">
                {chat.total_messages} messages across {chat.total_sessions} sessions
                ({chat.avg_messages_per_session.toFixed(1)} avg/session)
              </p>
              <BarChart
                data={chat.daily.map((d) => ({ label: d.date.slice(5), value: d.messages }))}
                color="var(--color-info)"
              />
            </div>
          </Card>
        )}

        {/* Sync activity */}
        {sync && sync.daily.length > 0 && (
          <Card>
            <div className="p-4">
              <h2 className="text-h3 font-medium text-fg-primary mb-1">Sync Jobs (30d)</h2>
              <p className="text-xs text-fg-secondary mb-3">
                {sync.total_jobs} jobs, {sync.total_files_processed} files processed,{" "}
                {(sync.error_rate * 100).toFixed(1)}% error rate
              </p>
              <BarChart
                data={sync.daily.map((d) => ({ label: d.date.slice(5), value: d.files_processed }))}
                color="var(--color-success)"
              />
            </div>
          </Card>
        )}
      </div>

      {/* Storage breakdown */}
      {storage && (
        <Card>
          <div className="p-4">
            <h2 className="text-h3 font-medium text-fg-primary mb-3">Storage Breakdown</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-xs text-fg-secondary">Uploads</p>
                <p className="text-sm text-fg-primary font-medium">{formatSize(storage.uploads_bytes)}</p>
              </div>
              <div>
                <p className="text-xs text-fg-secondary">Database</p>
                <p className="text-sm text-fg-primary font-medium">{formatSize(storage.database_bytes)}</p>
              </div>
              <div>
                <p className="text-xs text-fg-secondary">Vectors</p>
                <p className="text-sm text-fg-primary font-medium">{formatSize(storage.vectors_bytes)}</p>
              </div>
            </div>
            {storage.by_file_type.length > 0 && (
              <div>
                <p className="text-xs text-fg-secondary mb-2">By file type</p>
                <div className="flex gap-1 h-6 rounded-sm overflow-hidden">
                  {storage.by_file_type.map((ft, i) => {
                    const pct = storage.total_bytes > 0 ? (ft.total_bytes / storage.total_bytes) * 100 : 0;
                    if (pct < 1) return null;
                    const colors = FILE_TYPE_COLORS;
                    return (
                      <div
                        key={ft.file_type}
                        style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }}
                        className="h-full"
                        title={`${ft.file_type}: ${formatSize(ft.total_bytes)} (${ft.count} files)`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-3 mt-2">
                  {storage.by_file_type.map((ft, i) => {
                    const colors = FILE_TYPE_COLORS;
                    return (
                      <div key={ft.file_type} className="flex items-center gap-1.5 text-xs text-fg-secondary">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: colors[i % colors.length] }}
                        />
                        {ft.file_type} ({ft.count})
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

const FILE_TYPE_COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6", "#ec4899"];

function StatCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number }) {
  return (
    <Card>
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={14} className="text-fg-tertiary" />
          <span className="text-xs text-fg-secondary">{label}</span>
        </div>
        <p className="text-lg font-semibold text-fg-primary">{value}</p>
      </div>
    </Card>
  );
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  asc,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  asc: boolean;
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = sortKey === currentKey;
  return (
    <th
      className={`py-2 pr-4 text-xs font-medium text-fg-secondary cursor-pointer hover:text-fg-primary select-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (
          <ArrowUpDown size={10} className={`${asc ? "" : "rotate-180"} transition-transform`} />
        )}
      </span>
    </th>
  );
}

function BarChart({ data, color }: { data: Array<{ label: string; value: number }>; color: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="flex items-end gap-[2px] h-24">
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
          <div
            className="w-full rounded-t-sm transition-all"
            style={{
              height: `${(d.value / max) * 100}%`,
              backgroundColor: color,
              minHeight: d.value > 0 ? "2px" : "0",
              opacity: 0.8,
            }}
            title={`${d.label}: ${d.value}`}
          />
        </div>
      ))}
    </div>
  );
}
