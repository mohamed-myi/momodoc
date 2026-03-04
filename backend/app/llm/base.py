from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field


@dataclass
class LLMMessage:
    role: str
    content: str


@dataclass
class LLMResponse:
    content: str
    model: str
    usage: dict = field(default_factory=dict)


class LLMProvider(ABC):
    @abstractmethod
    async def complete(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> LLMResponse: ...

    @abstractmethod
    async def stream(
        self,
        messages: list[LLMMessage],
        max_tokens: int = 4096,
        temperature: float = 0.3,
    ) -> AsyncIterator[str]: ...

    @abstractmethod
    def get_model_name(self) -> str: ...
