from app.services.ingestion.chunkers.base import Chunker, TextChunk

SEPARATORS = ["\n\n", "\n", ". ", " ", ""]


class TextChunker(Chunker):
    def __init__(self, max_chunk_size: int = 2000, overlap: int = 200):
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap

    def chunk(self, text: str, metadata: dict | None = None) -> list[TextChunk]:
        if not text.strip():
            return []

        raw_chunks = self._recursive_split(text, SEPARATORS)
        merged = self._merge_with_overlap(raw_chunks)

        return [
            TextChunk(text=c, chunk_index=i, metadata=metadata or {})
            for i, c in enumerate(merged)
            if c.strip()
        ]

    def _recursive_split(self, text: str, separators: list[str]) -> list[str]:
        if len(text) <= self.max_chunk_size:
            return [text]

        if not separators:
            # Hard split as last resort
            chunks = []
            for i in range(0, len(text), self.max_chunk_size):
                chunks.append(text[i : i + self.max_chunk_size])
            return chunks

        sep = separators[0]
        remaining_seps = separators[1:]

        if not sep:
            # Empty separator: skip straight to hard split
            chunks = []
            for i in range(0, len(text), self.max_chunk_size):
                chunks.append(text[i : i + self.max_chunk_size])
            return chunks

        parts = text.split(sep)
        chunks = []
        current = ""

        for part in parts:
            candidate = current + sep + part if current else part
            if len(candidate) <= self.max_chunk_size:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                if len(part) > self.max_chunk_size:
                    chunks.extend(self._recursive_split(part, remaining_seps))
                    current = ""
                else:
                    current = part

        if current:
            chunks.append(current)

        return chunks

    def _merge_with_overlap(self, chunks: list[str]) -> list[str]:
        if len(chunks) <= 1:
            return chunks

        result = []
        for i, chunk in enumerate(chunks):
            if i > 0 and self.overlap > 0:
                prev = chunks[i - 1]
                # Calculate how much overlap we can actually fit without exceeding max_chunk_size
                available = self.max_chunk_size - len(chunk)
                if available > 0:
                    actual_overlap = min(self.overlap, available)
                    overlap_text = prev[-actual_overlap:]
                    chunk = overlap_text + chunk
            result.append(chunk)

        return result


class SectionAwareTextChunker(Chunker):
    """Text chunker that tracks heading hierarchy and assigns breadcrumbs.

    Prefers splitting at heading boundaries. Each chunk carries a
    section_header breadcrumb derived from the active heading stack at its
    start position (e.g. "Architecture > Data Storage > SQLite Tables").

    When no headings are provided, output is identical to TextChunker.
    """

    def __init__(self, max_chunk_size: int = 2000, overlap: int = 200):
        self.max_chunk_size = max_chunk_size
        self.overlap = overlap
        self._fallback = TextChunker(max_chunk_size=max_chunk_size, overlap=overlap)

    def chunk(self, text: str, metadata: dict | None = None) -> list[TextChunk]:
        if not text.strip():
            return []

        headings: list[dict] = (metadata or {}).get("headings", [])
        if not headings:
            chunks = self._fallback.chunk(text, metadata)
            for c in chunks:
                c.section_header = ""
            return chunks

        sections = self._split_at_headings(text, headings)
        all_chunks: list[TextChunk] = []
        idx = 0

        for section_text, breadcrumb in sections:
            if not section_text.strip():
                continue
            inner_chunker = TextChunker(
                max_chunk_size=self.max_chunk_size, overlap=self.overlap
            )
            inner_chunks = inner_chunker.chunk(section_text, metadata)
            for c in inner_chunks:
                c.chunk_index = idx
                c.section_header = breadcrumb
                idx += 1
            all_chunks.extend(inner_chunks)

        return all_chunks

    def _split_at_headings(
        self, text: str, headings: list[dict]
    ) -> list[tuple[str, str]]:
        """Split text at heading boundaries and pair each section with its breadcrumb.

        Returns a list of (section_text, breadcrumb_string) tuples.
        """
        sorted_headings = sorted(headings, key=lambda h: h["char_offset"])

        split_points: list[tuple[int, str]] = []
        heading_stack: list[tuple[int, str]] = []

        for h in sorted_headings:
            level = h["level"]
            heading_text = h["text"]
            offset = h["char_offset"]

            heading_stack = [
                (lv, txt) for lv, txt in heading_stack if lv < level
            ]
            heading_stack.append((level, heading_text))

            breadcrumb = " > ".join(txt for _, txt in heading_stack)
            split_points.append((offset, breadcrumb))

        if not split_points:
            return [(text, "")]

        sections: list[tuple[str, str]] = []

        if split_points[0][0] > 0:
            sections.append((text[: split_points[0][0]], ""))

        for i, (offset, breadcrumb) in enumerate(split_points):
            end = split_points[i + 1][0] if i + 1 < len(split_points) else len(text)
            sections.append((text[offset:end], breadcrumb))

        return sections
