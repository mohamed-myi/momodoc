import typer
from rich.console import Console
from rich.table import Table

from cli.utils import api_client, handle_response

app = typer.Typer()
console = Console()


@app.command("add")
def add_note(
    project: str = typer.Argument(..., help="Project name or ID"),
    content: str = typer.Argument(..., help="Note content"),
    tags: str = typer.Option("", "--tags", "-t", help="Comma-separated tags"),
):
    """Add a quick note to a project."""
    with api_client() as client:
        resp = client.post(
            f"/api/v1/projects/{project}/notes",
            json={"content": content, "tags": tags or None},
        )
        data = handle_response(resp)
        console.print(
            f"[green]Note added:[/green] {data['id'][:8]} ({data['chunk_count']} chunks)"
        )


@app.command("list")
def list_notes(
    project: str = typer.Argument(..., help="Project name or ID"),
):
    """List notes in a project."""
    with api_client() as client:
        resp = client.get(f"/api/v1/projects/{project}/notes")
        notes = handle_response(resp)

    if not notes:
        console.print("[dim]No notes found.[/dim]")
        return

    table = Table(title="Notes")
    table.add_column("ID", style="dim", max_width=8)
    table.add_column("Content", max_width=60)
    table.add_column("Tags")
    table.add_column("Created")

    for n in notes:
        content = n.get("content", "")
        content_preview = content[:60] + "..." if len(content) > 60 else content
        table.add_row(
            n["id"][:8],
            content_preview,
            n.get("tags") or "",
            n.get("created_at", "")[:10],
        )
    console.print(table)
