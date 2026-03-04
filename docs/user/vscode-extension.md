# VS Code Extension

Last verified against source on 2026-03-04.

The Momodoc VS Code extension is a project-scoped chat and ingest companion for the local backend.

## What The Extension Currently Does

- starts and stops the backend from VS Code
- shows backend status in the status bar
- opens the web UI or settings in the browser
- ingests a file into a selected project
- provides a sidebar chat webview for project chat sessions

## Prerequisites

- VS Code `1.85` or newer
- the `momodoc` backend CLI available in your environment if you want the extension to launch the server itself

Important current behavior:

- the extension sidecar launches `momodoc serve`
- it does not bundle a backend runtime the way packaged desktop builds do

## Building And Installing The Extension

From the repo:

```bash
cd extension
npm install
npm run compile
npm run package
```

That produces a `.vsix` file in `extension/`.

Install it in VS Code through:

- Extensions view
- `...`
- `Install from VSIX...`

## Commands

Current contributed commands are:

- `Momodoc: Start Server`
- `Momodoc: Stop Server`
- `Momodoc: Open Web UI`
- `Momodoc: Ingest File`
- `Momodoc: Open LLM Settings`

`Momodoc: Ingest File` also appears in the Explorer context menu for file resources.

## Status Bar

The extension shows a status bar item that polls backend health every 10 seconds.

Current behavior:

- stopped -> click starts the server
- starting -> spinner
- running -> click opens the web UI

## Sidebar Chat

The sidebar webview is currently project-scoped only.

Current flow:

1. choose a project
2. create or select a chat session
3. choose an LLM mode
4. send a message
5. receive streamed tokens and source links

Source links attempt to open the original file path in the editor when that path is available.

## Persistence

The webview persists these values with VS Code webview state:

- selected project id
- selected session id
- selected LLM mode

That state is restored when the webview reloads.

## Settings

The extension contributes:

- `momodoc.defaultLlmMode`

Important current implementation detail:

- this setting exists in `package.json`
- the current chat webview does not read it
- the sidebar initializes to `gemini` and then persists the last selected mode in webview state

So the contributed setting is not currently wired into live chat behavior.

## Troubleshooting

### The extension cannot start the backend

Check:

- `momodoc` is installed and on `PATH`
- the `Momodoc` output channel in VS Code for sidecar logs

### No projects appear in the chat sidebar

Check:

- the backend is running
- you already created at least one project

### Ingest File fails

Check:

- the backend is running
- you selected a project
- the file type is supported by the ingestion pipeline

### Chat fails or no providers appear

Check:

- the backend can return `/api/v1/llm/providers`
- your selected provider is configured in backend settings
- the server is healthy and the token/port files are present
