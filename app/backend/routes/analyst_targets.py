from fastapi import APIRouter, HTTPException
from src.tools.analyst_target_api import fetch_analyst_target

router = APIRouter(prefix="/analyst-targets", tags=["analyst-targets"])


@router.get("/{ticker}")
async def get_analyst_target(ticker: str):
    ticker_clean = ticker.strip().upper()
    if not ticker_clean or len(ticker_clean) > 10:
        raise HTTPException(status_code=400, detail="invalid ticker")
    result = fetch_analyst_target(ticker_clean)
    return {
        "ticker": ticker_clean,
        "consensus": result.consensus,
        "high": result.high,
        "low": result.low,
        "median": result.median,
        "analyst_count": result.analyst_count,
        "current_price": result.current_price,
        "source": result.source,
    }
