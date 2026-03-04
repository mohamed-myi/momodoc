import logging
import threading

logger = logging.getLogger(__name__)


class TokenCounter:
    """Lazy-loading tiktoken wrapper for accurate token estimation.

    Uses cl100k_base encoding (GPT-4, Claude, and most modern models).
    For local/Ollama models this is a reasonable approximation that
    consistently outperforms the naive len(text) // 4 heuristic.
    """

    def __init__(self) -> None:
        self._encoding = None
        self._lock = threading.Lock()

    def _ensure_encoding(self):
        if self._encoding is not None:
            return
        with self._lock:
            if self._encoding is not None:
                return
            import tiktoken

            self._encoding = tiktoken.get_encoding("cl100k_base")
            logger.debug("tiktoken cl100k_base encoding loaded")

    def count(self, text: str) -> int:
        if not text:
            return 0
        self._ensure_encoding()
        return len(self._encoding.encode(text))


token_counter = TokenCounter()


def estimate_tokens(text: str) -> int:
    return token_counter.count(text)
