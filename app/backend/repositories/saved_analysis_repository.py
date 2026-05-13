from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.backend.database.models import SavedAnalysis
from typing import Optional, Dict, Any, List

class SavedAnalysisRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        source_tab: str,
        ticker: str,
        language: str = "ko",
        request_data: Optional[Dict[str, Any]] = None,
        result_data: Optional[Dict[str, Any]] = None,
    ) -> SavedAnalysis:
        new_analysis = SavedAnalysis(
            source_tab=source_tab,
            ticker=ticker,
            language=language,
            request_data=request_data,
            result_data=result_data,
        )
        self.db.add(new_analysis)
        self.db.commit()
        self.db.refresh(new_analysis)
        return new_analysis

    def get_by_id(self, analysis_id: int) -> Optional[SavedAnalysis]:
        return self.db.query(SavedAnalysis).filter(SavedAnalysis.id == analysis_id).first()

    def _apply_filters(self, query, source_tab=None, ticker=None, created_from=None, created_to=None):
        if source_tab:
            query = query.filter(SavedAnalysis.source_tab == source_tab)
        if ticker:
            query = query.filter(func.lower(SavedAnalysis.ticker).contains(ticker.lower()))
        if created_from:
            query = query.filter(SavedAnalysis.created_at >= datetime.fromisoformat(created_from))
        if created_to:
            query = query.filter(SavedAnalysis.created_at <= datetime.fromisoformat(created_to + " 23:59:59"))
        return query

    def get_all(
        self,
        limit: int = 50,
        skip: int = 0,
        source_tab: Optional[str] = None,
        ticker: Optional[str] = None,
        created_from: Optional[str] = None,
        created_to: Optional[str] = None,
    ) -> List[SavedAnalysis]:
        q = self.db.query(SavedAnalysis).order_by(SavedAnalysis.created_at.desc())
        q = self._apply_filters(q, source_tab, ticker, created_from, created_to)
        return q.offset(skip).limit(limit).all()

    def count(
        self,
        source_tab: Optional[str] = None,
        ticker: Optional[str] = None,
        created_from: Optional[str] = None,
        created_to: Optional[str] = None,
    ) -> int:
        q = self.db.query(SavedAnalysis)
        q = self._apply_filters(q, source_tab, ticker, created_from, created_to)
        return q.count()

    def delete(self, analysis_id: int) -> None:
        item = self.db.query(SavedAnalysis).filter(SavedAnalysis.id == analysis_id).first()
        if item is None:
            return
        self.db.delete(item)
        self.db.commit()
