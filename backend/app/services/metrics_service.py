import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.models.chat_message import ChatMessage
from app.models.chat_session import ChatSession
from app.models.file import File
from app.models.issue import Issue
from app.models.note import Note
from app.models.project import Project
from app.models.sync_job import SyncJob

logger = logging.getLogger(__name__)


async def get_overview(db: AsyncSession, settings: Settings, start_time: float) -> dict:
    """Aggregate counts across all tables."""
    project_count = (await db.execute(select(func.count(Project.id)))).scalar() or 0
    file_count = (await db.execute(select(func.count(File.id)))).scalar() or 0
    session_count = (await db.execute(select(func.count(ChatSession.id)))).scalar() or 0
    message_count = (await db.execute(select(func.count(ChatMessage.id)))).scalar() or 0

    # Chunk count from files (sum of chunk_count column)
    chunk_count = (
        await db.execute(select(func.coalesce(func.sum(File.chunk_count), 0)))
    ).scalar() or 0

    # Add note + issue chunk counts
    note_chunks = (
        await db.execute(select(func.coalesce(func.sum(Note.chunk_count), 0)))
    ).scalar() or 0
    issue_chunks = (
        await db.execute(select(func.coalesce(func.sum(Issue.chunk_count), 0)))
    ).scalar() or 0
    total_chunks = chunk_count + note_chunks + issue_chunks

    # Storage: sum file_size from files table
    total_storage = (
        await db.execute(select(func.coalesce(func.sum(File.file_size), 0)))
    ).scalar() or 0

    uptime = datetime.now(timezone.utc).timestamp() - start_time

    return {
        "total_projects": project_count,
        "total_files": file_count,
        "total_chunks": total_chunks,
        "total_sessions": session_count,
        "total_messages": message_count,
        "total_storage_bytes": total_storage,
        "uptime_seconds": round(uptime, 1),
    }


async def get_project_metrics(db: AsyncSession) -> list[dict]:
    """Per-project breakdown using batched subqueries (avoids N+1)."""
    projects = (await db.execute(select(Project))).scalars().all()
    if not projects:
        return []

    project_ids = [p.id for p in projects]

    # Batch: file counts and storage per project
    file_stats = {
        row.project_id: (row.cnt, row.chunks, row.storage)
        for row in (
            await db.execute(
                select(
                    File.project_id,
                    func.count(File.id).label("cnt"),
                    func.coalesce(func.sum(File.chunk_count), 0).label("chunks"),
                    func.coalesce(func.sum(File.file_size), 0).label("storage"),
                )
                .where(File.project_id.in_(project_ids))
                .group_by(File.project_id)
            )
        ).all()
    }

    # Batch: note counts per project
    note_stats = {
        row.project_id: (row.cnt, row.chunks)
        for row in (
            await db.execute(
                select(
                    Note.project_id,
                    func.count(Note.id).label("cnt"),
                    func.coalesce(func.sum(Note.chunk_count), 0).label("chunks"),
                )
                .where(Note.project_id.in_(project_ids))
                .group_by(Note.project_id)
            )
        ).all()
    }

    # Batch: issue counts per project
    issue_stats = {
        row.project_id: (row.cnt, row.chunks)
        for row in (
            await db.execute(
                select(
                    Issue.project_id,
                    func.count(Issue.id).label("cnt"),
                    func.coalesce(func.sum(Issue.chunk_count), 0).label("chunks"),
                )
                .where(Issue.project_id.in_(project_ids))
                .group_by(Issue.project_id)
            )
        ).all()
    }

    # Batch: message counts per project (via sessions)
    message_stats = {
        row.project_id: row.cnt
        for row in (
            await db.execute(
                select(
                    ChatSession.project_id,
                    func.count(ChatMessage.id).label("cnt"),
                )
                .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
                .where(ChatSession.project_id.in_(project_ids))
                .group_by(ChatSession.project_id)
            )
        ).all()
    }

    results = []
    for p in projects:
        f_cnt, f_chunks, f_storage = file_stats.get(p.id, (0, 0, 0))
        n_cnt, n_chunks = note_stats.get(p.id, (0, 0))
        i_cnt, i_chunks = issue_stats.get(p.id, (0, 0))
        m_cnt = message_stats.get(p.id, 0)

        results.append(
            {
                "project_id": p.id,
                "project_name": p.name,
                "file_count": f_cnt,
                "note_count": n_cnt,
                "issue_count": i_cnt,
                "chunk_count": f_chunks + n_chunks + i_chunks,
                "message_count": m_cnt,
                "storage_bytes": f_storage,
                "last_activity": p.updated_at.isoformat() if p.updated_at else None,
            }
        )

    return results


async def get_chat_metrics(db: AsyncSession, days: int = 30) -> dict:
    """Daily chat activity for the last N days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    total_sessions = (
        await db.execute(select(func.count(ChatSession.id)).where(ChatSession.created_at >= cutoff))
    ).scalar() or 0

    total_messages = (
        await db.execute(select(func.count(ChatMessage.id)).where(ChatMessage.created_at >= cutoff))
    ).scalar() or 0

    # Daily breakdown using date function
    daily_messages = (
        await db.execute(
            select(
                func.date(ChatMessage.created_at).label("date"),
                func.count(ChatMessage.id).label("messages"),
            )
            .where(ChatMessage.created_at >= cutoff)
            .group_by(func.date(ChatMessage.created_at))
            .order_by(func.date(ChatMessage.created_at))
        )
    ).all()

    daily_sessions = (
        await db.execute(
            select(
                func.date(ChatSession.created_at).label("date"),
                func.count(ChatSession.id).label("sessions"),
            )
            .where(ChatSession.created_at >= cutoff)
            .group_by(func.date(ChatSession.created_at))
            .order_by(func.date(ChatSession.created_at))
        )
    ).all()

    # Merge into daily array
    msg_map = {str(row.date): row.messages for row in daily_messages}
    sess_map = {str(row.date): row.sessions for row in daily_sessions}
    all_dates = sorted(set(msg_map.keys()) | set(sess_map.keys()))

    daily = [
        {
            "date": d,
            "sessions": sess_map.get(d, 0),
            "messages": msg_map.get(d, 0),
        }
        for d in all_dates
    ]

    avg = total_messages / total_sessions if total_sessions > 0 else 0

    return {
        "daily": daily,
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "avg_messages_per_session": round(avg, 1),
    }


async def get_storage_metrics(db: AsyncSession, settings: Settings) -> dict:
    """Storage breakdown by category and file type."""
    total_file_storage = (
        await db.execute(select(func.coalesce(func.sum(File.file_size), 0)))
    ).scalar() or 0

    # By file type
    by_type = (
        await db.execute(
            select(
                File.file_type,
                func.count(File.id).label("count"),
                func.coalesce(func.sum(File.file_size), 0).label("total_bytes"),
            )
            .group_by(File.file_type)
            .order_by(func.sum(File.file_size).desc())
        )
    ).all()

    # Disk sizes for database and vector dirs (blocking I/O → thread pool)
    db_size, vector_size, upload_size = await asyncio.gather(
        asyncio.to_thread(_dir_size, os.path.join(settings.data_dir, "db")),
        asyncio.to_thread(_dir_size, settings.vector_dir),
        asyncio.to_thread(_dir_size, settings.upload_dir),
    )

    return {
        "total_bytes": total_file_storage + db_size + vector_size,
        "uploads_bytes": upload_size,
        "database_bytes": db_size,
        "vectors_bytes": vector_size,
        "by_file_type": [
            {
                "file_type": row.file_type or "unknown",
                "count": row.count,
                "total_bytes": row.total_bytes,
            }
            for row in by_type
        ],
    }


async def get_sync_metrics(db: AsyncSession, days: int = 30) -> dict:
    """Sync job history for the last N days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    jobs = (
        (
            await db.execute(
                select(SyncJob).where(SyncJob.created_at >= cutoff).order_by(SyncJob.created_at)
            )
        )
        .scalars()
        .all()
    )

    total_jobs = len(jobs)
    total_files = sum(j.processed_files for j in jobs)
    total_errors = sum(j.failed_files for j in jobs)

    # Average duration (completed jobs only)
    completed = [j for j in jobs if j.completed_at and j.created_at]
    avg_duration = 0.0
    if completed:
        durations = [(j.completed_at - j.created_at).total_seconds() for j in completed]
        avg_duration = sum(durations) / len(durations)

    error_rate = total_errors / max(total_files, 1)

    # Daily breakdown
    daily_map: dict[str, dict] = {}
    for j in jobs:
        d = j.created_at.strftime("%Y-%m-%d")
        if d not in daily_map:
            daily_map[d] = {"date": d, "jobs": 0, "files_processed": 0, "errors": 0}
        daily_map[d]["jobs"] += 1
        daily_map[d]["files_processed"] += j.processed_files
        daily_map[d]["errors"] += j.failed_files

    daily = sorted(daily_map.values(), key=lambda x: x["date"])

    return {
        "daily": daily,
        "total_jobs": total_jobs,
        "avg_duration_seconds": round(avg_duration, 1),
        "error_rate": round(error_rate, 3),
        "total_files_processed": total_files,
    }


def _dir_size(path: str) -> int:
    """Get total size of a directory in bytes."""
    total = 0
    try:
        for dirpath, _, filenames in os.walk(path):
            for f in filenames:
                fp = os.path.join(dirpath, f)
                try:
                    total += os.path.getsize(fp)
                except OSError:
                    pass
    except OSError:
        pass
    return total
