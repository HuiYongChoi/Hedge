from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from app.backend.database.models import StockAnalysisRun
from app.backend.models.schemas import FlowRunStatus


class StockAnalysisRunRepository:
    """Repository for standalone Stock Analysis run snapshots"""

    def __init__(self, db: Session):
        self.db = db

    def create_run(
        self,
        ticker: Optional[str] = None,
        language: str = "ko",
        status: FlowRunStatus = FlowRunStatus.IDLE,
        request_data: Optional[Dict[str, Any]] = None,
        result_data: Optional[Dict[str, Any]] = None,
        ui_state: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> StockAnalysisRun:
        run = StockAnalysisRun(
            ticker=ticker,
            language=language,
            status=status.value,
            request_data=request_data,
            result_data=result_data,
            ui_state=ui_state,
            error_message=error_message,
        )
        self.db.add(run)
        self.db.commit()
        self.db.refresh(run)
        return run

    def get_run_by_id(self, run_id: int) -> Optional[StockAnalysisRun]:
        return self.db.query(StockAnalysisRun).filter(StockAnalysisRun.id == run_id).first()

    def get_latest_run(self) -> Optional[StockAnalysisRun]:
        return (
            self.db.query(StockAnalysisRun)
            .order_by(desc(func.coalesce(StockAnalysisRun.updated_at, StockAnalysisRun.created_at)), desc(StockAnalysisRun.id))
            .first()
        )

    def update_run(
        self,
        run_id: int,
        ticker: Optional[str] = None,
        language: Optional[str] = None,
        status: Optional[FlowRunStatus] = None,
        request_data: Optional[Dict[str, Any]] = None,
        result_data: Optional[Dict[str, Any]] = None,
        ui_state: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None,
    ) -> Optional[StockAnalysisRun]:
        run = self.get_run_by_id(run_id)
        if not run:
            return None

        if ticker is not None:
            run.ticker = ticker
        if language is not None:
            run.language = language
        if status is not None:
            run.status = status.value
        if request_data is not None:
            run.request_data = request_data
        if result_data is not None:
            run.result_data = result_data
        if ui_state is not None:
            run.ui_state = ui_state
        if error_message is not None:
            run.error_message = error_message

        run.updated_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(run)
        return run
