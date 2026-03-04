import * as http from "http";

import { dispatchMomodocSSEEvent, parseSSEEvents, type SSEEvent } from "../shared/momodocSse";

import type { ApiCredentialsProvider } from "./transport";
import type { ChatSource, StreamCallbacks } from "./types";

export interface StreamMessageParams {
    projectId: string;
    sessionId: string;
    query: string;
    callbacks: StreamCallbacks;
    topK?: number;
    llmMode?: string;
}

/**
 * Stream a chat message response using SSE.
 *
 * The backend sends:
 *   event: sources  -> data: ChatSource[]
 *   data: { token }  -> streaming token (no event type)
 *   event: done     -> data: { message_id }
 *   event: error    -> data: { error, type }
 */
export function streamChatMessage(
    getCredentials: ApiCredentialsProvider,
    { projectId, sessionId, query, callbacks, topK = 10, llmMode }: StreamMessageParams
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const payload: Record<string, unknown> = { query, top_k: topK };
        if (llmMode) {
            payload.llm_mode = llmMode;
        }
        const body = JSON.stringify(payload);
        const { port, token } = getCredentials();

        const req = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path: `/api/v1/projects/${projectId}/chat/sessions/${sessionId}/messages/stream`,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Momodoc-Token": token,
                    Accept: "text/event-stream",
                },
            },
            (res) => {
                if (res.statusCode !== 200) {
                    let errorBody = "";
                    res.on("data", (chunk: Buffer) => {
                        errorBody += chunk.toString();
                    });
                    res.on("end", () => {
                        const msg = `HTTP ${res.statusCode}: ${errorBody}`;
                        callbacks.onError?.(msg);
                        reject(new Error(msg));
                    });
                    return;
                }

                let buffer = "";
                const handleParsedEvent = (evt: SSEEvent): void => {
                    dispatchMomodocSSEEvent(evt, {
                        onSources: (sources) => {
                            callbacks.onSources?.(sources as ChatSource[]);
                        },
                        onToken: (nextToken) => {
                            callbacks.onToken?.(nextToken);
                        },
                        onDone: (messageId) => {
                            callbacks.onDone?.(messageId);
                        },
                        onError: (error) => {
                            callbacks.onError?.(error);
                        },
                        onMalformedJson: (rawData) => {
                            console.warn(`Malformed SSE JSON: ${rawData.slice(0, 100)}`);
                        },
                        onInvalidSources: (value) => {
                            console.warn(`Expected sources to be an array, got: ${typeof value}`);
                        },
                    });
                };

                res.on("data", (chunk: Buffer) => {
                    buffer += chunk.toString();
                    const parsed = parseSSEEvents(buffer);
                    buffer = parsed.remainder;

                    for (const evt of parsed.events) {
                        handleParsedEvent(evt);
                    }
                });

                res.on("end", () => {
                    if (buffer.trim()) {
                        const finalParsed = parseSSEEvents(`${buffer}\n\n`);
                        for (const evt of finalParsed.events) {
                            handleParsedEvent(evt);
                        }
                    }
                    resolve();
                });

                res.on("error", (err) => {
                    callbacks.onError?.(err.message);
                    reject(err);
                });
            }
        );

        req.on("error", (err) => {
            callbacks.onError?.(err.message);
            reject(err);
        });

        req.write(body);
        req.end();
    });
}
