import typer
from rich.console import Console
from rich.table import Table

from cli.utils import api_client, handle_response

app = typer.Typer()
console = Console()


@app.command("add")
def add_issue(
    project: str = typer.Argument(..., help="Project name or ID"),
    title: str = typer.Argument(..., help="Issue title"),
    desc: str = typer.Option("", "--desc", "-d", help="Issue description"),
    priority: str = typer.Option("medium", "--priority", "-p", help="low/medium/high/critical"),
):
    """Create an issue/task in a project."""
    with api_client() as client:
        resp = client.post(
            f"/api/v1/projects/{project}/issues",
            json={
                "title": title,
                "description": desc or None,
                "priority": priority,
            },
        )
        data = handle_response(resp)
        console.print(f"[green]Issue created:[/green] {data['title']} (id: {data['id'][:8]})")


@app.command("list")
def list_issues(
    project: str = typer.Argument(..., help="Project name or ID"),
    status: str = typer.Option(None, "--status", "-s", help="Filter by status"),
):
    """List issues in a project."""
    with api_client() as client:
        params = {}
        if status:
            params["status"] = status
        resp = client.get(f"/api/v1/projects/{project}/issues", params=params)
        issues = handle_response(resp)

    if not issues:
        console.print("[dim]No issues found.[/dim]")
        return

    table = Table(title="Issues")
    table.add_column("ID", style="dim", max_width=8)
    table.add_column("Title")
    table.add_column("Status")
    table.add_column("Priority")
    table.add_column("Created")

    status_colors = {"open": "yellow", "in_progress": "blue", "done": "green"}

    for issue in issues:
        issue_status = issue.get("status", "unknown")
        color = status_colors.get(issue_status, "white")
        table.add_row(
            issue["id"][:8],
            issue["title"],
            f"[{color}]{issue_status}[/{color}]",
            issue.get("priority", ""),
            issue.get("created_at", "")[:10],
        )
    console.print(table)


@app.command("done")
def mark_done(
    project: str = typer.Argument(..., help="Project name or ID"),
    issue_id: str = typer.Argument(..., help="Issue ID"),
):
    """Mark an issue as done."""
    with api_client() as client:
        resp = client.patch(
            f"/api/v1/projects/{project}/issues/{issue_id}",
            json={"status": "done"},
        )
        data = handle_response(resp)
        console.print(f"[green]Done:[/green] {data['title']}")
