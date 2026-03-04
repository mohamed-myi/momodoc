# Momodoc Tutorial

Last verified against source on 2026-03-04.

This guide explains the workflows the codebase currently supports across desktop, web, VS Code, and CLI.

## 1. Choose How You Want To Run Momodoc

### Packaged desktop app

Use:

- [Desktop Install](desktop-install.md)
- [Command-Line Install](command-line-install.md)

This is the easiest path if you want the full desktop experience.

### Run from source

If you are running from the repo:

```bash
make momo-install
cp .env.example .env
```

Then start the backend:

```bash
make serve
```

For desktop development, run the Electron app separately:

```bash
make dev-desktop
```

## 2. Understand The Core Data Model

Momodoc organizes work into projects.

Each project can contain:

- files
- notes
- issues
- chat sessions

Search and chat retrieve from all indexed files, notes, and issues in the project.

## 3. Create A Project

You can create a project from:

- desktop dashboard
- web dashboard
- CLI via `momodoc project create`

Projects can optionally include a `source_directory`. When that is set, the files view can launch sync jobs against that directory.

## 4. Add Content

### Files

Current file-ingest paths include:

- upload one or more files in the UI
- drop files or folders into the files view
- use the VS Code `Momodoc: Ingest File` command
- use the CLI:

```bash
momodoc ingest file <project> /path/to/file
momodoc ingest dir <project> /path/to/directory
```

Supported file categories include:

- markdown and text
- PDF and DOCX
- source code
- common config and markup formats

### Notes

Notes are quick text entries stored directly in the project. They are indexed for retrieval and chat.

CLI examples:

```bash
momodoc note add <project> "Remember to update the parser docs"
momodoc note list <project>
```

### Issues

Issues are lightweight tracked tasks or bugs with status and priority.

CLI examples:

```bash
momodoc issue add <project> "Fix sync edge case" --priority high
momodoc issue list <project>
momodoc issue done <project> <issue-id>
```

## 5. Search Versus Chat

Momodoc currently supports two high-level retrieval experiences.

### Search only

Search mode does not require an LLM provider. It returns ranked retrieval results from the indexed corpus.

CLI example:

```bash
momodoc search "sidecar startup" --project <project>
```

### Chat

Chat requires an available LLM provider. The shared UI supports:

- provider selection
- session history
- source citations
- streaming responses

CLI example:

```bash
momodoc chat <project> --query "How does backend startup work?"
```

## 6. Use The Desktop App

The desktop app currently adds several product features that do not exist in the plain web UI.

### Onboarding

The setup wizard can guide you through:

- allowed folders
- AI mode
- startup profile
- first-project creation

### Dashboard

The dashboard includes:

- project list
- global chat
- quick actions
- desktop-specific status cards

### Project view

Project view currently has these sections:

- `Chat`
- `Files`
- `Notes`
- `Issues`

### Metrics

Desktop adds a metrics view with project, storage, chat, and sync summaries.

### Diagnostics

Desktop diagnostics can:

- open the logs folder
- open the data folder
- test backend connection
- restart the backend
- copy a redacted diagnostic report

### Overlay

Desktop can open an always-on-top overlay chat surface. It uses global chat sessions rather than project-scoped sessions.

## 7. Use The Web UI

The web app shares most of the main product UI with the desktop renderer.

Current web navigation is state-based and includes:

- dashboard
- project view
- settings

The web UI does not include the desktop-only overlay, updater, onboarding shell, or metrics page.

## 8. Use The VS Code Extension

The VS Code extension is best for editor-adjacent workflows.

Current extension capabilities:

- start and stop the backend
- ingest the current file into a chosen project
- open the web UI or settings in the browser
- project-scoped sidebar chat

See [VS Code Extension](vscode-extension.md) for full details.

## 9. Use The CLI

The CLI currently exposes:

- `momodoc serve`
- `momodoc stop`
- `momodoc status`
- `momodoc project ...`
- `momodoc ingest ...`
- `momodoc note ...`
- `momodoc issue ...`
- `momodoc search`
- `momodoc chat`
- `momodoc rag-eval`

The CLI is useful for scripting and quick local workflows when you do not need the desktop UI.

## 10. Authentication And Runtime Files

Most API endpoints require:

- `X-Momodoc-Token: <token>`

Useful runtime files in the data directory:

- `session.token`
- `momodoc.pid`
- `momodoc.port`
- `momodoc.log`
- `momodoc-startup.log`

The health endpoint does not require auth:

```bash
curl http://127.0.0.1:8000/api/v1/health
```

## 11. Allowed Paths And Sync

Directory indexing and sync are constrained by `ALLOWED_INDEX_PATHS`.

If you run from source, set it in `.env` when you want directory indexing outside ad hoc file upload flows.

Example:

```env
ALLOWED_INDEX_PATHS=["/Users/me/work","/Users/me/Documents"]
```

If the allowlist is empty, directory indexing and sync requests are rejected.

## 12. Troubleshooting

Start with:

- [Desktop Troubleshooting](desktop-troubleshooting.md)
- [Momodoc Logs And Debugging](logging.md)

If you are using the desktop app, `Settings -> Diagnostics` is the fastest way to gather useful troubleshooting data.
