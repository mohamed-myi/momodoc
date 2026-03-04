class NotFoundError(Exception):
    def __init__(self, entity: str, identifier: str):
        self.entity = entity
        self.identifier = identifier
        super().__init__(f"{entity} not found: {identifier}")


class ValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class LLMNotConfiguredError(Exception):
    def __init__(self, provider: str | None = None):
        if provider:
            msg = (
                f"LLM provider '{provider}' is not configured. Check your API key in the .env file."
            )
        else:
            msg = (
                "No LLM provider is configured. "
                "Set an API key (ANTHROPIC_API_KEY, GOOGLE_API_KEY, or OPENAI_API_KEY) in your .env file."
            )
        super().__init__(msg)


class LLMError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class EmbeddingModelMismatchError(Exception):
    def __init__(self, configured: str, stored: str):
        self.configured = configured
        self.stored = stored
        super().__init__(
            f"Embedding model mismatch: configured '{configured}' but data was indexed with '{stored}'. "
            "Re-index all data or revert the model config."
        )


class VectorStoreError(Exception):
    def __init__(self, message: str, operation: str | None = None):
        self.message = message
        self.operation = operation
        super().__init__(message)


class EmbeddingServiceUnavailableError(Exception):
    def __init__(self, message: str = "Embedding service is unavailable.") -> None:
        self.message = message
        super().__init__(message)


class ConflictError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class RateLimitExceededError(Exception):
    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: int,
        limit: int,
        scope: str,
    ) -> None:
        self.message = message
        self.retry_after_seconds = retry_after_seconds
        self.limit = limit
        self.scope = scope
        super().__init__(message)
