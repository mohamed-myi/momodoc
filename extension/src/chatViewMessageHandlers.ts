import type {
    ChatMessage,
    ChatSession,
    ChatSource,
    LLMProviderInfo,
    Project,
    StreamCallbacks,
} from "./api/types";

export interface WebviewMessage {
    type: string;
    [key: string]: unknown;
}

export interface ChatViewApiClient {
    streamMessage(
        projectId: string,
        sessionId: string,
        query: string,
        callbacks: StreamCallbacks,
        topK?: number,
        llmMode?: string
    ): Promise<void>;
    getProviders(): Promise<LLMProviderInfo[]>;
    createSession(projectId: string, title?: string): Promise<ChatSession>;
    getProjects(offset?: number, limit?: number): Promise<Project[]>;
    getSessions(projectId: string, offset?: number, limit?: number): Promise<ChatSession[]>;
    getMessages(
        projectId: string,
        sessionId: string,
        offset?: number,
        limit?: number
    ): Promise<ChatMessage[]>;
}

export interface ChatViewMessageHandlerContext {
    ensureApi: () => ChatViewApiClient | null;
    postMessage: (message: Record<string, unknown>) => void;
    openFileAtLocation: (filePath: string, line: number) => Promise<void>;
    reportOpenFileError: (message: string) => void;
}

export type ChatViewMessageHandler = (message: WebviewMessage) => Promise<void>;
export type ChatViewMessageHandlerMap = Record<string, ChatViewMessageHandler>;

function toErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function getString(message: WebviewMessage, key: string): string {
    const value = message[key];
    return typeof value === "string" ? value : "";
}

function getOptionalString(message: WebviewMessage, key: string): string | undefined {
    const value = message[key];
    return typeof value === "string" ? value : undefined;
}

export async function handleSendMessage(
    context: ChatViewMessageHandlerContext,
    message: WebviewMessage
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({
            type: "error",
            message: "Momodoc server is not running. Start it first.",
        });
        return;
    }

    const projectId = getString(message, "projectId");
    const sessionId = getString(message, "sessionId");
    const content = getString(message, "content");
    const llmMode = getOptionalString(message, "llmMode");

    if (!projectId || !sessionId || !content) {
        context.postMessage({
            type: "error",
            message: "Missing project, session, or message content.",
        });
        return;
    }

    try {
        await api.streamMessage(
            projectId,
            sessionId,
            content,
            {
                onSources: (sources: ChatSource[]) => {
                    context.postMessage({ type: "sources", sources });
                },
                onToken: (token: string) => {
                    context.postMessage({ type: "token", token });
                },
                onDone: (messageId: string) => {
                    context.postMessage({ type: "done", messageId });
                },
                onError: (error: string) => {
                    context.postMessage({ type: "error", message: error });
                },
            },
            10,
            llmMode
        );
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
    }
}

export async function handleGetProviders(
    context: ChatViewMessageHandlerContext
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({ type: "providers", providers: [] });
        return;
    }

    try {
        const providers = await api.getProviders();
        context.postMessage({ type: "providers", providers });
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
        context.postMessage({ type: "providers", providers: [] });
    }
}

export async function handleOpenFile(
    context: ChatViewMessageHandlerContext,
    message: WebviewMessage
): Promise<void> {
    const filePath = getString(message, "path");
    const rawLine = Number(message.line);
    const line = Number.isFinite(rawLine) && rawLine >= 1 ? rawLine : 1;

    if (!filePath) {
        return;
    }

    try {
        await context.openFileAtLocation(filePath, line);
    } catch (err: unknown) {
        context.reportOpenFileError(`Could not open file: ${toErrorMessage(err)}`);
    }
}

export async function handleCreateSession(
    context: ChatViewMessageHandlerContext,
    message: WebviewMessage
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({
            type: "error",
            message: "Momodoc server is not running.",
        });
        return;
    }

    const projectId = getString(message, "projectId");
    if (!projectId) {
        context.postMessage({
            type: "error",
            message: "No project selected.",
        });
        return;
    }

    try {
        const session = await api.createSession(projectId);
        context.postMessage({ type: "sessionCreated", session });
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
    }
}

export async function handleGetProjects(
    context: ChatViewMessageHandlerContext
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({ type: "projects", projects: [] });
        return;
    }

    try {
        const projects = await api.getProjects();
        context.postMessage({ type: "projects", projects });
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
        context.postMessage({ type: "projects", projects: [] });
    }
}

export async function handleGetSessions(
    context: ChatViewMessageHandlerContext,
    message: WebviewMessage
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({ type: "sessions", sessions: [] });
        return;
    }

    const projectId = getString(message, "projectId");
    if (!projectId) {
        context.postMessage({ type: "sessions", sessions: [] });
        return;
    }

    try {
        const sessions = await api.getSessions(projectId);
        context.postMessage({ type: "sessions", sessions });
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
        context.postMessage({ type: "sessions", sessions: [] });
    }
}

export async function handleGetMessages(
    context: ChatViewMessageHandlerContext,
    message: WebviewMessage
): Promise<void> {
    const api = context.ensureApi();
    if (!api) {
        context.postMessage({ type: "messages", messages: [] });
        return;
    }

    const projectId = getString(message, "projectId");
    const sessionId = getString(message, "sessionId");

    if (!projectId || !sessionId) {
        context.postMessage({ type: "messages", messages: [] });
        return;
    }

    try {
        const messages = await api.getMessages(projectId, sessionId);
        context.postMessage({ type: "messages", messages });
    } catch (err: unknown) {
        context.postMessage({ type: "error", message: toErrorMessage(err) });
        context.postMessage({ type: "messages", messages: [] });
    }
}

export function createChatViewMessageHandlers(
    context: ChatViewMessageHandlerContext
): ChatViewMessageHandlerMap {
    const handlers: ChatViewMessageHandlerMap = {
        sendMessage: async (message) => handleSendMessage(context, message),
        openFile: async (message) => handleOpenFile(context, message),
        createSession: async (message) => handleCreateSession(context, message),
        getProjects: async () => handleGetProjects(context),
        getSessions: async (message) => handleGetSessions(context, message),
        getMessages: async (message) => handleGetMessages(context, message),
        getProviders: async () => handleGetProviders(context),
        ready: async () => {
            await handlers.getProjects({ type: "getProjects" });
            await handlers.getProviders({ type: "getProviders" });
        },
    };

    return handlers;
}

export function createChatViewMessageDispatcher(
    handlers: ChatViewMessageHandlerMap
): ChatViewMessageHandler {
    return async (message: WebviewMessage) => {
        const handler = handlers[message.type];
        if (!handler) {
            return;
        }

        await handler(message);
    };
}
