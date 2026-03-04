from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class TextChunk:
    text: str
    chunk_index: int
    metadata: dict = field(default_factory=dict)
    section_header: str = ""


class Chunker(ABC):
    @abstractmethod
    def chunk(self, text: str, metadata: dict | None = None) -> list[TextChunk]:
        ...
