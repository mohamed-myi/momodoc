"""Chunking policy for ingestion parsing results.

Encapsulates file-type/language chunking decisions so `IngestionPipeline` stays
focused on orchestration.
"""

from dataclasses import dataclass
import logging
from typing import Literal

from app.services.ingestion.chunkers.base import TextChunk
from app.services.ingestion.chunkers.code_chunker import RegexCodeChunker
from app.services.ingestion.chunkers.text_chunker import SectionAwareTextChunker, TextChunker
from app.services.ingestion.chunkers.treesitter_chunker import TreeSitterChunker
from app.services.ingestion.parsers.base import ParsedContent
from app.services.ingestion.parsers.code_parser import EXTENSION_TO_LANGUAGE

logger = logging.getLogger(__name__)

MARKDOWN_EXTENSIONS = {".md", ".markdown", ".rst", ".txt"}
PDF_EXTENSIONS = {".pdf"}


@dataclass(frozen=True)
class ChunkingDecision:
    strategy: Literal["code", "text"]
    chunk_size: int
    overlap: int
    uses_tree_sitter: bool


class ChunkingPolicy:
    """Default chunking policy based on file extension and parsed language."""

    def __init__(
        self,
        *,
        chunk_size_default: int = 2000,
        chunk_overlap_default: int = 200,
        chunk_size_code: int = 2000,
        chunk_size_pdf: int = 3000,
        chunk_size_markdown: int = 2000,
    ) -> None:
        self._chunk_size_default = chunk_size_default
        self._chunk_overlap_default = chunk_overlap_default
        self._chunk_size_code = chunk_size_code
        self._chunk_size_pdf = chunk_size_pdf
        self._chunk_size_markdown = chunk_size_markdown

    def select_decision(self, ext: str, language: str | None = None) -> ChunkingDecision:
        ext_lower = ext.lower()
        parsed_language = language or ""
        if ext_lower in PDF_EXTENSIONS:
            return ChunkingDecision(
                strategy="text",
                chunk_size=self._chunk_size_pdf,
                overlap=self._chunk_overlap_default,
                uses_tree_sitter=False,
            )
        if ext_lower in MARKDOWN_EXTENSIONS:
            return ChunkingDecision(
                strategy="text",
                chunk_size=self._chunk_size_markdown,
                overlap=self._chunk_overlap_default,
                uses_tree_sitter=False,
            )
        if ext_lower in EXTENSION_TO_LANGUAGE:
            return ChunkingDecision(
                strategy="code",
                chunk_size=self._chunk_size_code,
                overlap=0,
                uses_tree_sitter=TreeSitterChunker.supports(parsed_language),
            )
        return ChunkingDecision(
            strategy="text",
            chunk_size=self._chunk_size_default,
            overlap=self._chunk_overlap_default,
            uses_tree_sitter=False,
        )

    def chunk(
        self,
        *,
        filename: str,
        ext: str,
        parsed: ParsedContent,
    ) -> list[TextChunk]:
        """Chunk parsed content using the selected chunking policy."""
        lang = parsed.language or ""
        decision = self.select_decision(ext, lang)

        if decision.strategy == "code":
            chunk_meta = {"language": lang}
            chunks: list[TextChunk] = []
            if decision.uses_tree_sitter:
                ts_chunker = TreeSitterChunker(max_chunk_size=decision.chunk_size)
                chunks = ts_chunker.chunk(parsed.text, chunk_meta)
                if not chunks:
                    logger.debug(
                        "Tree-sitter returned no chunks for %s (%s), falling back to regex chunker",
                        filename,
                        lang,
                    )
            else:
                logger.debug(
                    "No tree-sitter grammar configured for %s (%s), using regex chunker",
                    filename,
                    lang,
                )
            if not chunks:
                regex_chunker = RegexCodeChunker(max_chunk_size=decision.chunk_size)
                chunks = regex_chunker.chunk(parsed.text, chunk_meta)
            return chunks

        text_meta = {"headings": parsed.headings} if parsed.headings else None
        text_chunker = SectionAwareTextChunker(
            max_chunk_size=decision.chunk_size,
            overlap=decision.overlap,
        )
        return text_chunker.chunk(parsed.text, text_meta)
