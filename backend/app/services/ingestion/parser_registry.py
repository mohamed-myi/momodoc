"""Parser registry for ingestion file-type selection.

Owns parser ordering and selection so the pipeline does not hard-code parser
instances directly.
"""

from dataclasses import dataclass

from app.services.ingestion.parsers.base import FileParser
from app.services.ingestion.parsers.code_parser import CodeParser
from app.services.ingestion.parsers.docx_parser import DocxParser
from app.services.ingestion.parsers.markdown_parser import MarkdownParser
from app.services.ingestion.parsers.pdf_parser import PdfParser


def build_default_parsers() -> tuple[FileParser, ...]:
    """Return the default parser chain in precedence order."""
    return (
        PdfParser(),
        DocxParser(),
        MarkdownParser(),
        CodeParser(),
    )


@dataclass(frozen=True)
class ParserRegistry:
    """Ordered parser registry used by ingestion orchestration."""

    parsers: tuple[FileParser, ...]

    @classmethod
    def with_defaults(cls) -> "ParserRegistry":
        return cls(parsers=build_default_parsers())

    def select_parser(self, ext: str) -> FileParser | None:
        for parser in self.parsers:
            if parser.supports(ext):
                return parser
        return None
