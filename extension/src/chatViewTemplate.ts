import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

type ReadFileSyncFn = (filePath: string, encoding: BufferEncoding) => string;
type RandomBytesFn = (size: number) => Buffer;

export interface ChatViewTemplateServiceDeps {
    readFileSync?: ReadFileSyncFn;
    randomBytes?: RandomBytesFn;
}

export interface ChatViewTemplateAssetUris {
    chatCssHref: string;
    chatJsSrc: string;
}

export const CHAT_VIEW_TEMPLATE_FALLBACK_HTML = `<!DOCTYPE html>
<html>
<body style="color: var(--vscode-editor-foreground); font-family: var(--vscode-font-family);">
    <p>Error: Could not load chat interface. Please reinstall the extension.</p>
</body>
</html>`;

export function renderChatViewHtmlTemplate(
    htmlTemplate: string,
    cspSource: string,
    nonce: string,
    assetUris: ChatViewTemplateAssetUris
): string {
    return htmlTemplate
        .replace(/{{nonce}}/g, nonce)
        .replace(/{{cspSource}}/g, cspSource)
        .replace(/{{chatCssHref}}/g, assetUris.chatCssHref)
        .replace(/{{chatJsSrc}}/g, assetUris.chatJsSrc);
}

export class ChatViewTemplateService {
    private cachedHtmlTemplate: string | null = null;
    private readonly readFileSync: ReadFileSyncFn;
    private readonly randomBytes: RandomBytesFn;

    constructor(
        private readonly extensionFsPath: string,
        deps: ChatViewTemplateServiceDeps = {}
    ) {
        this.readFileSync = deps.readFileSync ?? ((filePath, encoding) => fs.readFileSync(filePath, encoding));
        this.randomBytes = deps.randomBytes ?? ((size) => crypto.randomBytes(size));
    }

    render(cspSource: string, assetUris: ChatViewTemplateAssetUris): string {
        const htmlPath = path.join(this.extensionFsPath, "media", "chat.html");

        try {
            if (this.cachedHtmlTemplate === null) {
                this.cachedHtmlTemplate = this.readFileSync(htmlPath, "utf-8");
            }

            return renderChatViewHtmlTemplate(
                this.cachedHtmlTemplate,
                cspSource,
                this.getNonce(),
                assetUris
            );
        } catch {
            return CHAT_VIEW_TEMPLATE_FALLBACK_HTML;
        }
    }

    private getNonce(): string {
        return this.randomBytes(16).toString("hex");
    }
}
