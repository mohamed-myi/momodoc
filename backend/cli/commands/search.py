import typer
from rich.console import Console

from cli.utils import api_client, handle_response

console = Console()


def search(
    query: str = typer.Argument(..., help="Search query text"),
    project: str = typer.Option(None, "--project", "-p", help="Scope to a project"),
    top_k: int = typer.Option(5, "--top-k", "-k", help="Number of results"),
):
    """Search across indexed documents using vector similarity (no LLM)."""
    with api_client() as client:
        path = f"/api/v1/projects/{project}/search" if project else "/api/v1/search"
        resp = client.post(path, json={"query": query, "top_k": top_k})
        body = handle_response(resp)

    results = body.get("results", []) if isinstance(body, dict) else body
    if not results:
        console.print("[dim]No results found.[/dim]")
        return

    for i, r in enumerate(results, 1):
        score_pct = f"{r.get('score', 0) * 100:.1f}%"
        source = r.get("filename") or "Note"
        console.print(f"\n[bold]{i}. {source}[/bold] (similarity: {score_pct})")
        if r.get("original_path"):
            console.print(f"   Path: {r['original_path']}", style="dim")
        chunk_text = r.get("chunk_text", "")
        preview = chunk_text[:200]
        if len(chunk_text) > 200:
            preview += "..."
        console.print(f"   {preview}")
