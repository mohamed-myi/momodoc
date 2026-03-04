"""add section_header to message_sources

Revision ID: 006
Revises: 005
Create Date: 2026-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("message_sources") as batch_op:
        batch_op.add_column(
            sa.Column("section_header", sa.String(1024), nullable=False, server_default="")
        )


def downgrade() -> None:
    with op.batch_alter_table("message_sources") as batch_op:
        batch_op.drop_column("section_header")
