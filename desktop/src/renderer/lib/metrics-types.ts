export interface MetricsOverview {
  total_projects: number;
  total_files: number;
  total_chunks: number;
  total_sessions: number;
  total_messages: number;
  total_storage_bytes: number;
  uptime_seconds: number;
}

export interface ProjectMetric {
  project_id: string;
  project_name: string;
  file_count: number;
  note_count: number;
  issue_count: number;
  chunk_count: number;
  message_count: number;
  storage_bytes: number;
  last_activity: string | null;
}

export interface ChatMetrics {
  daily: Array<{
    date: string;
    sessions: number;
    messages: number;
  }>;
  total_sessions: number;
  total_messages: number;
  avg_messages_per_session: number;
}

export interface StorageMetrics {
  total_bytes: number;
  uploads_bytes: number;
  database_bytes: number;
  vectors_bytes: number;
  by_file_type: Array<{
    file_type: string;
    count: number;
    total_bytes: number;
  }>;
}

export interface SyncMetrics {
  daily: Array<{
    date: string;
    jobs: number;
    files_processed: number;
    errors: number;
  }>;
  total_jobs: number;
  avg_duration_seconds: number;
  error_rate: number;
  total_files_processed: number;
}
