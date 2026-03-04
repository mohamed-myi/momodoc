"""Focused tests for ingestion parser registry and chunking policy abstractions."""

from unittest.mock import MagicMock

import pytest

from app.routers import file_content
from app.services.ingestion.chunking_policy import ChunkingPolicy
from app.services.ingestion.chunkers.treesitter_chunker import TreeSitterChunker
from app.services.ingestion.parser_registry import ParserRegistry
from app.services.ingestion.parsers.base import FileParser, ParsedContent
from app.services.ingestion.parsers.code_parser import CodeParser
from app.services.ingestion.parsers.docx_parser import DocxParser
from app.services.ingestion.parsers.markdown_parser import MarkdownParser
from app.services.ingestion.parsers.pdf_parser import PdfParser
from app.services.ingestion.pipeline import IngestionPipeline


def test_default_parser_registry_preserves_parser_order():
    registry = ParserRegistry.with_defaults()

    assert [type(parser) for parser in registry.parsers] == [
        PdfParser,
        DocxParser,
        MarkdownParser,
        CodeParser,
    ]


@pytest.mark.parametrize(
    ("ext", "expected_type"),
    [
        (".pdf", PdfParser),
        (".docx", DocxParser),
        (".md", MarkdownParser),
        (".py", CodeParser),
        (".unknown", None),
    ],
)
def test_parser_registry_selects_expected_parser(ext, expected_type):
    registry = ParserRegistry.with_defaults()

    selected = registry.select_parser(ext)

    if expected_type is None:
        assert selected is None
    else:
        assert isinstance(selected, expected_type)


@pytest.mark.parametrize("ext", [".pdf", ".docx", ".md", ".py", ".unknown"])
def test_file_content_router_preview_uses_ingestion_default_parser_selection_order(ext):
    router_registry = file_content._PARSER_REGISTRY
    ingestion_registry = ParserRegistry.with_defaults()

    assert [type(parser) for parser in router_registry.parsers] == [
        type(parser) for parser in ingestion_registry.parsers
    ]

    router_parser = router_registry.select_parser(ext)
    ingestion_parser = ingestion_registry.select_parser(ext)
    assert (type(router_parser) if router_parser else None) is (
        type(ingestion_parser) if ingestion_parser else None
    )


def test_chunking_policy_select_decision_uses_extension_specific_sizes(monkeypatch):
    monkeypatch.setattr(TreeSitterChunker, "supports", classmethod(lambda cls, lang: True))
    policy = ChunkingPolicy(
        chunk_size_default=111,
        chunk_overlap_default=11,
        chunk_size_code=222,
        chunk_size_pdf=333,
        chunk_size_markdown=444,
    )

    markdown = policy.select_decision(".md", "markdown")
    pdf = policy.select_decision(".pdf", "")
    code = policy.select_decision(".py", "python")
    unknown = policy.select_decision(".bin", "")

    assert markdown.strategy == "text"
    assert markdown.chunk_size == 444
    assert markdown.overlap == 11
    assert markdown.uses_tree_sitter is False

    assert pdf.strategy == "text"
    assert pdf.chunk_size == 333
    assert pdf.overlap == 11
    assert pdf.uses_tree_sitter is False

    assert code.strategy == "code"
    assert code.chunk_size == 222
    assert code.overlap == 0
    assert code.uses_tree_sitter is True

    assert unknown.strategy == "text"
    assert unknown.chunk_size == 111
    assert unknown.overlap == 11
    assert unknown.uses_tree_sitter is False


def test_ingestion_pipeline_uses_injected_parser_registry():
    class SentinelParser(FileParser):
        def parse(self, file_path: str) -> ParsedContent:
            return ParsedContent(text="", language="")

        def supports(self, file_extension: str) -> bool:
            return file_extension == ".sentinel"

    registry = ParserRegistry(parsers=(SentinelParser(),))
    pipeline = IngestionPipeline(
        db=MagicMock(),
        vectordb=MagicMock(),
        embedder=MagicMock(),
        parser_registry=registry,
    )

    assert pipeline._select_parser(".sentinel") is registry.parsers[0]
    assert pipeline._select_parser(".md") is None
