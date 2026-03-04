import type {
  BrowseResponse,
  ChatMessage,
  ChatSession,
  CreateIssue,
  CreateNote,
  CreateProject,
  FileRecord,
  Issue,
  LLMModelInfo,
  LLMProviderInfo,
  LLMSettings,
  Note,
  Project,
  SearchResponse,
  SearchResult,
  SyncJob,
} from "./types";

export interface RendererApiBootstrap {
  getBaseUrl(): Promise<string>;
  getToken(): Promise<string>;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createRendererApiClient(bootstrap: RendererApiBootstrap) {
  async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const [baseUrl, token] = await Promise.all([
      bootstrap.getBaseUrl(),
      bootstrap.getToken(),
    ]);

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Momodoc-Token": token,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || "Request failed");
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  async function uploadFile(projectId: string, file: File): Promise<FileRecord> {
    const [baseUrl, token] = await Promise.all([
      bootstrap.getBaseUrl(),
      bootstrap.getToken(),
    ]);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${baseUrl}/api/v1/projects/${projectId}/files/upload`, {
      method: "POST",
      body: formData,
      headers: { "X-Momodoc-Token": token },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.detail || "Upload failed");
    }

    return response.json();
  }

  const api = {
    // Projects
    getProjects: (offset?: number, limit?: number) => {
      const params = new URLSearchParams();
      if (offset !== undefined) params.set("offset", String(offset));
      if (limit !== undefined) params.set("limit", String(limit));
      const qs = params.toString();
      return request<Project[]>(`/api/v1/projects${qs ? `?${qs}` : ""}`);
    },
    getProject: (id: string) => request<Project>(`/api/v1/projects/${id}`),
    createProject: (data: CreateProject) =>
      request<Project>("/api/v1/projects", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateProject: (id: string, data: Partial<CreateProject>) =>
      request<Project>(`/api/v1/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteProject: (id: string) =>
      request(`/api/v1/projects/${id}`, { method: "DELETE" }),

    // Files
    getFiles: (projectId: string) =>
      request<FileRecord[]>(`/api/v1/projects/${projectId}/files`),
    uploadFile,
    deleteFile: (projectId: string, fileId: string) =>
      request(`/api/v1/projects/${projectId}/files/${fileId}`, {
        method: "DELETE",
      }),

    // Notes
    getNotes: (projectId: string) =>
      request<Note[]>(`/api/v1/projects/${projectId}/notes`),
    createNote: (projectId: string, data: CreateNote) =>
      request<Note>(`/api/v1/projects/${projectId}/notes`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteNote: (projectId: string, noteId: string) =>
      request(`/api/v1/projects/${projectId}/notes/${noteId}`, {
        method: "DELETE",
      }),
    updateNote: (
      projectId: string,
      noteId: string,
      data: { content?: string; tags?: string }
    ) =>
      request<Note>(`/api/v1/projects/${projectId}/notes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    // Issues
    getIssues: (projectId: string, status?: string) => {
      const params = status ? `?status=${status}` : "";
      return request<Issue[]>(`/api/v1/projects/${projectId}/issues${params}`);
    },
    createIssue: (projectId: string, data: CreateIssue) =>
      request<Issue>(`/api/v1/projects/${projectId}/issues`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateIssue: (projectId: string, issueId: string, data: Partial<Issue>) =>
      request<Issue>(`/api/v1/projects/${projectId}/issues/${issueId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteIssue: (projectId: string, issueId: string) =>
      request(`/api/v1/projects/${projectId}/issues/${issueId}`, {
        method: "DELETE",
      }),

    // Chat
    createSession: (projectId: string) =>
      request<ChatSession>(`/api/v1/projects/${projectId}/chat/sessions`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    getSessions: (projectId: string) =>
      request<ChatSession[]>(`/api/v1/projects/${projectId}/chat/sessions`),
    getMessages: (projectId: string, sessionId: string) =>
      request<ChatMessage[]>(
        `/api/v1/projects/${projectId}/chat/sessions/${sessionId}/messages`
      ),
    deleteSession: (projectId: string, sessionId: string) =>
      request(`/api/v1/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: "DELETE",
      }),
    updateSession: (
      projectId: string,
      sessionId: string,
      data: { title: string }
    ) =>
      request<ChatSession>(
        `/api/v1/projects/${projectId}/chat/sessions/${sessionId}`,
        {
          method: "PATCH",
          body: JSON.stringify(data),
        }
      ),

    // Global Chat
    createGlobalSession: () =>
      request<ChatSession>("/api/v1/chat/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    getGlobalSessions: () => request<ChatSession[]>("/api/v1/chat/sessions"),
    getGlobalMessages: (sessionId: string) =>
      request<ChatMessage[]>(`/api/v1/chat/sessions/${sessionId}/messages`),
    deleteGlobalSession: (sessionId: string) =>
      request(`/api/v1/chat/sessions/${sessionId}`, { method: "DELETE" }),
    updateGlobalSession: (sessionId: string, data: { title: string }) =>
      request<ChatSession>(`/api/v1/chat/sessions/${sessionId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    // Search
    search: (query: string, projectId?: string) => {
      const path = projectId
        ? `/api/v1/projects/${projectId}/search`
        : "/api/v1/search";
      return request<SearchResponse>(path, {
        method: "POST",
        body: JSON.stringify({ query }),
      }).then((resp) => resp.results);
    },

    // LLM Providers and Settings
    getProviders: () => request<LLMProviderInfo[]>("/api/v1/llm/providers"),
    getProviderModels: (provider: string) =>
      request<LLMModelInfo[]>(`/api/v1/llm/providers/${provider}/models`),
    getSettings: () => request<LLMSettings>("/api/v1/settings"),
    updateSettings: (data: Partial<LLMSettings>) =>
      request<LLMSettings>("/api/v1/settings", {
        method: "PUT",
        body: JSON.stringify(data),
      }),

    // Sync
    startSync: (projectId: string, path?: string) =>
      request<SyncJob>(`/api/v1/projects/${projectId}/files/sync`, {
        method: "POST",
        body: JSON.stringify({ path: path || null }),
      }),
    getSyncStatus: (projectId: string) =>
      request<SyncJob | null>(`/api/v1/projects/${projectId}/files/sync/status`),
    getJob: (projectId: string, jobId: string) =>
      request<SyncJob>(`/api/v1/projects/${projectId}/files/jobs/${jobId}`),

    // Directories
    browseDirectories: (path?: string) => {
      const params = path ? `?path=${encodeURIComponent(path)}` : "";
      return request<BrowseResponse>(`/api/v1/directories/browse${params}`);
    },
  };

  return { api, request };
}

export type SharedRendererApi = ReturnType<typeof createRendererApiClient>["api"];
