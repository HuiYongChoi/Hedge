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

    def get_all(self, limit: int = 50, skip: int = 0) -> List[SavedAnalysis]:
        return self.db.query(SavedAnalysis).order_by(SavedAnalysis.created_at.desc()).offset(skip).limit(limit).all()
