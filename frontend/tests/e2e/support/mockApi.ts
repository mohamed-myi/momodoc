import type { Page, Route } from "@playwright/test";
import type {
  ChatMessage,
  ChatSession,
  ChatSource,
  FileRecord,
  Issue,
  LLMProviderInfo,
  Note,
  Project,
  SearchResult,
} from "../../../src/shared/renderer/lib/types";

interface MockApiError {
  detail: string;
  status?: number;
}

interface MockStreamResponse {
  body?: string;
  detail?: string;
  status?: number;
}

export interface MockApiState {
  filesByProject: Record<string, FileRecord[]>;
  globalMessages: Record<string, ChatMessage[]>;
  globalSessions: ChatSession[];
  issuesByProject: Record<string, Issue[]>;
  notesByProject: Record<string, Note[]>;
  projectMessages: Record<string, Record<string, ChatMessage[]>>;
  projectSessions: Record<string, ChatSession[]>;
  projects: Project[];
  projectsError: MockApiError | null;
  providers: LLMProviderInfo[];
  searchResults: SearchResult[];
  streamResponse: MockStreamResponse | null;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultProjects(): Project[] {
  return [
    {
      id: "proj-1",
      name: "Test Project 1",
      description: "A test project for browser flows",
      source_directory: "/workspace/test-project-1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
      file_count: 5,
      note_count: 3,
      issue_count: 2,
      last_sync_at: "2024-01-01T00:00:00Z",
      last_sync_status: "completed",
      sync_job_id: null,
    },
    {
      id: "proj-2",
      name: "Test Project 2",
      description: "Second project for sorting and search badges",
      source_directory: "/workspace/test-project-2",
      created_at: "2024-01-02T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
      file_count: 2,
      note_count: 1,
      issue_count: 0,
      last_sync_at: null,
      last_sync_status: null,
      sync_job_id: null,
    },
  ];
}

function defaultProviders(): LLMProviderInfo[] {
  return [{ name: "gemini", available: true, model: "gemini-2.5-flash" }];
}

function defaultStreamResponse(): MockStreamResponse {
  return { body: buildTokenStream(["Mocked assistant response."]) };
}

export function buildTokenStream(
  chunks: string[],
  options: { messageId?: string; sources?: ChatSource[] } = {}
): string {
  const messageId = options.messageId || "msg-stream";
  let body = chunks
    .map((chunk) => `data: ${JSON.stringify({ token: chunk })}\n\n`)
    .join("");

  if (options.sources && options.sources.length > 0) {
    body += `event: sources\ndata: ${JSON.stringify(options.sources)}\n\n`;
  }

  body += `event: done\ndata: ${JSON.stringify({ message_id: messageId })}\n\n`;
  return body;
}

export function createMockApiState(
  overrides: Partial<MockApiState> = {}
): MockApiState {
  return {
    filesByProject: {},
    globalMessages: {},
    globalSessions: [],
    issuesByProject: {},
    notesByProject: {},
    projectMessages: {},
    projectSessions: {},
    projects: clone(defaultProjects()),
    projectsError: null,
    providers: clone(defaultProviders()),
    searchResults: [],
    streamResponse: defaultStreamResponse(),
    ...overrides,
  };
}

export async function installMockApi(page: Page, state: MockApiState): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: corsHeaders(route),
      });
      return;
    }

    if (method === "GET" && path === "/api/v1/token") {
      await fulfillJson(route, { token: "mock-session-token" });
      return;
    }

    if (method === "GET" && path === "/api/v1/llm/providers") {
      await fulfillJson(route, state.providers);
      return;
    }

    if (method === "GET" && path === "/api/v1/projects") {
      if (state.projectsError) {
        await fulfillJson(
          route,
          { detail: state.projectsError.detail },
          state.projectsError.status || 500
        );
        return;
      }

      const offset = Number(url.searchParams.get("offset") || "0");
      const limit = Number(url.searchParams.get("limit") || String(state.projects.length || 100));
      await fulfillJson(route, state.projects.slice(offset, offset + limit));
      return;
    }

    if (method === "POST" && path === "/api/v1/projects") {
      const body = readJsonBody(request.postData());
      const project: Project = {
        id: `proj-${Date.now()}`,
        name: String(body.name || "Untitled project"),
        description: asNullableString(body.description),
        source_directory: asNullableString(body.source_directory),
        created_at: nowIso(),
        updated_at: nowIso(),
        file_count: 0,
        note_count: 0,
        issue_count: 0,
        last_sync_at: null,
        last_sync_status: null,
        sync_job_id: null,
      };
      state.projects = [project, ...state.projects];
      await fulfillJson(route, project, 201);
      return;
    }

    const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1] || "");
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) {
        await fulfillJson(route, { detail: "Project not found" }, 404);
        return;
      }

      if (method === "GET") {
        await fulfillJson(route, project);
        return;
      }

      if (method === "PATCH") {
        const body = readJsonBody(request.postData());
        const updatedProject: Project = {
          ...project,
          name: String(body.name || project.name),
          description:
            body.description === undefined
              ? project.description
              : asNullableString(body.description),
          source_directory:
            body.source_directory === undefined
              ? project.source_directory
              : asNullableString(body.source_directory),
          updated_at: nowIso(),
        };
        state.projects = state.projects.map((item) =>
          item.id === projectId ? updatedProject : item
        );
        await fulfillJson(route, updatedProject);
        return;
      }

      if (method === "DELETE") {
        state.projects = state.projects.filter((item) => item.id !== projectId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const filesMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/files$/);
    if (filesMatch && method === "GET") {
      const projectId = decodeURIComponent(filesMatch[1] || "");
      await fulfillJson(route, state.filesByProject[projectId] || []);
      return;
    }

    const notesMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/notes$/);
    if (notesMatch && method === "GET") {
      const projectId = decodeURIComponent(notesMatch[1] || "");
      await fulfillJson(route, state.notesByProject[projectId] || []);
      return;
    }

    const issuesMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/issues$/);
    if (issuesMatch && method === "GET") {
      const projectId = decodeURIComponent(issuesMatch[1] || "");
      await fulfillJson(route, state.issuesByProject[projectId] || []);
      return;
    }

    const projectSessionsMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/chat\/sessions$/);
    if (projectSessionsMatch) {
      const projectId = decodeURIComponent(projectSessionsMatch[1] || "");

      if (method === "GET") {
        await fulfillJson(route, state.projectSessions[projectId] || []);
        return;
      }

      if (method === "POST") {
        const session: ChatSession = {
          id: `project-session-${Date.now()}`,
          project_id: projectId,
          title: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        state.projectSessions[projectId] = [session, ...(state.projectSessions[projectId] || [])];
        await fulfillJson(route, session, 201);
        return;
      }
    }

    const projectMessagesMatch = path.match(
      /^\/api\/v1\/projects\/([^/]+)\/chat\/sessions\/([^/]+)\/messages$/
    );
    if (projectMessagesMatch && method === "GET") {
      const projectId = decodeURIComponent(projectMessagesMatch[1] || "");
      const sessionId = decodeURIComponent(projectMessagesMatch[2] || "");
      await fulfillJson(route, state.projectMessages[projectId]?.[sessionId] || []);
      return;
    }

    const projectSessionActionMatch = path.match(
      /^\/api\/v1\/projects\/([^/]+)\/chat\/sessions\/([^/]+)$/
    );
    if (projectSessionActionMatch) {
      const projectId = decodeURIComponent(projectSessionActionMatch[1] || "");
      const sessionId = decodeURIComponent(projectSessionActionMatch[2] || "");
      const sessions = state.projectSessions[projectId] || [];

      if (method === "PATCH") {
        const body = readJsonBody(request.postData());
        const updatedSession = updateSessionTitle(sessions, sessionId, String(body.title || ""));
        if (!updatedSession) {
          await fulfillJson(route, { detail: "Session not found" }, 404);
          return;
        }
        await fulfillJson(route, updatedSession);
        return;
      }

      if (method === "DELETE") {
        state.projectSessions[projectId] = sessions.filter((session) => session.id !== sessionId);
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const globalSessionsPath = "/api/v1/chat/sessions";
    if (path === globalSessionsPath) {
      if (method === "GET") {
        await fulfillJson(route, state.globalSessions);
        return;
      }

      if (method === "POST") {
        const session: ChatSession = {
          id: `global-session-${Date.now()}`,
          project_id: null,
          title: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        state.globalSessions = [session, ...state.globalSessions];
        await fulfillJson(route, session, 201);
        return;
      }
    }

    const globalMessagesMatch = path.match(/^\/api\/v1\/chat\/sessions\/([^/]+)\/messages$/);
    if (globalMessagesMatch && method === "GET") {
      const sessionId = decodeURIComponent(globalMessagesMatch[1] || "");
      await fulfillJson(route, state.globalMessages[sessionId] || []);
      return;
    }

    const globalSessionActionMatch = path.match(/^\/api\/v1\/chat\/sessions\/([^/]+)$/);
    if (globalSessionActionMatch) {
      const sessionId = decodeURIComponent(globalSessionActionMatch[1] || "");

      if (method === "PATCH") {
        const body = readJsonBody(request.postData());
        const updatedSession = updateSessionTitle(
          state.globalSessions,
          sessionId,
          String(body.title || "")
        );
        if (!updatedSession) {
          await fulfillJson(route, { detail: "Session not found" }, 404);
          return;
        }
        await fulfillJson(route, updatedSession);
        return;
      }

      if (method === "DELETE") {
        state.globalSessions = state.globalSessions.filter((session) => session.id !== sessionId);
        delete state.globalMessages[sessionId];
        await fulfillEmpty(route, 204);
        return;
      }
    }

    const streamPathMatch = path.match(
      /^\/api\/v1\/(?:projects\/([^/]+)\/)?chat\/sessions\/([^/]+)\/messages\/stream$/
    );
    if (streamPathMatch && method === "POST") {
      if (state.streamResponse?.status && state.streamResponse.status >= 400) {
        await fulfillJson(
          route,
          { detail: state.streamResponse.detail || "Stream failed" },
          state.streamResponse.status
        );
        return;
      }

      await route.fulfill({
        status: 200,
        body: state.streamResponse?.body || buildTokenStream(["Mocked assistant response."]),
        headers: {
          ...corsHeaders(route),
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      });
      return;
    }

    if (
      method === "POST" &&
      (path === "/api/v1/search" ||
        /^\/api\/v1\/projects\/[^/]+\/search$/.test(path))
    ) {
      await fulfillJson(route, { results: state.searchResults, query_plan: null });
      return;
    }

    await route.continue();
  });
}

function readJsonBody(rawBody: string | null): Record<string, unknown> {
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function updateSessionTitle(
  sessions: ChatSession[],
  sessionId: string,
  title: string
): ChatSession | null {
  let updatedSession: ChatSession | null = null;
  for (const session of sessions) {
    if (session.id === sessionId) {
      session.title = title;
      session.updated_at = nowIso();
      updatedSession = session;
    }
  }
  return updatedSession;
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({
    status,
    body: JSON.stringify(body),
    headers: {
      ...corsHeaders(route),
      "content-type": "application/json",
    },
  });
}

async function fulfillEmpty(route: Route, status: number): Promise<void> {
  await route.fulfill({
    status,
    headers: corsHeaders(route),
  });
}

function corsHeaders(route: Route): Record<string, string> {
  const request = route.request();
  const origin = request.headers().origin || "http://localhost:3000";
  const requestedHeaders =
    request.headers()["access-control-request-headers"] || "content-type,x-momodoc-token";

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": requestedHeaders,
    vary: "Origin",
  };
}
