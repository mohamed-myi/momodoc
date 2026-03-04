import * as vscode from "vscode";
import * as path from "path";
import { MomodocApi, Project } from "./api";
import { SidecarManager } from "./sidecar";

/**
 * Handle the "Momodoc: Ingest File" command.
 *
 * Prompts the user to select a project, then uploads the selected file
 * to that project for indexing.
 */
export async function ingestFile(
    uri: vscode.Uri | undefined,
    sidecar: SidecarManager
): Promise<void> {
    // If not invoked from context menu, prompt for file
    if (!uri) {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            openLabel: "Ingest",
        });
        if (!files || files.length === 0) {
            return;
        }
        uri = files[0];
    }

    const filePath = uri.fsPath;

    // Ensure server is running
    let port = sidecar.getPort();
    let token = sidecar.getToken();

    if (port === null || token === null) {
        const start = await vscode.window.showWarningMessage(
            "Momodoc server is not running. Start it first?",
            "Start Server",
            "Cancel"
        );
        if (start === "Start Server") {
            await vscode.commands.executeCommand("momodoc.startServer");
            // Re-check after starting
            port = sidecar.getPort();
            token = sidecar.getToken();
            if (port === null || token === null) {
                vscode.window.showErrorMessage("Failed to start Momodoc server.");
                return;
            }
        } else {
            return;
        }
    }

    const api = new MomodocApi(port, token);

    // Fetch projects and let user select one
    let projects: Project[];
    try {
        projects = await api.getProjects();
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to fetch projects: ${msg}`);
        return;
    }

    if (projects.length === 0) {
        const name = await vscode.window.showInputBox({
            prompt: "No projects found. Enter a name to create one:",
            placeHolder: "My Project",
        });
        if (!name) {
            return;
        }

        try {
            const newProject = await api.createProject(name);
            projects = [newProject];
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to create project: ${msg}`);
            return;
        }
    }

    // Show quick pick if multiple projects
    let selectedProject: Project;
    if (projects.length === 1) {
        selectedProject = projects[0];
    } else {
        const items = projects.map((p) => ({
            label: p.name,
            description: p.description || "",
            detail: `${p.file_count} files`,
            project: p,
        }));

        const picked = await vscode.window.showQuickPick(items, {
            placeHolder: "Select a project to ingest the file into",
        });
        if (!picked) {
            return;
        }
        selectedProject = picked.project;
    }

    // Upload the file
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `Ingesting ${path.basename(filePath)}...`,
            cancellable: false,
        },
        async () => {
            try {
                const result = await api.uploadFile(selectedProject.id, filePath);
                vscode.window.showInformationMessage(
                    `Ingested ${result.filename} (${result.chunk_count} chunks)`
                );
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Ingestion failed: ${msg}`);
            }
        }
    );
}

/**
 * Handle the "Momodoc: Open LLM Settings" command.
 *
 * Opens the momodoc web UI settings page in the user's default browser.
 * Settings are managed via the backend settings API and take effect
 * immediately via hot-reload.
 */
export async function openSettings(sidecar: SidecarManager): Promise<void> {
    const port = sidecar.getPort();

    if (port === null) {
        const start = await vscode.window.showWarningMessage(
            "Momodoc server is not running. Start it first?",
            "Start Server",
            "Cancel"
        );
        if (start === "Start Server") {
            await vscode.commands.executeCommand("momodoc.startServer");
            const newPort = sidecar.getPort();
            if (newPort === null) {
                vscode.window.showErrorMessage("Failed to start Momodoc server.");
                return;
            }
            await vscode.env.openExternal(
                vscode.Uri.parse(`http://127.0.0.1:${newPort}#settings`)
            );
        }
        return;
    }

    await vscode.env.openExternal(
        vscode.Uri.parse(`http://127.0.0.1:${port}#settings`)
    );
}

/**
 * Handle the "Momodoc: Open Web UI" command.
 *
 * Opens the momodoc web UI in the user's default browser.
 */
export async function openUI(sidecar: SidecarManager): Promise<void> {
    const port = sidecar.getPort();

    if (port === null) {
        const start = await vscode.window.showWarningMessage(
            "Momodoc server is not running. Start it first?",
            "Start Server",
            "Cancel"
        );
        if (start === "Start Server") {
            await vscode.commands.executeCommand("momodoc.startServer");
            const newPort = sidecar.getPort();
            if (newPort === null) {
                vscode.window.showErrorMessage("Failed to start Momodoc server.");
                return;
            }
            await vscode.env.openExternal(
                vscode.Uri.parse(`http://127.0.0.1:${newPort}`)
            );
        }
        return;
    }

    await vscode.env.openExternal(
        vscode.Uri.parse(`http://127.0.0.1:${port}`)
    );
}
