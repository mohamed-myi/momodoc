import typer
from rich.console import Console
from rich.markdown import Markdown

from cli.utils import api_client, handle_response

console = Console()


def chat(
    project: str = typer.Argument(..., help="Project name or ID"),
    query: str = typer.Option(None, "--query", "-q", help="Single query (non-interactive)"),
    model: str = typer.Option(
        None, "--model", "-m", help="LLM provider (gemini, claude, openai, ollama)"
    ),
):
    """RAG-powered chat with project knowledge (requires API key)."""
    if query:
        _single_query(project, query, model)
    else:
        _interactive_chat(project, model)


def _single_query(project: str, query: str, model: str | None):
    with api_client() as client:
        resp = client.post(f"/api/v1/projects/{project}/chat/sessions", json={})
        session = handle_response(resp)
        session_id = session["id"]

        payload: dict = {"query": query}
        if model:
            payload["llm_mode"] = model

        resp = client.post(
            f"/api/v1/projects/{project}/chat/sessions/{session_id}/messages",
            json=payload,
        )
        data = handle_response(resp)

    console.print()
    console.print(Markdown(data["answer"]))
    _print_sources(data.get("sources", []))


def _interactive_chat(project: str, model: str | None):
    model_label = f" (model: {model})" if model else ""
    console.print(f"[bold]Chat with project: {project}{model_label}[/bold]")
    console.print("[dim]Type 'exit' or 'quit' to end the session.[/dim]\n")

    with api_client() as client:
        resp = client.post(f"/api/v1/projects/{project}/chat/sessions", json={})
        session = handle_response(resp)
        session_id = session["id"]

        while True:
            try:
                query = console.input("[bold blue]You:[/bold blue] ").strip()
            except (EOFError, KeyboardInterrupt):
                console.print("\n[dim]Session ended.[/dim]")
                break

            if not query:
                continue
            if query.lower() in ("exit", "quit"):
                console.print("[dim]Session ended.[/dim]")
                break

            payload: dict = {"query": query}
            if model:
                payload["llm_mode"] = model

            resp = client.post(
                f"/api/v1/projects/{project}/chat/sessions/{session_id}/messages",
                json=payload,
            )
            data = handle_response(resp)

            console.print()
            console.print(Markdown(data["answer"]))
            _print_sources(data.get("sources", []))
            console.print()


def _print_sources(sources: list[dict]):
    if not sources:
        return
    console.print("\n[dim]Sources:[/dim]")
    for i, s in enumerate(sources, 1):
        name = s.get("filename") or "Note"
        score = f"{s.get('score', 0) * 100:.0f}%"
        path = s.get("original_path")
        label = f"  {i}. {name} ({score})"
        if path:
            label += f" — {path}"
        console.print(label, style="dim")
