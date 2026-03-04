"""add performance indexes for hot query paths

Revision ID: 005
Revises: 004
Create Date: 2026-02-19

"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Project-scoped content lookups
    op.create_index("ix_files_project_id", "files", ["project_id"], unique=False)
    op.create_index(
        "ix_files_project_original_path",
        "files",
        ["project_id", "original_path"],
        unique=False,
    )
    op.create_index("ix_notes_project_id", "notes", ["project_id"], unique=False)
    op.create_index("ix_issues_project_id", "issues", ["project_id"], unique=False)
    op.create_index(
        "ix_issues_project_status",
        "issues",
        ["project_id", "status"],
        unique=False,
    )

    # Chat/session/message history
    op.create_index("ix_chat_sessions_project_id", "chat_sessions", ["project_id"], unique=False)
    op.create_index("ix_chat_sessions_updated_at", "chat_sessions", ["updated_at"], unique=False)
    op.create_index("ix_chat_messages_session_id", "chat_messages", ["session_id"], unique=False)
    op.create_index("ix_chat_messages_created_at", "chat_messages", ["created_at"], unique=False)
    op.create_index(
        "ix_message_sources_message_id", "message_sources", ["message_id"], unique=False
    )
    op.create_index("ix_message_sources_source_id", "message_sources", ["source_id"], unique=False)

    # Sync monitoring and error retrieval
    op.create_index("ix_sync_jobs_project_id", "sync_jobs", ["project_id"], unique=False)
    op.create_index("ix_sync_jobs_status", "sync_jobs", ["status"], unique=False)
    op.create_index("ix_sync_jobs_created_at", "sync_jobs", ["created_at"], unique=False)
    op.create_index("ix_sync_job_errors_job_id", "sync_job_errors", ["job_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_sync_job_errors_job_id", table_name="sync_job_errors")
    op.drop_index("ix_sync_jobs_created_at", table_name="sync_jobs")
    op.drop_index("ix_sync_jobs_status", table_name="sync_jobs")
    op.drop_index("ix_sync_jobs_project_id", table_name="sync_jobs")
    op.drop_index("ix_message_sources_source_id", table_name="message_sources")
    op.drop_index("ix_message_sources_message_id", table_name="message_sources")
    op.drop_index("ix_chat_messages_created_at", table_name="chat_messages")
    op.drop_index("ix_chat_messages_session_id", table_name="chat_messages")
    op.drop_index("ix_chat_sessions_updated_at", table_name="chat_sessions")
    op.drop_index("ix_chat_sessions_project_id", table_name="chat_sessions")
    op.drop_index("ix_issues_project_status", table_name="issues")
    op.drop_index("ix_issues_project_id", table_name="issues")
    op.drop_index("ix_notes_project_id", table_name="notes")
    op.drop_index("ix_files_project_original_path", table_name="files")
    op.drop_index("ix_files_project_id", table_name="files")
