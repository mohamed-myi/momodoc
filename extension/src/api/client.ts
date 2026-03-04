import { streamChatMessage } from "./streaming";
import { createApiTransport, type ApiCredentials, type ApiTransport } from "./transport";
import type {
    ChatMessage,
    ChatResponse,
    ChatSession,
    FileRecord,
    LLMProviderInfo,
    Project,
    StreamCallbacks,
} from "./types";

/**
 * HTTP client for the momodoc backend API.
 *
 * All requests include the session token in the X-Momodoc-Token header.
 * Communicates with the backend over localhost.
 */
export class MomodocApi {
    private port: number;
    private token: string;
    private readonly transport: ApiTransport;

    constructor(port: number, token: string) {
        this.port = port;
        this.token = token;
        this.transport = createApiTransport(() => this.getCredentials());
    }

    /** Update the port and token (e.g., after server restart). */
    updateCredentials(port: number, token: string): void {
        this.port = port;
        this.token = token;
    }

    // ── Projects ──────────────────────────────────────────────────────

    async getProjects(offset = 0, limit = 100): Promise<Project[]> {
        return this.transport.get<Project[]>(`/api/v1/projects?offset=${offset}&limit=${limit}`);
    }

    async createProject(name: string, description?: string): Promise<Project> {
        return this.transport.post<Project>("/api/v1/projects", { name, description });
    }

    // ── Files ─────────────────────────────────────────────────────────

    async uploadFile(projectId: string, filePath: string): Promise<FileRecord> {
        return this.transport.uploadMultipart<FileRecord>(
            `/api/v1/projects/${projectId}/files/upload`,
            filePath
        );
    }

    // ── Chat ──────────────────────────────────────────────────────────

    async createSession(projectId: string, title?: string): Promise<ChatSession> {
        const body: Record<string, unknown> = {};
        if (title) {
            body.title = title;
        }
        return this.transport.post<ChatSession>(
            `/api/v1/projects/${projectId}/chat/sessions`,
            body
        );
    }

    async getSessions(projectId: string, offset = 0, limit = 20): Promise<ChatSession[]> {
        return this.transport.get<ChatSession[]>(
            `/api/v1/projects/${projectId}/chat/sessions?offset=${offset}&limit=${limit}`
        );
    }

    async getMessages(
        projectId: string,
        sessionId: string,
        offset = 0,
        limit = 50
    ): Promise<ChatMessage[]> {
        return this.transport.get<ChatMessage[]>(
            `/api/v1/projects/${projectId}/chat/sessions/${sessionId}/messages?offset=${offset}&limit=${limit}`
        );
    }

    async sendMessage(
        projectId: string,
        sessionId: string,
        query: string,
        topK = 10,
        llmMode?: string
    ): Promise<ChatResponse> {
        const body: Record<string, unknown> = { query, top_k: topK };
        if (llmMode) {
            body.llm_mode = llmMode;
        }
        return this.transport.post<ChatResponse>(
            `/api/v1/projects/${projectId}/chat/sessions/${sessionId}/messages`,
            body
        );
    }

    streamMessage(
        projectId: string,
        sessionId: string,
        query: string,
        callbacks: StreamCallbacks,
        topK = 10,
        llmMode?: string
    ): Promise<void> {
        return streamChatMessage(
            () => this.getCredentials(),
            { projectId, sessionId, query, callbacks, topK, llmMode }
        );
    }

    // ── LLM Providers ──────────────────────────────────────────────────

    async getProviders(): Promise<LLMProviderInfo[]> {
        return this.transport.get<LLMProviderInfo[]>("/api/v1/llm/providers");
    }

    // ── Search ────────────────────────────────────────────────────────

    async search(query: string, topK = 10, projectId?: string): Promise<unknown[]> {
        const endpoint = projectId
            ? `/api/v1/projects/${projectId}/search`
            : "/api/v1/search";
        const resp = await this.transport.post<{ results: unknown[]; query_plan: unknown }>(
            endpoint,
            { query, top_k: topK },
        );
        return resp.results;
    }

    private getCredentials(): ApiCredentials {
        return { port: this.port, token: this.token };
    }
}
