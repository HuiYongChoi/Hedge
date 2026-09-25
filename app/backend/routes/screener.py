"""매수 후보 스캔 — 대형주를 계산만으로 훑어 종목별 판정을 흘려보낸다(SSE)."""

import asyncio
import json
from collections import Counter
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backend.database import get_db
from app.backend.services.api_key_service import ApiKeyService
from src.screener.quality_buy import BUY_GAP, WATCH_GAP, classify, scan_ticker
from src.screener.universe import universe_for

router = APIRouter(prefix="/screener", tags=["screener"])

#: 동시에 스캔할 종목 수. 종목마다 재무 데이터를 여러 번 조회하므로, 너무 높이면
#: 데이터 제공처의 요청 한도에 걸린다.
SCAN_CONCURRENCY = 4
#: 조용한 구간에도 연결을 살려 둔다(프록시 읽기 시간 제한 60초보다 짧게).
HEARTBEAT_SECONDS = 15.0

#: 같은 날 다시 스캔하면 바로 돌려준다. 재무제표는 하루 안에 바뀌지 않는다.
#: 기준일이 바뀌면 이전 날짜 결과는 버린다.
_day_cache: dict[str, dict[str, dict]] = {}


class ScreenerScanRequest(BaseModel):
    market: Literal["ALL", "KR", "US"] = "ALL"
    end_date: Optional[str] = None
    refresh: bool = False
    api_keys: Optional[dict[str, str]] = None


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _cached(end_date: str, ticker: str) -> Optional[dict]:
    return _day_cache.get(end_date, {}).get(ticker)


def _remember(end_date: str, result: dict) -> None:
    # 데이터 부족·오류는 일시적일 수 있으니 기억하지 않는다 — 다음 스캔에서 다시 시도한다.
    if result.get("error") or result.get("verdict") == "insufficient":
        return
    for stale in [d for d in _day_cache if d != end_date]:
        del _day_cache[stale]
    _day_cache.setdefault(end_date, {})[result["ticker"]] = result


@router.get("/universe")
async def get_universe(market: str = "ALL"):
    """스캔 대상 종목 목록과 매수 문턱."""
    return {"universe": universe_for(market), "buy_gap": BUY_GAP, "watch_gap": WATCH_GAP}


@router.post("/scan")
async def scan(request_data: ScreenerScanRequest, request: Request, db: Session = Depends(get_db)):
    """대상 종목을 동시에 스캔하며, 끝나는 순서대로 판정을 보낸다."""
    api_keys = request_data.api_keys or ApiKeyService(db).get_api_keys_dict()
    end_date = request_data.end_date or date.today().isoformat()
    entries = universe_for(request_data.market)

    async def event_generator():
        semaphore = asyncio.Semaphore(SCAN_CONCURRENCY)

        async def scan_one(entry):
            if not request_data.refresh:
                hit = _cached(end_date, entry["ticker"])
                if hit:
                    return {**hit, "cached": True}
            async with semaphore:
                try:
                    result = await asyncio.to_thread(scan_ticker, entry, end_date, api_keys)
                except Exception as exc:  # 한 종목의 예외가 스트림 전체를 끊으면 안 된다
                    result = {**entry, **classify(None, None), "error": str(exc)}
            _remember(end_date, result)
            return result

        yield _sse("start", {"total": len(entries), "end_date": end_date, "buy_gap": BUY_GAP, "watch_gap": WATCH_GAP})
        pending = {asyncio.create_task(scan_one(entry)) for entry in entries}
        counts: Counter[str] = Counter()
        try:
            while pending:
                done, pending = await asyncio.wait(
                    pending, timeout=HEARTBEAT_SECONDS, return_when=asyncio.FIRST_COMPLETED,
                )
                if await request.is_disconnected():
                    return
                for task in done:
                    result = task.result()
                    counts[result["verdict"]] += 1
                    yield _sse("result", result)
                if not done:
                    yield ": keepalive\n\n"
            yield _sse("complete", {"total": len(entries), "counts": dict(counts)})
        finally:
            # 연결이 끊기면 남은 종목은 기다리지 않는다(이미 도는 조회는 끝까지 간다).
            for task in pending:
                task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")
