"""Shared heading extraction for markdown and RST content.

Scans text for ATX-style markdown headings (lines starting with one to six
hash characters) and RST underline-style headings. Returns a list of heading
dicts ordered by their character offset in the source text.
"""

import re

_ATX_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)(?:\s+#+\s*)?$", re.MULTILINE)

_RST_UNDERLINE_CHARS = set("=-~^\"'+`:._;*#")
_RST_UNDERLINE_RE = re.compile(r"^([=\-~^\"'+`:._;*#])\1{2,}\s*$")


def extract_markdown_headings(text: str) -> list[dict]:
    """Extract heading hierarchy from markdown or RST text.

    Each returned dict contains:
      level (int): heading depth (1 for H1, 2 for H2, etc.)
      text (str): heading text without the leading hashes or trailing markers
      char_offset (int): character position in the source where the heading line begins
    """
    headings: list[dict] = []

    headings.extend(_extract_atx_headings(text))
    headings.extend(_extract_rst_headings(text))

    headings.sort(key=lambda h: h["char_offset"])
    return headings


def _extract_atx_headings(text: str) -> list[dict]:
    results: list[dict] = []
    for match in _ATX_HEADING_RE.finditer(text):
        level = len(match.group(1))
        heading_text = match.group(2).strip()
        results.append(
            {
                "level": level,
                "text": heading_text,
                "char_offset": match.start(),
            }
        )
    return results


def _extract_rst_headings(text: str) -> list[dict]:
    """Detect RST underline-style headings.

    RST headings are a text line followed by an underline of repeated
    punctuation characters at least as long as the text. The underline
    character determines the heading level (assigned in order of first
    appearance since RST does not prescribe fixed levels).
    """
    results: list[dict] = []
    lines = text.split("\n")
    char_offset = 0
    seen_underline_chars: list[str] = []

    for i, line in enumerate(lines):
        line_start = char_offset
        char_offset += len(line) + 1  # +1 for the newline

        if i == 0:
            continue

        prev_line = lines[i - 1]
        prev_stripped = prev_line.strip()

        if not prev_stripped or _ATX_HEADING_RE.match(prev_line):
            continue

        if not _RST_UNDERLINE_RE.match(line):
            continue

        underline_char = line.strip()[0]
        if len(line.strip()) < len(prev_stripped):
            continue

        if underline_char not in seen_underline_chars:
            seen_underline_chars.append(underline_char)
        level = seen_underline_chars.index(underline_char) + 1

        prev_line_start = line_start - len(prev_line) - 1
        if prev_line_start < 0:
            prev_line_start = 0

        results.append(
            {
                "level": level,
                "text": prev_stripped,
                "char_offset": prev_line_start,
            }
        )

    return results
