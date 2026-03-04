import * as vscode from "vscode";
import { MomodocApi } from "./api";
import {
    createChatViewMessageDispatcher,
    createChatViewMessageHandlers,
    type WebviewMessage,
} from "./chatViewMessageHandlers";
import { ChatViewTemplateService } from "./chatViewTemplate";
import { SidecarManager } from "./sidecar";

/**
 * Provides the chat sidebar webview for the Momodoc activity bar panel.
 *
 * Handles communication between the webview (HTML/JS) and the extension host,
 * proxying chat requests to the momodoc backend API and relaying streaming
 * responses back to the webview.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = "momodoc.chatView";

    private view?: vscode.WebviewView;
    private api: MomodocApi | null = null;
    private sidecar: SidecarManager;
    private extensionUri: vscode.Uri;
    private readonly templateService: ChatViewTemplateService;
    private readonly handleWebviewMessage: (message: WebviewMessage) => Promise<void>;

    constructor(extensionUri: vscode.Uri, sidecar: SidecarManager) {
        this.extensionUri = extensionUri;
        this.sidecar = sidecar;
        this.templateService = new ChatViewTemplateService(extensionUri.fsPath);
        const handlers = createChatViewMessageHandlers({
            ensureApi: () => this.ensureApi(),
            postMessage: (message) => this.postMessage(message),
            openFileAtLocation: (filePath, line) => this.openFileAtLocation(filePath, line),
            reportOpenFileError: (message) => {
                void vscode.window.showErrorMessage(message);
            },
        });
        this.handleWebviewMessage = createChatViewMessageDispatcher(handlers);
    }

    /**
     * Ensure we have a valid API client. Reads fresh port/token from disk
     * and creates or updates the client.
     */
    private ensureApi(): MomodocApi | null {
        const port = this.sidecar.getPort();
        const token = this.sidecar.getToken();

        if (port === null || token === null) {
            return null;
        }

        if (this.api) {
            this.api.updateCredentials(port, token);
        } else {
            this.api = new MomodocApi(port, token);
        }

        return this.api;
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, "media"),
            ],
        };

        const chatCssUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "chat.css")
        );
        const chatJsUri = webviewView.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, "media", "chat.js")
        );

        webviewView.webview.html = this.templateService.render(webviewView.webview.cspSource, {
            chatCssHref: chatCssUri.toString(),
            chatJsSrc: chatJsUri.toString(),
        });

        webviewView.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this.handleWebviewMessage(message),
            undefined
        );
    }

    /**
     * Post a message to the webview, if it exists.
     */
    postMessage(message: Record<string, unknown>): void {
        this.view?.webview.postMessage(message);
    }

    private async openFileAtLocation(filePath: string, line: number): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lineNumber = Math.max(0, line - 1);
        const range = new vscode.Range(lineNumber, 0, lineNumber, 0);
        await vscode.window.showTextDocument(doc, {
            selection: range,
            preview: true,
        });
    }
}
