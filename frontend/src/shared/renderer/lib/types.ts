export interface Project {
  id: string;
  name: string;
  description: string | null;
  source_directory: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
  note_count: number;
  issue_count: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  sync_job_id: string | null;
}

export interface CreateProject {
  name: string;
  description?: string;
  source_directory?: string;
}

export interface FileRecord {
  id: string;
  project_id: string;
  filename: string;
  original_path: string | null;
  file_type: string;
  file_size: number;
  chunk_count: number;
  indexed_at: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  project_id: string;
  content: string;
  tags: string | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateNote {
  content: string;
  tags?: string;
}

export interface Issue {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "critical";
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateIssue {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "critical";
}

export interface ChatSession {
  id: string;
  project_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSource {
  source_type: "file" | "note" | "issue";
  source_id: string;
  filename: string | null;
  original_path: string | null;
  chunk_text: string;
  chunk_index: number;
  score: number;
  section_header?: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  sources: ChatSource[];
  created_at: string;
}

export interface SearchResult {
  source_type: "file" | "note" | "issue";
  source_id: string;
  filename: string | null;
  original_path: string | null;
  chunk_text: string;
  chunk_index: number;
  file_type: string;
  score: number;
  project_id: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query_plan: Record<string, unknown> | null;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface BrowseResponse {
  current_path: string | null;
  parent_path: string | null;
  entries: DirectoryEntry[];
}

export interface LLMProviderInfo {
  name: string;
  available: boolean;
  model: string;
}

export interface LLMModelInfo {
  id: string;
  name: string;
  context_window: number | null;
  is_default: boolean;
}

export interface LLMSettings {
  llm_provider: string;
  anthropic_api_key: string;
  claude_model: string;
  openai_api_key: string;
  openai_model: string;
  google_api_key: string;
  gemini_model: string;
  ollama_base_url: string;
  ollama_model: string;
}

export interface JobProgress {
  total_files: number;
  processed_files: number;
  completed_files?: number;
  succeeded_files?: number;
  skipped_files: number;
  failed_files: number;
  total_chunks: number;
  errors: string[];
  current_file: string;
}

export interface SyncJob {
  id: string;
  project_id: string;
  status: "pending" | "running" | "completed" | "failed";
  total_files: number;
  processed_files: number;
  completed_files: number;
  succeeded_files: number;
  skipped_files: number;
  failed_files: number;
  total_chunks: number;
  current_file: string;
  errors: {
    id: string;
    filename: string;
    error_message: string;
    created_at: string;
  }[];
  created_at: string;
  completed_at: string | null;
  error: string | null;
}
