import test from "node:test";
import assert from "node:assert/strict";

import {
    dispatchMomodocSSEEvent,
    parseSSEEvents,
    type SSEEvent,
} from "./momodocSse";

test("parseSSEEvents parses multiple events and preserves trailing remainder", () => {
    const parsed = parseSSEEvents(
        "event: sources\ndata: []\n\n" +
        "data: {\"token\":\"hi\"}\n\n" +
        "partial"
    );

    assert.deepEqual(parsed.events, [
        { event: "sources", data: "[]" },
        { event: "message", data: "{\"token\":\"hi\"}" },
    ]);
    assert.equal(parsed.remainder, "partial");
});

test("parseSSEEvents handles CRLF and joins multiple data lines", () => {
    const parsed = parseSSEEvents(
        "event: message\r\n" +
        "data: first line\r\n" +
        "data: second line\r\n" +
        "\r\n"
    );

    assert.deepEqual(parsed.events, [
        { event: "message", data: "first line\nsecond line" },
    ]);
    assert.equal(parsed.remainder, "");
});

test("parseSSEEvents keeps incomplete frame data in remainder", () => {
    const parsed = parseSSEEvents("event: error\ndata: {\"error\":\"boom\"}");

    assert.deepEqual(parsed.events, []);
    assert.equal(parsed.remainder, "event: error\ndata: {\"error\":\"boom\"}");
});

test("dispatchMomodocSSEEvent routes standard momodoc event types", () => {
    const seen = {
        sources: [] as unknown[],
        tokens: [] as string[],
        done: [] as string[],
        errors: [] as string[],
    };

    const events: SSEEvent[] = [
        { event: "sources", data: "[{\"id\":\"s1\"}]" },
        { event: "message", data: "{\"token\":\"hel\"}" },
        { event: "done", data: "{\"message_id\":\"m1\"}" },
        { event: "error", data: "{\"error\":\"broken\"}" },
    ];

    for (const evt of events) {
        dispatchMomodocSSEEvent(evt, {
            onSources: (sources) => {
                seen.sources = sources;
            },
            onToken: (token) => {
                seen.tokens.push(token);
            },
            onDone: (messageId) => {
                seen.done.push(messageId);
            },
            onError: (error) => {
                seen.errors.push(error);
            },
        });
    }

    assert.deepEqual(seen.sources, [{ id: "s1" }]);
    assert.deepEqual(seen.tokens, ["hel"]);
    assert.deepEqual(seen.done, ["m1"]);
    assert.deepEqual(seen.errors, ["broken"]);
});

test("dispatchMomodocSSEEvent reports malformed JSON, invalid sources, and error fallback", () => {
    const malformed: string[] = [];
    const invalidSources: unknown[] = [];
    const errors: string[] = [];

    dispatchMomodocSSEEvent(
        { event: "message", data: "{not-json" },
        {
            onMalformedJson: (rawData) => {
                malformed.push(rawData);
            },
        }
    );
    dispatchMomodocSSEEvent(
        { event: "sources", data: "{\"id\":\"not-array\"}" },
        {
            onInvalidSources: (value) => {
                invalidSources.push(value);
            },
        }
    );
    dispatchMomodocSSEEvent(
        { event: "error", data: "{\"type\":\"backend\"}" },
        {
            onError: (error) => {
                errors.push(error);
            },
        },
        { errorFallbackMessage: "stream error" }
    );

    assert.deepEqual(malformed, ["{not-json"]);
    assert.deepEqual(invalidSources, [{ id: "not-array" }]);
    assert.deepEqual(errors, ["stream error"]);
});
