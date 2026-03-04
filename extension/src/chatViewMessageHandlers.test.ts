import test from "node:test";
import assert from "node:assert/strict";

import {
    createChatViewMessageDispatcher,
    createChatViewMessageHandlers,
    type ChatViewApiClient,
} from "./chatViewMessageHandlers";

function createFakeApi(overrides: Partial<ChatViewApiClient> = {}): ChatViewApiClient {
    return {
        streamMessage: async () => undefined,
        getProviders: async () => [],
        createSession: async () => ({
            id: "s1",
            project_id: "p1",
            title: null,
            created_at: "2026-02-24T00:00:00Z",
            updated_at: "2026-02-24T00:00:00Z",
        }),
        getProjects: async () => [],
        getSessions: async () => [],
        getMessages: async () => [],
        ...overrides,
    };
}

test("message dispatcher routes ready messages through extracted handlers", async () => {
    const posted: Array<Record<string, unknown>> = [];
    const api = createFakeApi({
        getProjects: async () => [
            {
                id: "p1",
                name: "Project",
                description: null,
                created_at: "2026-02-24T00:00:00Z",
                updated_at: "2026-02-24T00:00:00Z",
                file_count: 0,
                note_count: 0,
                issue_count: 0,
            },
        ],
        getProviders: async () => [
            { name: "openai", available: true, model: "gpt" },
        ],
    });
    const handlers = createChatViewMessageHandlers({
        ensureApi: () => api,
        postMessage: (message) => {
            posted.push(message);
        },
        openFileAtLocation: async () => undefined,
        reportOpenFileError: () => undefined,
    });
    const dispatch = createChatViewMessageDispatcher(handlers);

    await dispatch({ type: "ready" });

    assert.deepEqual(
        posted.map((message) => message.type),
        ["projects", "providers"]
    );
    assert.deepEqual(posted[0].projects, [
        {
            id: "p1",
            name: "Project",
            description: null,
            created_at: "2026-02-24T00:00:00Z",
            updated_at: "2026-02-24T00:00:00Z",
            file_count: 0,
            note_count: 0,
            issue_count: 0,
        },
    ]);
});

test("sendMessage handler is directly testable and validates required fields", async () => {
    const posted: Array<Record<string, unknown>> = [];
    let streamCalls = 0;
    const api = createFakeApi({
        streamMessage: async () => {
            streamCalls += 1;
        },
    });
    const handlers = createChatViewMessageHandlers({
        ensureApi: () => api,
        postMessage: (message) => {
            posted.push(message);
        },
        openFileAtLocation: async () => undefined,
        reportOpenFileError: () => undefined,
    });

    await handlers.sendMessage({
        type: "sendMessage",
        projectId: "p1",
        sessionId: "",
        content: "hello",
    });

    assert.equal(streamCalls, 0);
    assert.deepEqual(posted, [
        {
            type: "error",
            message: "Missing project, session, or message content.",
        },
    ]);
});
