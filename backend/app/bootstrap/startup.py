import asyncio
import logging
import os
import secrets
import time
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from fastapi import FastAPI

from app.config import Settings
from app.core import database as db_module
from app.core.async_vectordb import AsyncVectorStore
from app.core.database import init_db
from app.core.job_tracker import JobTracker
from app.core.logging import configure_logging
from app.core.rate_limiter import ChatRateLimiter
from app.core.settings_store import SettingsStore
from app.core.vectordb import VectorStore
from app.core.ws_manager import WSManager
from app.dependencies import get_settings
from app.llm.factory import ProviderRegistry, create_llm_provider
from app.services.ingestion.embedder import Embedder
from app.services.reranker import Reranker
from app.services.system_config_service import check_embedding_model

from app.bootstrap.watcher import start_file_watchers

logger = logging.getLogger(__name__)


async def _broadcast_startup_status(
    ws_manager: WSManager | None,
    *,
    step: str,
    status: str,
    detail: str,
) -> None:
    if ws_manager is None:
        return
    try:
        await ws_manager.broadcast(
            {
                "type": "startup_progress",
                "step": step,
                "status": status,
                "detail": detail,
            }
        )
    except Exception:
        logger.debug("Failed to broadcast startup status for step %s", step, exc_info=True)


async def _build_fts_index_task(vectordb: AsyncVectorStore, ws_manager: WSManager) -> None:
    try:
        await _broadcast_startup_status(
            ws_manager,
            step="fts_index",
            status="running",
            detail="Building full-text search index",
        )
        logger.info("DEFERRED STARTUP: Building FTS index...")
        await vectordb.create_fts_index()
        logger.info("DEFERRED STARTUP: FTS index ready")
        await _broadcast_startup_status(
            ws_manager,
            step="fts_index",
            status="completed",
            detail="Full-text search index ready",
        )
    except Exception as e:
        logger.warning("DEFERRED STARTUP: FTS index build failed: %s", e)
        await _broadcast_startup_status(
            ws_manager,
            step="fts_index",
            status="failed",
            detail=str(e),
        )


def _run_migrations(database_url: str) -> None:
    """Run Alembic migrations programmatically."""
    import sqlalchemy

    alembic_cfg = AlembicConfig(str(Path(__file__).resolve().parent.parent.parent / "alembic.ini"))
    # Disable Alembic's own logging configuration - use our pre-configured handlers
    alembic_cfg.attributes["configure_logger"] = False
    alembic_cfg.set_main_option(
        "script_location",
        str(Path(__file__).resolve().parent.parent.parent / "migrations"),
    )
    # Override the URL so Alembic uses the resolved path
    alembic_cfg.set_main_option("sqlalchemy.url", database_url.replace("+aiosqlite", ""))

    sync_url = database_url.replace("+aiosqlite", "")
    engine = sqlalchemy.create_engine(sync_url)
    try:
        with engine.connect() as conn:
            inspector = sqlalchemy.inspect(engine)
            all_tables = inspector.get_table_names()
            has_tables = "projects" in all_tables

            current_rev = None
            if "alembic_version" in all_tables:
                row = conn.execute(
                    sqlalchemy.text("SELECT version_num FROM alembic_version")
                ).first()
                current_rev = row[0] if row else None
    finally:
        engine.dispose()

    if has_tables and current_rev is None:
        alembic_command.stamp(alembic_cfg, "head")
    else:
        alembic_command.upgrade(alembic_cfg, "head")


async def _auto_sync_projects(
    settings: Settings,
    vectordb: AsyncVectorStore,
    embedder: Embedder,
    job_tracker: JobTracker,
    ws_manager: WSManager | None = None,
) -> None:
    """Launch background sync for all projects with a source_directory."""
    from sqlalchemy import select

    from app.models.project import Project
    from app.services import sync_service

    try:
        async with db_module.async_session_factory() as session:
            result = await session.execute(
                select(Project).where(Project.source_directory != None)  # noqa: E711
            )
            projects = result.scalars().all()
    except Exception as e:
        logger.error("Failed to query projects for auto-sync: %s", e)
        return

    for proj in projects:
        if not proj.source_directory or not os.path.isdir(proj.source_directory):
            logger.warning(
                "Skipping auto-sync for project '%s': directory '%s' does not exist",
                proj.name,
                proj.source_directory,
            )
            continue

        logger.info("Auto-syncing project '%s' from '%s'", proj.name, proj.source_directory)
        try:
            async with db_module.async_session_factory() as db:
                job = await job_tracker.create_job(db, proj.id)
                await db.commit()
            asyncio.create_task(
                sync_service.run_sync_job(
                    job_id=job.id,
                    project_id=proj.id,
                    directory_path=proj.source_directory,
                    upload_dir=settings.upload_dir,
                    vectordb=vectordb,
                    embedder=embedder,
                    job_tracker=job_tracker,
                    settings=settings,
                    ws_manager=ws_manager,
                )
            )
        except ValueError:
            logger.warning("Sync already running for project '%s'", proj.name)
        except Exception as e:
            logger.error("Failed to start auto-sync for project '%s': %s", proj.name, e)


async def _deferred_startup(
    app: FastAPI,
    settings: Settings,
    vectordb: AsyncVectorStore,
    job_tracker: JobTracker,
    ws_manager: WSManager,
) -> None:
    """Non-critical initialization that runs after the server starts accepting requests."""
    logger.info("DEFERRED STARTUP: Beginning background initialization...")
    try:
        await _broadcast_startup_status(
            ws_manager,
            step="deferred_startup",
            status="running",
            detail="Initializing background services",
        )

        # 1. Load embedder in background thread (heavy — 500ms cached, 30-120s first download)
        await _broadcast_startup_status(
            ws_manager,
            step="embedder",
            status="running",
            detail=f"Loading embedding model {settings.embedding_model}",
        )
        logger.info("DEFERRED STARTUP: Loading embedding model: %s", settings.embedding_model)
        embedder = await asyncio.to_thread(
            Embedder,
            settings.embedding_model,
            settings.embedding_max_workers,
            settings.embedding_dimension,
            settings.embedding_device or None,
            settings.embedding_trust_remote_code,
        )
        app.state.embedder = embedder
        logger.info("DEFERRED STARTUP: Embedding model loaded successfully")
        await _broadcast_startup_status(
            ws_manager,
            step="embedder",
            status="completed",
            detail="Embedding model loaded",
        )

        # 2. Load reranker model (if enabled)
        if settings.reranker_enabled:
            await _broadcast_startup_status(
                ws_manager,
                step="reranker",
                status="running",
                detail="Loading reranker model",
            )
            reranker_model = settings.reranker_model or None
            reranker_device = settings.reranker_device or None
            logger.info(
                "DEFERRED STARTUP: Loading reranker model: %s",
                reranker_model or "(auto-detect)",
            )
            reranker = await asyncio.to_thread(
                Reranker,
                reranker_model or "",
                reranker_device or "",
                settings.reranker_max_workers,
            )
            app.state.reranker = reranker
            logger.info("DEFERRED STARTUP: Reranker model loaded successfully")
            await _broadcast_startup_status(
                ws_manager,
                step="reranker",
                status="completed",
                detail="Reranker model loaded",
            )
        else:
            logger.info("DEFERRED STARTUP: Reranker disabled via settings")

        # 3. Launch FTS build as its own task so deferred startup can continue.
        # Hybrid search remains available via vector fallback while this runs.
        app.state.fts_index_task = asyncio.create_task(_build_fts_index_task(vectordb, ws_manager))

        # 4. Cleanup orphaned vectors left behind by failed deletions
        await _broadcast_startup_status(
            ws_manager,
            step="orphan_cleanup",
            status="running",
            detail="Cleaning orphaned vectors",
        )
        logger.info("DEFERRED STARTUP: Cleaning up orphaned vectors...")
        from app.services.maintenance import cleanup_orphaned_vectors

        async with db_module.async_session_factory() as session:
            await cleanup_orphaned_vectors(session, vectordb)
        logger.info("DEFERRED STARTUP: Orphan cleanup complete")
        await _broadcast_startup_status(
            ws_manager,
            step="orphan_cleanup",
            status="completed",
            detail="Orphaned vectors cleaned",
        )

        # 5. Auto-sync projects with source_directory
        await _broadcast_startup_status(
            ws_manager,
            step="auto_sync",
            status="running",
            detail="Starting project auto-sync",
        )
        logger.info("DEFERRED STARTUP: Starting auto-sync for projects...")
        await _auto_sync_projects(settings, vectordb, embedder, job_tracker, ws_manager)
        await _broadcast_startup_status(
            ws_manager,
            step="auto_sync",
            status="completed",
            detail="Project auto-sync launched",
        )

        # 6. Start file watchers for all projects with source directories
        await _broadcast_startup_status(
            ws_manager,
            step="file_watchers",
            status="running",
            detail="Starting file watchers",
        )
        logger.info("DEFERRED STARTUP: Starting file watchers...")
        await start_file_watchers(app.state.file_watcher, settings, vectordb, embedder)
        await _broadcast_startup_status(
            ws_manager,
            step="file_watchers",
            status="completed",
            detail="File watchers started",
        )

        app.state.startup_complete = True
        await _broadcast_startup_status(
            ws_manager,
            step="deferred_startup",
            status="completed",
            detail="Deferred startup complete",
        )
        logger.info("=" * 80)
        logger.info("DEFERRED STARTUP COMPLETE - All background tasks initialized")
        logger.info("=" * 80)
    except Exception as e:
        logger.exception("DEFERRED STARTUP FAILED: %s", e)
        logger.error("Server is running but some features may not work correctly")
        await _broadcast_startup_status(
            ws_manager,
            step="deferred_startup",
            status="failed",
            detail=str(e),
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # --- CRITICAL PATH: must complete before server accepts requests ---

    # Configure logging first so all subsequent init steps are visible
    configure_logging(settings.log_level, log_dir=str(settings.data_dir))

    logger.info("=" * 80)
    logger.info("MOMODOC BACKEND STARTUP - PID %d", os.getpid())
    logger.info("=" * 80)

    # Ensure data directories exist (triggers cached_property creation)
    _ = settings.data_dir
    _ = settings.upload_dir
    _ = settings.vector_dir
    logger.info("Data directory: %s", settings.data_dir)
    logger.info("Upload directory: %s", settings.upload_dir)
    logger.info("Vector directory: %s", settings.vector_dir)

    # Load persisted settings and overlay onto the env-derived Settings instance.
    # Precedence: settings.json > env vars / .env > coded defaults.
    settings_store = SettingsStore(os.path.join(settings.data_dir, "settings.json"))
    persisted = settings_store.get_all()
    if persisted:
        logger.info("Applying %d persisted settings from settings.json", len(persisted))
        for key, value in persisted.items():
            if hasattr(settings, key) and value not in (None, ""):
                object.__setattr__(settings, key, value)

    # Init database and run migrations
    db_url = settings.resolved_database_url
    init_db(
        db_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )
    logger.info("Running database migrations")
    # Run migrations synchronously - they're fast (<1s) and logging must work
    _run_migrations(db_url)
    logger.info("Database migrations complete")

    # Init WebSocket manager early so migration broadcasts can use it
    ws_manager = WSManager()

    # Check embedding model; handle migration if model changed
    async with db_module.async_session_factory() as session:
        embedding_status = await check_embedding_model(session, settings.embedding_model)

    # Init LanceDB vector store (without FTS — deferred)
    logger.info("Initializing vector store...")
    sync_vectordb = VectorStore(
        settings.vector_dir,
        settings.embedding_dimension,
        search_nprobes=settings.vectordb_search_nprobes,
        search_refine_factor=settings.vectordb_search_refine_factor,
    )

    if embedding_status.model_changed:
        logger.warning(
            "Embedding model changed from '%s' to '%s'. All vectors will be re-indexed.",
            embedding_status.previous_model,
            embedding_status.current_model,
        )
        await _broadcast_startup_status(
            ws_manager,
            step="embedding_migration",
            status="running",
            detail=f"Migrating from {embedding_status.previous_model} to {embedding_status.current_model}",
        )

        sync_vectordb.reset_table()

        async with db_module.async_session_factory() as session:
            from app.models.file import File
            from app.models.issue import Issue
            from app.models.note import Note

            await session.execute(
                File.__table__.update().values(chunk_count=0)
            )
            await session.execute(
                Note.__table__.update().values(chunk_count=0)
            )
            await session.execute(
                Issue.__table__.update().values(chunk_count=0)
            )
            await session.commit()
            logger.info("Reset chunk_count to 0 across files, notes, and issues")

        await _broadcast_startup_status(
            ws_manager,
            step="embedding_migration",
            status="completed",
            detail="Embedding model migration completed; re-indexing will follow",
        )

    vectordb = AsyncVectorStore(
        sync_vectordb,
        max_workers=settings.vectordb_max_workers,
        max_read_concurrency=settings.vectordb_max_read_concurrency,
    )
    logger.info("Vector store ready (dimension=%d)", settings.embedding_dimension)

    # Init LLM provider registry (lightweight, lazy per-provider caching)
    logger.info("Initializing LLM provider: %s", settings.llm_provider)
    provider_registry = ProviderRegistry(settings)
    llm_provider = create_llm_provider(settings)
    logger.info("LLM provider initialized: %s", settings.llm_provider)

    # Generate session token (restrict file permissions to owner-only)
    logger.info("Generating session token...")
    token = secrets.token_urlsafe(32)
    fd = os.open(settings.session_token_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, token.encode())
    finally:
        os.close(fd)
    app.state.session_token = token
    logger.info("Session token written to: %s", settings.session_token_path)

    # Init job tracker and recover stale jobs
    job_tracker = JobTracker()
    async with db_module.async_session_factory() as session:
        await job_tracker.recover_stale_jobs(session)
        await job_tracker.hydrate_from_db(session)
    logger.info("Job tracker initialized")

    # Init file watcher object (lightweight — no watches started yet)
    from app.core.file_watcher import ProjectFileWatcher

    file_watcher = ProjectFileWatcher()

    # Set app state — embedder starts as None, loaded by deferred task
    app.state.settings = settings
    app.state.settings_store = settings_store
    app.state.vectordb = vectordb
    app.state.embedder = None
    app.state.reranker = None
    app.state.llm_provider = llm_provider
    app.state.provider_registry = provider_registry
    app.state.job_tracker = job_tracker
    app.state.ws_manager = ws_manager
    app.state.chat_rate_limiter = ChatRateLimiter(settings)
    app.state.file_watcher = file_watcher
    app.state.fts_index_task = None
    app.state.start_time = time.time()
    app.state.startup_complete = False
    app.state.embedding_migration_occurred = embedding_status.model_changed

    logger.info("=" * 80)
    logger.info("CRITICAL STARTUP COMPLETE - Server ready to accept requests")
    logger.info("=" * 80)
    logger.info("Launching deferred startup tasks in background...")

    # --- DEFERRED: launch background tasks (don't await) ---
    # Embedder loading, FTS index, orphan cleanup, auto-sync, file watchers
    asyncio.create_task(_deferred_startup(app, settings, vectordb, job_tracker, ws_manager))

    yield

    # --- SHUTDOWN ---

    # Stop all file watchers
    file_watcher.stop_all()

    # Release embedder thread pool and loky process pool (if loaded)
    embedder = getattr(app.state, "embedder", None)
    app.state.embedder = None
    if embedder is not None:
        embedder.shutdown()

    # Release reranker thread pool (if loaded)
    reranker = getattr(app.state, "reranker", None)
    app.state.reranker = None
    if reranker is not None:
        reranker.shutdown()

    # Cancel deferred FTS task if still running.
    fts_task = getattr(app.state, "fts_index_task", None)
    if fts_task is not None and not fts_task.done():
        fts_task.cancel()
        with suppress(asyncio.CancelledError):
            await fts_task

    # Shutdown dedicated vector DB executor
    if getattr(app.state, "vectordb", None) is not None:
        app.state.vectordb.shutdown()

    # Cleanup token file
    try:
        os.remove(settings.session_token_path)
    except OSError as e:
        logger.warning("Failed to remove session token file: %s", e)
    logger.info("momodoc backend stopped")
