"""add_stock_analysis_runs_table

Revision ID: 6a1b2c3d4e5f
Revises: d5e78f9a1b2c
Create Date: 2026-04-18 19:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6a1b2c3d4e5f"
down_revision: Union[str, None] = "d5e78f9a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "stock_analysis_runs" in inspector.get_table_names():
        return

    op.create_table(
        "stock_analysis_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ticker", sa.String(length=50), nullable=True),
        sa.Column("language", sa.String(length=10), nullable=False, server_default="ko"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="IDLE"),
        sa.Column("request_data", sa.JSON(), nullable=True),
        sa.Column("result_data", sa.JSON(), nullable=True),
        sa.Column("ui_state", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_stock_analysis_runs_id"), "stock_analysis_runs", ["id"], unique=False)
    op.create_index(op.f("ix_stock_analysis_runs_ticker"), "stock_analysis_runs", ["ticker"], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "stock_analysis_runs" not in inspector.get_table_names():
        return

    op.drop_index(op.f("ix_stock_analysis_runs_ticker"), table_name="stock_analysis_runs")
    op.drop_index(op.f("ix_stock_analysis_runs_id"), table_name="stock_analysis_runs")
    op.drop_table("stock_analysis_runs")
