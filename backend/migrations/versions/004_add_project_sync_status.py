"""add project sync status columns

Revision ID: 004
Revises: 003
Create Date: 2026-02-12

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(sa.Column("last_sync_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_sync_status", sa.String(20), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("last_sync_status")
        batch_op.drop_column("last_sync_at")
