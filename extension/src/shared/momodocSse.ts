export interface SSEEvent {
    event: string;
    data: string;
}

export interface ParsedSSEEvents {
    events: SSEEvent[];
    remainder: string;
}

export interface MomodocSSEEventHandlers {
    onSources?: (sources: unknown[]) => void;
    onToken?: (token: string) => void;
    onDone?: (messageId: string) => void;
    onError?: (error: string) => void;
    onRetrievalMetadata?: (metadata: Record<string, unknown>) => void;
    onMalformedJson?: (rawData: string) => void;
    onInvalidSources?: (value: unknown) => void;
}

export interface MomodocSSEDispatchOptions {
    errorFallbackMessage?: string | null;
}

export function parseSSEEvents(chunk: string): ParsedSSEEvents {
    // Normalize CRLF framing so both \n\n and \r\n\r\n delimiters parse consistently.
    const rawEvents = chunk.replace(/\r\n/g, "\n").split("\n\n");
    const remainder = rawEvents.pop() ?? "";
    const events: SSEEvent[] = [];

    for (const rawEvent of rawEvents) {
        if (!rawEvent.trim()) {
            continue;
        }

        let event = "message";
        const dataLines: string[] = [];

        for (const rawLine of rawEvent.split("\n")) {
            const line = rawLine.replace(/\r$/, "");
            if (line.startsWith("event:")) {
                event = line.slice(6).trim() || "message";
            } else if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trimStart());
            }
        }

        if (dataLines.length > 0) {
            events.push({ event, data: dataLines.join("\n") });
        }
    }

    return { events, remainder };
}

export function dispatchMomodocSSEEvent(
    evt: SSEEvent,
    handlers: MomodocSSEEventHandlers,
    options?: MomodocSSEDispatchOptions
): void {
    if (!evt.data.trim()) {
        return;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(evt.data);
    } catch {
        handlers.onMalformedJson?.(evt.data);
        return;
    }

    const asObject = typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;

    switch (evt.event) {
        case "sources":
            if (Array.isArray(parsed)) {
                handlers.onSources?.(parsed);
            } else {
                handlers.onInvalidSources?.(parsed);
            }
            return;
        case "retrieval_metadata":
            if (asObject) {
                handlers.onRetrievalMetadata?.(asObject);
            }
            return;
        case "done":
            if (asObject && typeof asObject.message_id === "string") {
                handlers.onDone?.(asObject.message_id);
            }
            return;
        case "error":
            if (asObject && typeof asObject.error === "string") {
                handlers.onError?.(asObject.error);
                return;
            }
            if (options?.errorFallbackMessage) {
                handlers.onError?.(options.errorFallbackMessage);
            }
            return;
        default:
            if (asObject && typeof asObject.token === "string") {
                handlers.onToken?.(asObject.token);
            }
    }
}
