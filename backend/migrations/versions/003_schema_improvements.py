"""schema improvements: message_sources, sync_jobs, issue chunk_count, file tags

Revision ID: 003
Revises: 002
Create Date: 2026-02-09

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- Sync Jobs ---
    op.create_table(
        "sync_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "project_id",
            sa.String(36),
            sa.ForeignKey("projects.id"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("total_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("skipped_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_files", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_chunks", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("current_file", sa.String(512), nullable=False, server_default=""),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    op.create_table(
        "sync_job_errors",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "job_id",
            sa.String(36),
            sa.ForeignKey("sync_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )

    # --- Message Sources (replaces sources_json) ---
    op.create_table(
        "message_sources",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "message_id",
            sa.String(36),
            sa.ForeignKey("chat_messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("filename", sa.String(512), nullable=True),
        sa.Column("original_path", sa.String(1024), nullable=True),
        sa.Column("chunk_text", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("source_order", sa.Integer(), nullable=False, server_default="0"),
    )

    # Drop sources_json from chat_messages
    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.drop_column("sources_json")

    # Add chunk_count to issues
    with op.batch_alter_table("issues") as batch_op:
        batch_op.add_column(sa.Column("chunk_count", sa.Integer(), server_default="0"))

    # Add tags to files
    with op.batch_alter_table("files") as batch_op:
        batch_op.add_column(sa.Column("tags", sa.String(512), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("files") as batch_op:
        batch_op.drop_column("tags")

    with op.batch_alter_table("issues") as batch_op:
        batch_op.drop_column("chunk_count")

    with op.batch_alter_table("chat_messages") as batch_op:
        batch_op.add_column(sa.Column("sources_json", sa.Text(), nullable=True))

    op.drop_table("message_sources")
    op.drop_table("sync_job_errors")
    op.drop_table("sync_jobs")
