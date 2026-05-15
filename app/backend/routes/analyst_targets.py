from fastapi import APIRouter, HTTPException
from src.tools.analyst_target_api import fetch_analyst_target, BrokerTarget, TargetDistribution

router = APIRouter(prefix="/analyst-targets", tags=["analyst-targets"])


def _broker_to_dict(b: BrokerTarget) -> dict:
    return {
        "name": b.name,
        "target_price": b.target_price,
        "signal": b.signal,
        "published_date": b.published_date,
        "days_ago": b.days_ago,
    }


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
    ticker_clean = ticker.strip().upper()
    if not ticker_clean or len(ticker_clean) > 10:
        raise HTTPException(status_code=400, detail="invalid ticker")
    result = fetch_analyst_target(ticker_clean, force_refresh=refresh)
    return {
        "ticker": ticker_clean,
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
        "beta": result.beta,
        "sigma_annual": result.sigma_annual,
        "brokers": [_broker_to_dict(b) for b in result.brokers],
        "distribution": _distribution_to_dict(result.distribution) if result.distribution else None,
        "source": result.source,
    }
