"""매수 후보 스캔 — 대형주를 계산만으로 훑어 종목별 판정을 흘려보낸다(SSE)."""

import asyncio
import json
import logging
from collections import Counter
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backend.database import get_db
from app.backend.services.api_key_service import ApiKeyService
from src.screener.quality_buy import BUY_GAP, WATCH_GAP, classify, scan_ticker
from src.screener.full_universe import UniverseFetchError, full_universe
from src.screener.universe import universe_for
from src.screener import point_in_time, track_record

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/screener", tags=["screener"])

#: 동시에 스캔할 종목 수. 종목마다 재무 데이터를 여러 번 조회하므로, 너무 높이면
#: 데이터 제공처의 요청 한도에 걸린다.
SCAN_CONCURRENCY = 4
#: 조용한 구간에도 연결을 살려 둔다(프록시 읽기 시간 제한 60초보다 짧게).
HEARTBEAT_SECONDS = 15.0

#: 같은 날 다시 스캔하면 바로 돌려준다. 재무제표는 하루 안에 바뀌지 않는다.
#: 기준일이 바뀌면 이전 날짜 결과는 버린다.
_day_cache: dict[str, dict[str, dict]] = {}
#: 성과 채점·과거 검증은 주가를 많이 받아 느리다 — 하루 동안 결과를 기억한다.
_track_cache: dict[str, dict] = {}
_history_cache: dict[str, dict] = {}


#: 대형주 고정 목록(ALL·KR·US)과, 스캔 시점 구성 종목을 받아 오는 지수 전체(SP500·KOSPI).
Market = Literal["ALL", "KR", "US", "SP500", "KOSPI"]
FULL_INDICES = ("SP500", "KOSPI")


class ScreenerScanRequest(BaseModel):
    market: Market = "ALL"
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


async def _resolve_universe(market: str) -> list:
    if market.upper() not in FULL_INDICES:
        return universe_for(market)
    try:
        # 지수 구성 종목은 외부 사이트에서 받아 온다(블로킹 요청이라 스레드에서).
        return await asyncio.to_thread(full_universe, market)
    except UniverseFetchError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/universe")
async def get_universe(market: str = "ALL"):
    """스캔 대상 종목 목록과 매수 문턱."""
    return {"universe": await _resolve_universe(market), "buy_gap": BUY_GAP, "watch_gap": WATCH_GAP}


@router.post("/scan")
async def scan(request_data: ScreenerScanRequest, request: Request, db: Session = Depends(get_db)):
    """대상 종목을 동시에 스캔하며, 끝나는 순서대로 판정을 보낸다."""
    api_keys = request_data.api_keys or ApiKeyService(db).get_api_keys_dict()
    end_date = request_data.end_date or date.today().isoformat()
    entries = await _resolve_universe(request_data.market)

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
        collected: list[dict] = []
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
                    collected.append(result)
                    yield _sse("result", result)
                if not done:
                    yield ": keepalive\n\n"
            # 끝까지 돈 스캔만 전진 검증 기록에 남긴다(중간에 끊긴 스캔은 표본이 치우친다).
            try:
                await asyncio.to_thread(track_record.record_scan, end_date, collected)
                _track_cache.clear()
            except Exception as exc:  # 기록 실패가 스캔 결과 전달을 막으면 안 된다
                logger.warning("screener track record failed: %s", exc)
            yield _sse("complete", {"total": len(entries), "counts": dict(counts)})
        finally:
            # 연결이 끊기면 남은 종목은 기다리지 않는다(이미 도는 조회는 끝까지 간다).
            for task in pending:
                task.cancel()

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/track-record")
async def get_track_record():
    """전진 검증 — 지난 스캔의 판정별 1·3·6·12개월 수익률과 지수 대비 초과수익률."""
    today = date.today().isoformat()
    if today not in _track_cache:
        snapshots = await asyncio.to_thread(track_record.load_snapshots)
        _track_cache.clear()
        _track_cache[today] = await asyncio.to_thread(track_record.evaluate, snapshots, date.today())
    return _track_cache[today]


@router.get("/history-check")
async def history_check(ticker: str, market: Literal["KR", "US"], industry: Optional[str] = None):
    """종목 하나의 과거 시점 검증 — 그때 공개된 재무제표와 그날 주가로 판정을 다시 내 본다."""
    today = date.today()
    key = f"{today.isoformat()}:{market}:{ticker}"
    if key not in _history_cache:
        for stale in [k for k in _history_cache if not k.startswith(today.isoformat())]:
            del _history_cache[stale]
        _history_cache[key] = await asyncio.to_thread(
            point_in_time.check_history, ticker, market, today, industry=industry,
        )
    return _history_cache[key]
