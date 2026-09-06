from fastapi import APIRouter, HTTPException
from src.tools.analyst_target_api import fetch_analyst_target, BrokerTarget, TargetDistribution
from src.tools.broker_reports import (
    BrokerReport,
    BrokerReportDetail,
    fetch_broker_report_detail,
    fetch_broker_reports,
    is_supported_ticker,
)

router = APIRouter(prefix="/analyst-targets", tags=["analyst-targets"])


def _broker_to_dict(b: BrokerTarget) -> dict:
    return {
        "name": b.name,
        "target_price": b.target_price,
        "signal": b.signal,
        "published_date": b.published_date,
        "days_ago": b.days_ago,
    }


def _report_to_dict(r: BrokerReport) -> dict:
    return {
        "id": r.id,
        "broker": r.broker,
        "broker_key": r.broker_key,
        "title": r.title,
        "published_date": r.published_date,
        "detail_url": r.detail_url,
        "pdf_url": r.pdf_url,
    }


def _report_detail_to_dict(d: BrokerReportDetail) -> dict:
    return {
        "id": d.id,
        "broker": d.broker,
        "title": d.title,
        "published_date": d.published_date,
        "target_price": d.target_price,
        "opinion": d.opinion,
        "signal": d.signal,
        "body": d.body,
        "detail_url": d.detail_url,
        "pdf_url": d.pdf_url,
        "views": d.views,
        "source": d.source,
    }


def _validate_ticker(ticker: str) -> str:
    ticker_clean = ticker.strip().upper()
    if not ticker_clean or len(ticker_clean) > 10:
        raise HTTPException(status_code=400, detail="invalid ticker")
    return ticker_clean


def _distribution_to_dict(d: TargetDistribution) -> dict:
    return {
        "buy": d.buy,
        "hold": d.hold,
        "neutral": d.neutral,
        "sell": d.sell,
        "total": d.total,
        "average": d.average,
        "median": d.median,
        "stdev": d.stdev,
    }


@router.get("/{ticker}")
async def get_analyst_target(ticker: str, refresh: bool = False):
    ticker_clean = _validate_ticker(ticker)
    result = fetch_analyst_target(ticker_clean, force_refresh=refresh)
    return {
        "ticker": ticker_clean,
        "company_name": result.company_name,
        "consensus": result.consensus,
        "high": result.high,
        "low": result.low,
        "median": result.median,
        "analyst_count": result.analyst_count,
        "current_price": result.current_price,
        "trailing_pe": result.trailing_pe,
        "trailing_eps": result.trailing_eps,
        "forward_eps": result.forward_eps,
        "forward_pe": result.forward_pe,
        "current_fy_eps": result.current_fy_eps,
        "currency": result.currency,
        "market_session": result.market_session,
        "extended_price": result.extended_price,
        "extended_change_percent": result.extended_change_percent,
        "extended_session": result.extended_session,
        "forward_ev": result.forward_ev,
        "beta": result.beta,
        "sigma_annual": result.sigma_annual,
        "brokers": [_broker_to_dict(b) for b in result.brokers],
        "distribution": _distribution_to_dict(result.distribution) if result.distribution else None,
        "source": result.source,
    }


@router.get("/{ticker}/reports")
async def get_broker_reports(ticker: str, refresh: bool = False):
    """증권사별 종목분석 리포트 목록.

    Price Compass 카드에서 증권사 이름으로 매칭하므로 정규화 키(broker_key)를
    함께 내려준다. 한국 종목이 아니면 supported=False로 빈 목록.
    """
    ticker_clean = _validate_ticker(ticker)
    index = fetch_broker_reports(ticker_clean, force_refresh=refresh)
    return {
        "ticker": ticker_clean,
        "supported": is_supported_ticker(ticker_clean),
        "item_code": index.item_code,
        "list_url": index.list_url,
        "source": index.source,
        "reports": [_report_to_dict(r) for r in index.reports],
    }


@router.get("/{ticker}/reports/{report_id}")
async def get_broker_report_detail(ticker: str, report_id: str, refresh: bool = False):
    """리포트 본문 (목표가·투자의견·요약 문단·원문 PDF 링크)."""
    ticker_clean = _validate_ticker(ticker)
    detail = fetch_broker_report_detail(ticker_clean, report_id, force_refresh=refresh)
    if detail is None:
        raise HTTPException(status_code=404, detail="report not found")
    return _report_detail_to_dict(detail)
