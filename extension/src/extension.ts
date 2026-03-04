import * as vscode from "vscode";
import { SidecarManager } from "./sidecar";
import { ChatViewProvider } from "./chatProvider";
import { StatusBar } from "./statusBar";
import { ingestFile, openSettings, openUI } from "./commands";

let sidecar: SidecarManager;
let statusBar: StatusBar;

/**
 * Called when the extension is activated (onStartupFinished).
 *
 * Sets up the sidecar manager, chat sidebar provider, status bar item,
 * and registers all commands.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = vscode.window.createOutputChannel("Momodoc");
    context.subscriptions.push(outputChannel);

    // Initialize sidecar manager
    sidecar = new SidecarManager(outputChannel);

    // Initialize chat sidebar webview provider
    const chatProvider = new ChatViewProvider(context.extensionUri, sidecar);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatViewProvider.viewType,
            chatProvider
        )
    );

    // Initialize status bar
    statusBar = new StatusBar(sidecar);
    context.subscriptions.push(statusBar);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand("momodoc.startServer", async () => {
            try {
                statusBar.setStarting();
                const started = await sidecar.start();
                if (started) {
                    statusBar.setRunning();
                    vscode.window.showInformationMessage("Momodoc server started.");
                    // Notify the chat provider to refresh projects
                    chatProvider.postMessage({ type: "serverStarted" });
                } else {
                    statusBar.setStopped();
                    vscode.window.showErrorMessage(
                        "Failed to start Momodoc server. Check the output channel for details."
                    );
                }
            } catch (err: unknown) {
                statusBar.setStopped();
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Error starting server: ${msg}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("momodoc.stopServer", async () => {
            try {
                await sidecar.stop();
                statusBar.setStopped();
                vscode.window.showInformationMessage("Momodoc server stopped.");
                chatProvider.postMessage({ type: "serverStopped" });
            } catch (err: unknown) {
                statusBar.setStopped();
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Error stopping server: ${msg}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("momodoc.openUI", () => openUI(sidecar))
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("momodoc.ingestFile", (uri?: vscode.Uri) =>
            ingestFile(uri, sidecar)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("momodoc.openSettings", () =>
            openSettings(sidecar)
        )
    );

    // Check if backend is already running on activation
    const running = await sidecar.isRunning();
    if (running) {
        statusBar.setRunning();
        outputChannel.appendLine("Detected running momodoc backend.");
    } else {
        outputChannel.appendLine(
            "Momodoc backend is not running. Use 'Momodoc: Start Server' to launch it."
        );
    }
}

/**
 * Called when the extension is deactivated.
 * Stops the sidecar if we started it.
 */
export async function deactivate(): Promise<void> {
    try {
        if (sidecar) {
            await sidecar.stop();
        }
    } catch (err) {
        // Silently log deactivation errors to avoid disrupting VS Code shutdown
        console.error("Error during extension deactivation:", err);
    }
}
