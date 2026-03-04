import pymupdf4llm

from app.services.ingestion.parsers.base import FileParser, ParsedContent
from app.services.ingestion.parsers.heading_extractor import extract_markdown_headings


class PdfParser(FileParser):
    EXTENSIONS = {".pdf"}

    def parse(self, file_path: str) -> ParsedContent:
        text = pymupdf4llm.to_markdown(file_path)
        headings = extract_markdown_headings(text)
        return ParsedContent(text=text, language="text", headings=headings)

    def supports(self, file_extension: str) -> bool:
        return file_extension.lower() in self.EXTENSIONS
