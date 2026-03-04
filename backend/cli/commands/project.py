import typer
from rich.console import Console
from rich.table import Table

from cli.utils import api_client, handle_response

app = typer.Typer()
console = Console()


@app.command("create")
def create_project(
    name: str = typer.Argument(..., help="Project name"),
    description: str = typer.Option("", "--description", "-d", help="Project description"),
):
    """Create a new project."""
    with api_client() as client:
        resp = client.post(
            "/api/v1/projects",
            json={"name": name, "description": description or None},
        )
        data = handle_response(resp)
        console.print(f"[green]Created project:[/green] {data['name']} (id: {data['id'][:8]})")


@app.command("list")
def list_projects():
    """List all projects."""
    with api_client() as client:
        resp = client.get("/api/v1/projects")
        projects = handle_response(resp)

    if not projects:
        console.print("[dim]No projects found.[/dim]")
        return

    table = Table(title="Projects")
    table.add_column("ID", style="dim", max_width=8)
    table.add_column("Name", style="bold")
    table.add_column("Files")
    table.add_column("Notes")
    table.add_column("Issues")
    table.add_column("Created")

    for p in projects:
        table.add_row(
            p["id"][:8],
            p["name"],
            str(p.get("file_count", 0)),
            str(p.get("note_count", 0)),
            str(p.get("issue_count", 0)),
            p["created_at"][:10],
        )
    console.print(table)


@app.command("show")
def show_project(name_or_id: str = typer.Argument(..., help="Project name or ID")):
    """Show project details."""
    with api_client() as client:
        resp = client.get(f"/api/v1/projects/{name_or_id}")
        data = handle_response(resp)

    console.print(f"[bold]{data['name']}[/bold]")
    console.print(f"  ID: {data['id']}")
    if data.get("description"):
        console.print(f"  Description: {data['description']}")
    console.print(f"  Files: {data.get('file_count', 0)}")
    console.print(f"  Notes: {data.get('note_count', 0)}")
    console.print(f"  Issues: {data.get('issue_count', 0)}")
    console.print(f"  Created: {data['created_at'][:10]}")


@app.command("delete")
def delete_project(
    name_or_id: str = typer.Argument(..., help="Project name or ID"),
    force: bool = typer.Option(False, "--force", "-f", help="Skip confirmation"),
):
    """Delete a project and all associated data."""
    if not force:
        confirm = typer.confirm(f"Delete project '{name_or_id}' and all its data?")
        if not confirm:
            raise typer.Abort()

    with api_client() as client:
        resp = client.delete(f"/api/v1/projects/{name_or_id}")
        handle_response(resp)
        console.print(f"[red]Deleted project:[/red] {name_or_id}")
