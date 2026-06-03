from datetime import datetime
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.backend.database.models import SavedAnalysis
from typing import Optional, Dict, Any, List


def _first_text(*values: Any) -> Optional[str]:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_company_name(ticker: str, request_data: Optional[Dict[str, Any]], result_data: Optional[Dict[str, Any]]) -> str:
    request_data = request_data or {}
    result_data = result_data or {}
    ticker_key = ticker.upper()

    direct = _first_text(
        result_data.get("saved_display_name"),
        result_data.get("display_name"),
        result_data.get("company_name"),
        result_data.get("companyName"),
        request_data.get("display_name"),
        request_data.get("company_name"),
        request_data.get("companyName"),
    )
    if direct:
        return direct

    for agent_result in result_data.get("agent_results") or []:
        if not isinstance(agent_result, dict):
            continue
        report = agent_result.get("report") or agent_result.get("analysis") or {}
        if isinstance(report, dict):
            by_ticker = report.get(ticker) or report.get(ticker_key)
            if isinstance(by_ticker, dict):
                name = _first_text(by_ticker.get("company_name"), by_ticker.get("companyName"), by_ticker.get("name"))
                if name:
                    return name

    complete_result = result_data.get("complete_result") or {}
    analyst_signals = complete_result.get("analyst_signals") or {}
    if isinstance(analyst_signals, dict):
        for report in analyst_signals.values():
            if not isinstance(report, dict):
                continue
            by_ticker = report.get(ticker) or report.get(ticker_key)
            if isinstance(by_ticker, dict):
                name = _first_text(by_ticker.get("company_name"), by_ticker.get("companyName"), by_ticker.get("name"))
                if name:
                    return name

    return ticker


def build_saved_display_name(
    ticker: str,
    created_at: Optional[datetime],
    request_data: Optional[Dict[str, Any]],
    result_data: Optional[Dict[str, Any]],
    display_name: Optional[str] = None,
) -> str:
    result_data = result_data or {}
    existing = _first_text(result_data.get("saved_display_name"))
    if existing:
        return existing

    date_prefix = (created_at or datetime.now()).strftime("%Y-%m-%d")
    base_name = _first_text(display_name) or _extract_company_name(ticker, request_data, result_data)

    if base_name.startswith(date_prefix):
        return base_name
    return f"{date_prefix} {base_name}"

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
        display_name: Optional[str] = None,
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

        patched_result_data = dict(new_analysis.result_data or {})
        patched_result_data["saved_display_name"] = build_saved_display_name(
            ticker=ticker,
            created_at=new_analysis.created_at,
            request_data=request_data,
            result_data=patched_result_data,
            display_name=display_name,
        )
        new_analysis.result_data = patched_result_data
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

    def update_display_name(self, analysis_id: int, display_name: str) -> Optional[SavedAnalysis]:
        item = self.db.query(SavedAnalysis).filter(SavedAnalysis.id == analysis_id).first()
        if item is None:
            return None
        patched_result_data = dict(item.result_data or {})
        patched_result_data["saved_display_name"] = display_name.strip()
        item.result_data = patched_result_data
        self.db.commit()
        self.db.refresh(item)
        return item
