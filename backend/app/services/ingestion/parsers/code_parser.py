import os

from app.services.ingestion.parsers.base import FileParser, ParsedContent

EXTENSION_TO_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".ts": "typescript",
    ".jsx": "javascript",
    ".tsx": "typescript",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".sh": "bash",
    ".bash": "bash",
    ".sql": "sql",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".json": "json",
    ".toml": "toml",
    ".xml": "xml",
    ".html": "html",
    ".css": "css",
    ".scss": "scss",
}


class CodeParser(FileParser):
    def parse(self, file_path: str) -> ParsedContent:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()

        _, ext = os.path.splitext(file_path)
        language = EXTENSION_TO_LANGUAGE.get(ext.lower(), "text")

        return ParsedContent(text=text, language=language)

    def supports(self, file_extension: str) -> bool:
        return file_extension.lower() in EXTENSION_TO_LANGUAGE
