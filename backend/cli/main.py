import typer

from cli.commands import ingest, issue, note, project, server
from cli.commands.chat import chat
from cli.commands.rag_eval import rag_eval
from cli.commands.search import search

app = typer.Typer(
    name="momodoc",
    help="Personal RAG-based knowledge management tool.",
    no_args_is_help=True,
)

app.add_typer(project.app, name="project", help="Manage projects")
app.add_typer(ingest.app, name="ingest", help="Ingest files and directories")
app.add_typer(note.app, name="note", help="Manage quick notes")
app.add_typer(issue.app, name="issue", help="Manage issues/todos")

# search and chat are top-level commands (not sub-apps)
app.command(name="search", help="Vector similarity search")(search)
app.command(name="chat", help="RAG-powered chat")(chat)
app.command(name="rag-eval", help="Evaluate retrieval quality from a JSONL dataset")(rag_eval)
app.command(name="serve")(server.serve)
app.command(name="stop")(server.stop)
app.command(name="status")(server.status)


if __name__ == "__main__":
    app()
