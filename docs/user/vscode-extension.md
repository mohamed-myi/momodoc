# VS Code Extension Guide

The Momodoc VS Code extension lets you manage the backend server, ingest files from your editor, and chat with your knowledge base in a sidebar panel.

## Prerequisites

- Momodoc backend installed (`make momo-install` from the repo root)
- VS Code 1.85 or later

## Install the Extension

Build and install the `.vsix` package:

```bash
cd extension
npm install
npm run compile
npm run package
```

This produces a `.vsix` file in `extension/`. Install it in VS Code:
- Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
- Click the `...` menu -> `Install from VSIX...`
- Select the generated `.vsix` file

After installation, a Momodoc icon appears in the Activity Bar.

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Momodoc":

| Command | What it does |
|---|---|
| `Momodoc: Start Server` | Starts the backend process (sidecar) |
| `Momodoc: Stop Server` | Stops the backend process |
| `Momodoc: Open Web UI` | Opens the web frontend in your browser |
| `Momodoc: Ingest File` | Ingests the currently open file into a project |

`Momodoc: Ingest File` is also available from the file explorer context menu (right-click a file).

## Status Bar

The extension adds a status bar item at the bottom of VS Code:

- Running: `Momodoc` with a check icon. Click to open web UI.
- Stopped: `Momodoc` with a circle-slash icon. Click to start server.
- Starting: Shows a spinner while the backend boots.

## Sidebar Chat

Click the Momodoc icon in the Activity Bar to open the chat sidebar.

### Toolbar controls

- **Project selector**: Choose which project to query. Projects are fetched from the running backend.
- **Session selector**: Pick an existing chat session or start a new one with `New chat`.
- **Model selector**: Choose the LLM provider (`Gemini`, `Claude`, `OpenAI`, `Ollama`). Only configured/available providers appear.
- **New session (+)**: Create a fresh chat session.

### Chat behavior

- Chat is **project-scoped**: each conversation is tied to a single project.
- Responses stream in token-by-token via SSE.
- Source citations appear below responses. Click a source to open the file in your editor.
- Your selected project, session, and model persist across VS Code reloads.

### Tips

- Make sure the backend is running before using chat. Start it with `Momodoc: Start Server` or `make serve` in a terminal.
- If no projects appear in the selector, create one first using the CLI (`momodoc project create my-project`) or the desktop/web UI.
- If a provider shows as unavailable, configure its API key in your `.env` file and restart the backend.

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `momodoc.defaultLlmMode` | `gemini` | Default LLM provider for chat (`gemini`, `claude`, `openai`, `ollama`) |

Note: the chat sidebar uses its own persisted model selection (saved in webview state). This setting serves as the initial default.

## Troubleshooting

### Chat shows no projects
- Backend is not running or token/port files are missing.
- Run `Momodoc: Start Server` from the Command Palette.

### Extension cannot connect to backend
- Confirm backend is running: `curl -sf http://127.0.0.1:8000/api/v1/health`
- Check the Momodoc output channel in VS Code (`View -> Output -> Momodoc`) for sidecar errors.

### Ingest File does nothing
- Backend must be running.
- The file must have a supported extension (see [Tutorial](tutorial.md) section 6.1 for the full list).
