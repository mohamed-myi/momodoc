"""Tree-sitter based code chunker for AST-aware code splitting."""

import importlib
import logging

import tree_sitter

from app.services.ingestion.chunkers.base import Chunker, TextChunk
from app.services.ingestion.chunkers.grammar_config import LANGUAGE_ALIASES, LANGUAGE_CONFIG

logger = logging.getLogger(__name__)


class TreeSitterChunker(Chunker):
    """Splits code into chunks aligned to AST node boundaries (functions, classes, etc.).

    Parsers are lazy-loaded and cached per language to avoid loading all grammars at import time.
    Falls back to None when a language grammar is unavailable.
    """

    _parsers: dict[str, tree_sitter.Parser] = {}
    _languages: dict[str, tree_sitter.Language] = {}

    def __init__(self, max_chunk_size: int = 2000, min_chunk_size: int = 200):
        self.max_chunk_size = max_chunk_size
        self.min_chunk_size = min_chunk_size

    @classmethod
    def supports(cls, language: str) -> bool:
        """Check if tree-sitter grammar is available for the language."""
        resolved = LANGUAGE_ALIASES.get(language, language)
        return resolved in LANGUAGE_CONFIG

    @classmethod
    def _get_parser(cls, language: str) -> tree_sitter.Parser | None:
        """Get or create a parser for the given language. Returns None if unavailable."""
        resolved = LANGUAGE_ALIASES.get(language, language)
        if resolved in cls._parsers:
            return cls._parsers[resolved]

        config = LANGUAGE_CONFIG.get(resolved)
        if not config:
            return None

        try:
            mod = importlib.import_module(config["module"])

            # Handle TypeScript (has typescript/tsx sub-languages)
            if "ts_language" in config:
                lang = tree_sitter.Language(mod.language(config["ts_language"]))
            elif "php_language" in config:
                lang = tree_sitter.Language(mod.language())
            else:
                lang = tree_sitter.Language(mod.language())

            parser = tree_sitter.Parser(lang)
            cls._parsers[resolved] = parser
            cls._languages[resolved] = lang
            return parser
        except Exception:
            logger.warning("Failed to load tree-sitter grammar for %s", resolved)
            return None

    def chunk(self, text: str, metadata: dict | None = None) -> list[TextChunk]:
        if not text.strip():
            return []

        language = (metadata or {}).get("language", "text")
        parser = self._get_parser(language)
        if parser is None:
            return []  # Signal caller to fall back

        resolved = LANGUAGE_ALIASES.get(language, language)
        config = LANGUAGE_CONFIG[resolved]
        target_types = config["node_types"]

        tree = parser.parse(text.encode("utf-8"))
        root = tree.root_node

        # Extract top-level definition nodes
        chunks: list[str] = []
        self._extract_nodes(root, target_types, text, chunks)

        if not chunks:
            # No top-level definitions found — return whole file as single chunk
            return self._make_text_chunks([text], metadata)

        # Merge small chunks and enforce max size
        merged = self._merge_small(chunks)
        final = []
        for c in merged:
            if len(c) > self.max_chunk_size:
                final.extend(self._hard_split(c))
            else:
                final.append(c)

        return self._make_text_chunks(final, metadata)

    def _extract_nodes(
        self,
        node: tree_sitter.Node,
        target_types: set[str],
        source: str,
        out: list[str],
    ) -> None:
        """Walk the AST and extract chunks for target node types.

        Includes leading comments/docstrings that immediately precede a definition.
        """
        prev_end = 0
        for child in node.children:
            if child.type in target_types:
                # Capture any leading comment block
                text = self._extract_with_leading_comments(node, child, source, prev_end)
                out.append(text)
                prev_end = child.end_byte
            elif child.type == "comment" or child.type == "block_comment":
                # Comments are captured with the next definition
                continue
            else:
                # For non-definition nodes (imports, etc.), collect as preamble
                text = source[child.start_byte : child.end_byte].strip()
                if text and child is node.children[0]:
                    # Preamble (imports, module docstrings)
                    out.append(text)
                    prev_end = child.end_byte

    def _extract_with_leading_comments(
        self,
        parent: tree_sitter.Node,
        node: tree_sitter.Node,
        source: str,
        prev_end: int,
    ) -> str:
        """Extract node text with any immediately preceding comments."""
        # Look backwards from the node for comment siblings
        comment_start = node.start_byte
        for sibling in parent.children:
            if sibling.end_byte > node.start_byte:
                break
            if sibling.start_byte >= prev_end and sibling.type in (
                "comment",
                "block_comment",
                "line_comment",
                "decorator",
                "decorated_definition",
                "attribute",
            ):
                comment_start = min(comment_start, sibling.start_byte)

        return source[comment_start : node.end_byte].strip()

    def _merge_small(self, chunks: list[str]) -> list[str]:
        """Merge adjacent small chunks."""
        if not chunks:
            return []

        merged = []
        current = chunks[0]

        for chunk in chunks[1:]:
            combined_len = len(current) + len(chunk) + 2
            if len(current) < self.min_chunk_size and combined_len <= self.max_chunk_size:
                current = current + "\n\n" + chunk
            else:
                merged.append(current)
                current = chunk

        if current:
            merged.append(current)

        return merged

    def _hard_split(self, text: str) -> list[str]:
        """Split oversized text by lines."""
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

    def _make_text_chunks(self, texts: list[str], metadata: dict | None) -> list[TextChunk]:
        return [
            TextChunk(text=t, chunk_index=i, metadata=metadata or {})
            for i, t in enumerate(texts)
            if t.strip()
        ]
