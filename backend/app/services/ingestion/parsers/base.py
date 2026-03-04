from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ParsedContent:
    text: str
    language: str
    metadata: dict = field(default_factory=dict)
    headings: list[dict] = field(default_factory=list)


class FileParser(ABC):
    @abstractmethod
    def parse(self, file_path: str) -> ParsedContent: ...

    @abstractmethod
    def supports(self, file_extension: str) -> bool: ...
