"""매수 후보 스캔 — 대형주를 계산만으로 훑어 종목별 판정을 흘려보낸다(SSE)."""

import asyncio
import json
import logging
from collections import Counter, OrderedDict
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.backend.database import SessionLocal, get_db
from app.backend.repositories.saved_analysis_repository import SavedAnalysisRepository
from app.backend.services.api_key_service import ApiKeyService
from src.screener.quality_buy import BUY_GAP, WATCH_GAP, classify, scan_ticker
from src.screener.full_universe import UniverseFetchError, full_universe
from src.screener.universe import universe_for
from src.screener import point_in_time, snapshot_store, track_record

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
#: 종목별 1년 주가(주봉). 결과 행에 마우스를 올릴 때마다 받으면 느리다 — 하루 동안 기억한다.
_chart_cache: "OrderedDict[str, dict]" = OrderedDict()
CHART_CACHE_SIZE = 600
#: 차트 기간 — 약 1년(53주).
CHART_DAYS = 371


#: 대형주 고정 목록(ALL·KR·US)과, 스캔 시점 구성 종목을 받아 오는 지수 전체(SP500·KOSPI).
Market = Literal["ALL", "KR", "US", "SP500", "KOSPI"]
FULL_INDICES = ("SP500", "KOSPI")


class ScreenerScanRequest(BaseModel):
    market: Market = "ALL"
    end_date: Optional[str] = None
    refresh: bool = False
    api_keys: Optional[dict[str, str]] = None
    #: 아카이브에 남길 이름의 언어
    language: Literal["ko", "en"] = "ko"


#: 아카이브 이름에 쓰는 시장 이름
MARKET_LABELS = {
    "ALL": ("대형주 전체", "Large caps"),
    "KR": ("한국 대형주", "Korea large caps"),
    "US": ("미국 대형주", "US large caps"),
    "SP500": ("S&P 500 전체", "All S&P 500"),
    "KOSPI": ("코스피 전체", "All KOSPI"),
}


def _archive_name(market: str, language: str, scanned: int, total: int, complete: bool) -> str:
    ko, en = MARKET_LABELS.get(market, (market, market))
    if language == "ko":
        state = "" if complete else " · 중단"
        return f"매수 후보 · {ko} · {scanned}/{total}종목{state}"
    state = "" if complete else " · stopped"
    return f"Buy candidates · {en} · {scanned}/{total}{state}"


def _archive_scan(
    market: str,
    end_date: str,
    language: str,
    total: int,
    results: list[dict],
    complete: bool,
) -> Optional[int]:
    """스캔 결과를 '저장 분석' 아카이브에 남긴다 — 중간에 끊겨도 그때까지 받은 결과를 남긴다."""
    counts = Counter(r.get("verdict") for r in results)
    db = SessionLocal()
    try:
        saved = SavedAnalysisRepository(db).create(
            source_tab="quality_buy",
            ticker=market,
            language=language,
            request_data={"market": market, "end_date": end_date},
            result_data={
                "market": market,
                "end_date": end_date,
                "total": total,
                "scanned": len(results),
                "complete": complete,
                "buy_gap": BUY_GAP,
                "watch_gap": WATCH_GAP,
                "counts": dict(counts),
                "results": results,
            },
            display_name=_archive_name(market, language, len(results), total, complete),
        )
        return saved.id
    finally:
        db.close()


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False, default=str)}\n\n"


def _cached(end_date: str, ticker: str) -> Optional[dict]:
    return _day_cache.get(end_date, {}).get(ticker)


def _reprice(entry: dict, end_date: str) -> Optional[dict]:
    from src.screener.quality_buy import release_ticker_caches

    with release_ticker_caches(entry["ticker"]):
        return snapshot_store.reprice(entry, end_date)


def _save_snapshot(snapshot: dict) -> None:
    from src.screener.quality_buy import release_ticker_caches

    with release_ticker_caches(snapshot["ticker"]):
        snapshot_store.save_with_base_close(snapshot)


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
                # 재무 스냅샷이 살아 있으면 오늘 종가만 받아 판정한다(재무를 다시 받지 않는다).
                # '새로 계산'은 스냅샷을 건너뛰고 전체 계산을 한다.
                if not request_data.refresh:
                    try:
                        repriced = await asyncio.to_thread(_reprice, entry, end_date)
                    except Exception as exc:  # 스냅샷 문제는 전체 계산으로 넘어가면 된다
                        logger.debug("snapshot reprice failed for %s: %s", entry["ticker"], exc)
                        repriced = None
                    if repriced:
                        _remember(end_date, repriced)
                        return {**repriced, "repriced": True}
                try:
                    result = await asyncio.to_thread(scan_ticker, entry, end_date, api_keys)
                except Exception as exc:  # 한 종목의 예외가 스트림 전체를 끊으면 안 된다
                    result = {**entry, **classify(None, None), "error": str(exc)}
                snapshot = result.pop("_snapshot", None)
                if snapshot:
                    try:
                        await asyncio.to_thread(_save_snapshot, snapshot)
                    except Exception as exc:  # 저장 실패가 결과 전달을 막으면 안 된다
                        logger.warning("snapshot save failed for %s: %s", entry["ticker"], exc)
            _remember(end_date, result)
            return result

        yield _sse("start", {"total": len(entries), "end_date": end_date, "buy_gap": BUY_GAP, "watch_gap": WATCH_GAP})
        pending = {asyncio.create_task(scan_one(entry)) for entry in entries}
        counts: Counter[str] = Counter()
        collected: list[dict] = []
        archived = False

        def archive(complete: bool) -> Optional[int]:
            # 한 스캔은 한 번만 남긴다. 받은 결과가 없으면 남길 것도 없다.
            nonlocal archived
            if archived or not collected:
                return None
            archived = True
            try:
                return _archive_scan(
                    request_data.market, end_date, request_data.language, len(entries), list(collected), complete,
                )
            except Exception as exc:  # 저장 실패가 스캔 결과 전달을 막으면 안 된다
                logger.warning("screener archive failed: %s", exc)
                return None

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
            archive_id = await asyncio.to_thread(archive, True)
            if archive_id is not None:
                yield _sse("archived", {"id": archive_id, "scanned": len(collected), "complete": True})
            yield _sse("complete", {"total": len(entries), "counts": dict(counts)})
        finally:
            # 연결이 끊기면 남은 종목은 기다리지 않는다(이미 도는 조회는 끝까지 간다).
            for task in pending:
                task.cancel()
            # 중단·연결 끊김·오류로 끝나도 그때까지 받은 결과는 아카이브에 남긴다.
            archive(False)

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


def weekly_closes(prices: list, start: date) -> list[dict]:
    """일봉을 주봉 종가(그 주 마지막 거래일)로 줄인다."""
    weeks: "OrderedDict[tuple[int, int], dict]" = OrderedDict()
    for p in sorted(prices, key=lambda p: str(p.time)):
        day_text = str(p.time)[:10]
        try:
            day = date.fromisoformat(day_text)
        except ValueError:
            continue
        if day < start or p.close is None:
            continue
        iso = day.isocalendar()
        weeks[(iso[0], iso[1])] = {"date": day_text, "close": float(p.close)}
    return list(weeks.values())


def _load_chart(ticker: str, today: date) -> dict:
    from src.tools.api import free_sources_only, get_prices

    start = today - timedelta(days=CHART_DAYS)
    # 스캐너와 같이 무료 소스만 쓴다(유료 Financial Datasets 를 부르지 않는다).
    with free_sources_only():
        prices = get_prices(ticker, (start - timedelta(days=7)).isoformat(), today.isoformat()) or []
    rows = weekly_closes(prices, start)
    return {"ticker": ticker, "interval": "weekly", "rows": rows}


@router.get("/price-chart")
async def price_chart(ticker: str):
    """종목 하나의 최근 1년 주봉 종가 — 결과 행의 차트 아이콘에 마우스를 올리면 보여 준다."""
    today = date.today()
    key = f"{today.isoformat()}:{ticker.upper()}"
    if key in _chart_cache:
        _chart_cache.move_to_end(key)
        return _chart_cache[key]
    try:
        chart = await asyncio.to_thread(_load_chart, ticker, today)
    except Exception as exc:  # 주가를 못 받으면 빈 차트 — 화면은 '불러오지 못함'을 보여 준다
        logger.debug("price chart failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "interval": "weekly", "rows": []}
    # 빈 결과는 일시적일 수 있으니 기억하지 않는다.
    if chart["rows"]:
        _chart_cache[key] = chart
        while len(_chart_cache) > CHART_CACHE_SIZE:
            _chart_cache.popitem(last=False)
    return chart


#: 네이버 해외주식 주소는 거래소 접미사가 붙은 코드(나스닥 AAPL.O, 뉴욕 KO, 클래스주 BRKb)를 쓴다.
#: 티커만으로는 알 수 없어 네이버 자동완성에 물어본다.
_NAVER_AC_URL = "https://ac.stock.naver.com/ac"
_naver_url_cache: "OrderedDict[str, str]" = OrderedDict()


def naver_world_url(ticker: str, fetch_json=None) -> Optional[str]:
    """미국 티커 → 네이버 증권 해외주식 페이지 주소. 찾지 못하면 None."""
    query = ticker.upper().replace("-", " ").replace(".", " ").strip()
    if fetch_json is None:
        import requests

        def fetch_json(q):
            response = requests.get(
                _NAVER_AC_URL, params={"q": q, "target": "stock"}, timeout=5,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            response.raise_for_status()
            return response.json()

    for item in (fetch_json(query) or {}).get("items") or []:
        if item.get("nationCode") == "USA" and str(item.get("code", "")).upper() == query and item.get("url"):
            return f"https://stock.naver.com{item['url']}"
    return None


@router.get("/naver-link")
async def naver_link(ticker: str):
    """미국 종목의 네이버 증권 주소 — 결과 행의 '바로가기'를 펼칠 때 부른다."""
    key = ticker.upper()
    if key not in _naver_url_cache:
        try:
            url = await asyncio.to_thread(naver_world_url, ticker)
        except Exception as exc:
            logger.debug("naver link lookup failed for %s: %s", ticker, exc)
            url = None
        if not url:
            return {"ticker": ticker, "url": None}
        _naver_url_cache[key] = url
        while len(_naver_url_cache) > CHART_CACHE_SIZE:
            _naver_url_cache.popitem(last=False)
    return {"ticker": ticker, "url": _naver_url_cache[key]}
