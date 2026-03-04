from app.services.ingestion.parsers.base import FileParser, ParsedContent
from app.services.ingestion.parsers.heading_extractor import extract_markdown_headings


class MarkdownParser(FileParser):
    EXTENSIONS = {".md", ".markdown", ".rst", ".txt"}

    def parse(self, file_path: str) -> ParsedContent:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        headings = extract_markdown_headings(text)
        return ParsedContent(text=text, language="text", headings=headings)

    def supports(self, file_extension: str) -> bool:
        return file_extension.lower() in self.EXTENSIONS
