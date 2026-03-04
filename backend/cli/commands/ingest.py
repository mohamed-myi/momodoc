import os

import typer
from rich.console import Console

from cli.utils import api_client, handle_response

app = typer.Typer()
console = Console()


@app.command("file")
def ingest_file(
    project: str = typer.Argument(..., help="Project name or ID"),
    filepath: str = typer.Argument(..., help="Path to the file to ingest"),
):
    """Upload and ingest a single file."""
    filepath = os.path.abspath(filepath)
    if not os.path.exists(filepath):
        console.print(f"[red]File not found:[/red] {filepath}")
        raise typer.Exit(1)

    with api_client() as client:
        with open(filepath, "rb") as f:
            resp = client.post(
                f"/api/v1/projects/{project}/files/upload",
                files={"file": (os.path.basename(filepath), f)},
            )
        data = handle_response(resp)

    console.print(
        f"[green]Ingested:[/green] {data.get('filename', 'unknown')} "
        f"({data.get('chunk_count', 0)} chunks)"
    )


@app.command("dir")
def ingest_directory(
    project: str = typer.Argument(..., help="Project name or ID"),
    dirpath: str = typer.Argument(..., help="Path to directory to index"),
):
    """Index all supported files in a directory."""
    dirpath = os.path.abspath(dirpath)
    if not os.path.isdir(dirpath):
        console.print(f"[red]Directory not found:[/red] {dirpath}")
        raise typer.Exit(1)

    console.print(f"Indexing directory: {dirpath}")
    with api_client() as client:
        resp = client.post(
            f"/api/v1/projects/{project}/files/index-directory",
            json={"path": dirpath},
            timeout=600.0,
        )
        data = handle_response(resp)

    console.print(
        f"[green]Done:[/green] {data.get('total_files', 0)} files, "
        f"{data.get('total_chunks', 0)} chunks, {data.get('skipped', 0)} skipped"
    )
    for r in data.get("results", []):
        if r.get("errors"):
            console.print(f"  [red]{r['filename']}:[/red] {', '.join(r['errors'])}")
