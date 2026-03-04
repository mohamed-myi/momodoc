import asyncio
import json
from dataclasses import asdict
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.vectordb import VectorStore
from app.services.ingestion.embedder import Embedder
from app.services.rag_evaluation import (
    RetrievalEvalReport,
    evaluate_retrieval_with_services,
    load_retrieval_cases,
)

console = Console()


def _serialize_report(report: RetrievalEvalReport) -> dict:
    return {
        "total_cases": report.total_cases,
        "avg_recall_at_k": report.avg_recall_at_k,
        "avg_precision_at_k": report.avg_precision_at_k,
        "hit_rate_at_k": report.hit_rate_at_k,
        "mean_reciprocal_rank": report.mean_reciprocal_rank,
        "case_results": [asdict(item) for item in report.case_results],
    }


def _print_summary(report: RetrievalEvalReport) -> None:
    if report.total_cases == 0:
        console.print("[yellow]No evaluation cases were executed.[/yellow]")
        return

    table = Table(title="RAG Retrieval Evaluation")
    table.add_column("Metric")
    table.add_column("Value", justify="right")
    table.add_row("Total Cases", str(report.total_cases))
    table.add_row("Mean Recall@K", f"{report.avg_recall_at_k:.4f}")
    table.add_row("Mean Precision@K", f"{report.avg_precision_at_k:.4f}")
    table.add_row("Hit Rate@K", f"{report.hit_rate_at_k:.4f}")
    table.add_row("MRR", f"{report.mean_reciprocal_rank:.4f}")
    console.print(table)


async def _run_eval(
    cases_path: str,
    max_cases: int | None,
    concurrency: int,
) -> RetrievalEvalReport:
    settings = Settings()
    cases = load_retrieval_cases(cases_path)
    if max_cases is not None:
        cases = cases[:max_cases]

    sync_vectordb = VectorStore(
        settings.vector_dir,
        settings.embedding_dimension,
        search_nprobes=settings.vectordb_search_nprobes,
        search_refine_factor=settings.vectordb_search_refine_factor,
    )
    vectordb = AsyncVectorStore(
        sync_vectordb,
        max_workers=settings.vectordb_max_workers,
        max_read_concurrency=settings.vectordb_max_read_concurrency,
    )
    embedder = Embedder(
        model_name=settings.embedding_model,
        max_workers=settings.embedding_max_workers,
    )

    try:
        return await evaluate_retrieval_with_services(
            vectordb=vectordb,
            embedder=embedder,
            cases=cases,
            concurrency=concurrency,
        )
    finally:
        embedder.shutdown()
        vectordb.shutdown()


def rag_eval(
    cases_path: str = typer.Argument(..., help="Path to retrieval cases JSONL file"),
    output: str | None = typer.Option(
        None,
        "--output",
        "-o",
        help="Optional path to write a JSON evaluation report",
    ),
    max_cases: int | None = typer.Option(
        None,
        "--max-cases",
        help="Optional cap on number of cases from the JSONL file",
    ),
    concurrency: int = typer.Option(
        8,
        "--concurrency",
        min=1,
        help="Maximum concurrent retrieval requests during evaluation",
    ),
):
    """Run retrieval evaluation against a labeled JSONL dataset."""
    try:
        report = asyncio.run(_run_eval(cases_path, max_cases, concurrency))
    except Exception as exc:
        console.print(f"[red]RAG evaluation failed: {exc}[/red]")
        raise typer.Exit(1)

    _print_summary(report)

    if output:
        output_path = Path(output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(_serialize_report(report), indent=2),
            encoding="utf-8",
        )
        console.print(f"[green]Report written to {output_path}[/green]")
