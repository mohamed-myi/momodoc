import test from "node:test";
import assert from "node:assert/strict";
import * as path from "path";

import {
    CHAT_VIEW_TEMPLATE_FALLBACK_HTML,
    ChatViewTemplateService,
} from "./chatViewTemplate";

test("ChatViewTemplateService replaces nonce/csp placeholders and caches template reads", () => {
    let reads = 0;
    const requestedPaths: string[] = [];
    const service = new ChatViewTemplateService("/tmp/ext", {
        readFileSync: (filePath, encoding) => {
            reads += 1;
            requestedPaths.push(filePath);
            assert.equal(encoding, "utf-8");
            return "<link href='{{chatCssHref}}'><script nonce='{{nonce}}' src='{{chatJsSrc}}'></script>{{cspSource}}";
        },
        randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    });

    const htmlA = service.render("vscode-webview://a", {
        chatCssHref: "vscode-webview://style-a",
        chatJsSrc: "vscode-webview://script-a",
    });
    const htmlB = service.render("vscode-webview://b", {
        chatCssHref: "vscode-webview://style-b",
        chatJsSrc: "vscode-webview://script-b",
    });

    assert.equal(reads, 1);
    assert.deepEqual(requestedPaths, [path.join("/tmp/ext", "media", "chat.html")]);
    assert.equal(
        htmlA,
        "<link href='vscode-webview://style-a'><script nonce='00112233445566778899aabbccddeeff' src='vscode-webview://script-a'></script>vscode-webview://a"
    );
    assert.equal(
        htmlB,
        "<link href='vscode-webview://style-b'><script nonce='00112233445566778899aabbccddeeff' src='vscode-webview://script-b'></script>vscode-webview://b"
    );
});

test("ChatViewTemplateService returns fallback HTML when template file cannot be loaded", () => {
    const service = new ChatViewTemplateService("/tmp/ext", {
        readFileSync: () => {
            throw new Error("missing");
        },
    });

    const html = service.render("vscode-webview://csp", {
        chatCssHref: "vscode-webview://style",
        chatJsSrc: "vscode-webview://script",
    });

    assert.equal(html, CHAT_VIEW_TEMPLATE_FALLBACK_HTML);
    assert.match(html, /Could not load chat interface/);
});
