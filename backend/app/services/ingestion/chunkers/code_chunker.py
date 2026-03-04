import re

from app.services.ingestion.chunkers.base import Chunker, TextChunk

# Regex patterns for function/class boundaries per language
BOUNDARY_PATTERNS = {
    "python": re.compile(r"^(def |class |async def )", re.MULTILINE),
    "javascript": re.compile(
        r"^(function |const \w+ = |let \w+ = |var \w+ = |class |export )", re.MULTILINE
    ),
    "typescript": re.compile(
        r"^(function |const \w+ = |let \w+ = |class |export |interface |type )", re.MULTILINE
    ),
    "java": re.compile(
        r"^(\s*(public|private|protected|static)\s+)", re.MULTILINE
    ),
    "go": re.compile(r"^(func |type )", re.MULTILINE),
    "rust": re.compile(r"^(pub |fn |impl |struct |enum |trait |mod )", re.MULTILINE),
    "c": re.compile(r"^(\w+[\s*]+\w+\s*\()", re.MULTILINE),
    "cpp": re.compile(r"^(\w+[\s*]+\w+\s*\(|class |struct |namespace )", re.MULTILINE),
    "ruby": re.compile(r"^(def |class |module )", re.MULTILINE),
    "php": re.compile(r"^(function |class |public |private |protected )", re.MULTILINE),
    "swift": re.compile(r"^(func |class |struct |enum |protocol )", re.MULTILINE),
    "kotlin": re.compile(r"^(fun |class |object |interface |data class )", re.MULTILINE),
}


class RegexCodeChunker(Chunker):
    def __init__(self, max_chunk_size: int = 2000):
        self.max_chunk_size = max_chunk_size

    def chunk(self, text: str, metadata: dict | None = None) -> list[TextChunk]:
        if not text.strip():
            return []

        language = (metadata or {}).get("language", "text")
        pattern = BOUNDARY_PATTERNS.get(language)

        if pattern:
            raw_chunks = self._split_by_boundaries(text, pattern)
        else:
            raw_chunks = self._split_by_blank_lines(text)

        # Enforce max size: if any chunk exceeds limit, split it further
        final_chunks = []
        for chunk_text in raw_chunks:
            if len(chunk_text) > self.max_chunk_size:
                final_chunks.extend(self._hard_split(chunk_text))
            else:
                final_chunks.append(chunk_text)

        return [
            TextChunk(text=c, chunk_index=i, metadata=metadata or {})
            for i, c in enumerate(final_chunks)
            if c.strip()
        ]

    def _split_by_boundaries(self, text: str, pattern: re.Pattern) -> list[str]:
        matches = list(pattern.finditer(text))
        if not matches:
            return self._split_by_blank_lines(text)

        chunks = []
        # Text before first boundary
        if matches[0].start() > 0:
            preamble = text[: matches[0].start()].strip()
            if preamble:
                chunks.append(preamble)

        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

        return self._merge_small_chunks(chunks)

    def _split_by_blank_lines(self, text: str) -> list[str]:
        blocks = re.split(r"\n\s*\n", text)
        return self._merge_small_chunks([b.strip() for b in blocks if b.strip()])

    def _merge_small_chunks(self, chunks: list[str], min_size: int = 200) -> list[str]:
        if not chunks:
            return []

        merged = []
        current = chunks[0]

        for chunk in chunks[1:]:
            # Only merge if current chunk is below minimum size AND combined fits
            if len(current) < min_size and len(current) + len(chunk) + 2 <= self.max_chunk_size:
                current = current + "\n\n" + chunk
            else:
                merged.append(current)
                current = chunk

        if current:
            merged.append(current)

        return merged

    def _hard_split(self, text: str) -> list[str]:
        lines = text.split("\n")
        chunks = []
        current = ""
        for line in lines:
            if len(current) + len(line) + 1 > self.max_chunk_size and current:
                chunks.append(current)
                current = line
            else:
                current = current + "\n" + line if current else line
        if current:
            chunks.append(current)
        return chunks
