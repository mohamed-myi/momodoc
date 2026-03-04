"""Shared test fixtures for momodoc backend tests."""

from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import Settings
from app.core.async_vectordb import AsyncVectorStore
from app.core.database import Base
from app.core.job_tracker import JobTracker
from app.dependencies import (
    get_db,
    get_embedder,
    get_job_tracker,
    get_llm_provider,
    get_provider_registry,
    get_query_llm,
    get_reranker,
    get_vectordb,
    get_ws_manager,
    get_settings,
)
from app.llm.base import LLMProvider, LLMResponse
from app.main import create_app
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker


@pytest_asyncio.fixture
async def db_engine():
    """Create an in-memory async SQLite engine for tests."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )

    def _set_pragmas(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    event.listen(engine.sync_engine, "connect", _set_pragmas)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine):
    """Provide a transactional async session that rolls back after each test."""
    from app.core import database as db_module

    session_factory = async_sessionmaker(db_engine, class_=AsyncSession, expire_on_commit=False)

    # Set the global session factory for services that create their own sessions
    db_module.async_session_factory = session_factory

    async with session_factory() as session:
        yield session

    # Clean up
    db_module.async_session_factory = None


@pytest.fixture
def mock_vectordb():
    """Return a MagicMock standing in for VectorStore."""
    vectordb = MagicMock(spec=AsyncVectorStore)
    vectordb.search = AsyncMock(return_value=[])
    vectordb.hybrid_search = AsyncMock(return_value=[])
    vectordb.fts_search = AsyncMock(return_value=[])
    vectordb.get_by_filter = AsyncMock(return_value=[])
    vectordb.get_distinct_column = AsyncMock(return_value=[])
    vectordb.add = AsyncMock(return_value=None)
    vectordb.delete = AsyncMock(return_value=None)
    vectordb.delete_by_ids = AsyncMock(return_value=None)
    vectordb.create_fts_index = AsyncMock(return_value=None)
    vectordb.shutdown = MagicMock(return_value=None)
    return vectordb


@pytest.fixture
def mock_embedder():
    """Return a mock Embedder that produces zero-vectors."""
    embedder = MagicMock(spec=Embedder)
    embedder.model_name = "test-model"
    embedder.embed_texts.return_value = [[0.0] * 384]
    embedder.embed_texts_for_storage.return_value = [[0.0] * 384]
    embedder.embed_texts_for_query.return_value = [[0.0] * 384]
    embedder.embed_single.return_value = [0.0] * 384
    embedder.embed_single_query.return_value = [0.0] * 384

    async def _aembed_texts(texts, batch_size=512, mode="document"):
        return [[0.0] * 384 for _ in texts]

    async def _aembed_single(text):
        return [0.0] * 384

    embedder.aembed_texts = AsyncMock(side_effect=_aembed_texts)
    embedder.aembed_single = AsyncMock(side_effect=_aembed_single)
    return embedder


@pytest.fixture
def mock_reranker():
    """Return a mock Reranker that returns inputs in original order."""
    reranker = MagicMock(spec=Reranker)
    reranker.model_name = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    reranker.is_shutdown = False

    def _rerank(query, documents, top_k=10):
        return [(i, 1.0 - i * 0.1) for i in range(min(len(documents), top_k))]

    async def _arerank(query, documents, top_k=10):
        return _rerank(query, documents, top_k)

    reranker.rerank = MagicMock(side_effect=_rerank)
    reranker.arerank = AsyncMock(side_effect=_arerank)
    reranker.shutdown = MagicMock()
    return reranker


@pytest.fixture
def mock_llm():
    """Return a mock LLM provider."""
    llm = AsyncMock(spec=LLMProvider)
    llm.complete.return_value = LLMResponse(content="Test answer", model="test-model", usage={})

    async def _mock_stream(*args, **kwargs):
        for token in ["Test ", "answer"]:
            yield token

    llm.stream = _mock_stream
    llm.get_model_name.return_value = "test-model"
    return llm


TEST_TOKEN = "test-session-token-for-testing"


@pytest.fixture
def test_settings():
    """Return Settings overridden for testing."""
    return Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        momodoc_data_dir="/tmp/momodoc-test-data",
        embedding_model="test-model",
        embedding_dimension=384,
        max_upload_size_mb=1,
        allowed_index_paths=["/tmp/momodoc-test"],
        anthropic_api_key="",
    )


@pytest.fixture
def mock_provider_registry(mock_llm):
    """Return a mock ProviderRegistry."""
    registry = MagicMock()
    registry.get.return_value = mock_llm
    return registry


@pytest.fixture
def mock_job_tracker():
    """Return a JobTracker instance for tests."""
    return JobTracker()


@pytest.fixture
def mock_ws_manager():
    """Return a mock WSManager for tests."""
    ws = MagicMock()
    ws.broadcast = AsyncMock()
    return ws


@pytest.fixture
def mock_file_watcher():
    """Return a mock ProjectFileWatcher for tests."""
    from app.core.file_watcher import ProjectFileWatcher

    watcher = MagicMock(spec=ProjectFileWatcher)
    watcher.watched_project_ids = []
    return watcher


@pytest_asyncio.fixture
async def client(
    db_session,
    mock_vectordb,
    mock_embedder,
    mock_reranker,
    mock_llm,
    mock_provider_registry,
    mock_job_tracker,
    mock_ws_manager,
    mock_file_watcher,
    test_settings,
):
    """Create an async test client with all dependencies overridden."""
    from app.dependencies import get_file_watcher

    app = create_app()

    # Set session token on app.state so the middleware lets requests through
    app.state.session_token = TEST_TOKEN
    app.state.file_watcher = mock_file_watcher

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_vectordb] = lambda: mock_vectordb
    app.dependency_overrides[get_embedder] = lambda: mock_embedder
    app.dependency_overrides[get_reranker] = lambda: mock_reranker
    app.dependency_overrides[get_llm_provider] = lambda: mock_llm
    app.dependency_overrides[get_provider_registry] = lambda: mock_provider_registry
    app.dependency_overrides[get_job_tracker] = lambda: mock_job_tracker
    app.dependency_overrides[get_ws_manager] = lambda: mock_ws_manager
    app.dependency_overrides[get_file_watcher] = lambda: mock_file_watcher
    app.dependency_overrides[get_settings] = lambda: test_settings
    app.dependency_overrides[get_query_llm] = lambda: None

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"X-Momodoc-Token": TEST_TOKEN},
    ) as ac:
        yield ac

    app.dependency_overrides.clear()
