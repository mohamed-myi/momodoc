"""Tests for the TokenCounter and estimate_tokens utility."""

from app.services.tokenizer import TokenCounter, estimate_tokens


class TestTokenCounter:
    def test_count_hello_world(self):
        counter = TokenCounter()
        count = counter.count("hello world")
        assert isinstance(count, int)
        assert count == 2

    def test_count_empty_string_returns_zero(self):
        counter = TokenCounter()
        assert counter.count("") == 0

    def test_count_is_more_accurate_than_heuristic(self):
        """Token count should differ from len//4 for code-heavy content."""
        code = "def calculate_fibonacci(n):\n    if n <= 1:\n        return n\n    return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)"
        counter = TokenCounter()
        token_count = counter.count(code)
        heuristic = len(code) // 4
        assert token_count != heuristic

    def test_lazy_loading(self):
        counter = TokenCounter()
        assert counter._encoding is None
        counter.count("trigger load")
        assert counter._encoding is not None

    def test_repeated_calls_use_same_encoding(self):
        counter = TokenCounter()
        counter.count("first")
        enc1 = counter._encoding
        counter.count("second")
        enc2 = counter._encoding
        assert enc1 is enc2


class TestEstimateTokens:
    def test_estimate_tokens_returns_int(self):
        result = estimate_tokens("hello world")
        assert isinstance(result, int)
        assert result > 0

    def test_estimate_tokens_empty(self):
        assert estimate_tokens("") == 0

    def test_long_text_produces_many_tokens(self):
        text = "This is a test sentence. " * 100
        count = estimate_tokens(text)
        assert count > 100
