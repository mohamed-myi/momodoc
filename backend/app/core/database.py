from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

engine = None
async_session_factory = None


class Base(DeclarativeBase):
    pass


def _set_sqlite_pragmas(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db(
    database_url: str,
    pool_size: int = 5,
    max_overflow: int = 10,
    pool_recycle: int = 3600,
    pool_pre_ping: bool = True,
):
    global engine, async_session_factory
    engine = create_async_engine(
        database_url,
        echo=False,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_timeout=30,
        pool_recycle=pool_recycle,
        pool_pre_ping=pool_pre_ping,
    )
    async_session_factory = async_sessionmaker(
        engine, class_=AsyncSession, expire_on_commit=False
    )
    event.listen(engine.sync_engine, "connect", _set_sqlite_pragmas)


async def get_db_session():
    if async_session_factory is None:
        raise RuntimeError(
            "Database not initialized. Ensure init_db() was called during app startup."
        )
    async with async_session_factory() as session:
        yield session


async def create_tables():
    if engine is None:
        raise RuntimeError(
            "Database engine not initialized. Ensure init_db() was called during app startup."
        )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
