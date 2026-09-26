"""매수 후보 판정의 전진 검증 — 스캔 결과를 날짜별로 남기고, 그 뒤 실제 주가로 채점한다.

과거 시점으로 스캔을 다시 돌리는 백테스트는 지금의 무료 데이터로는 할 수 없다(재무 지표와
시가총액이 모두 '오늘 값'이라, 과거 판정을 미래 정보로 채점하게 된다). 대신 스캔이 끝날
때마다 그날의 판정을 기록해 두고, 1·3·6·12개월이 지나면 실제 수익률로 판정별 성과를 잰다.

· 기록 — outputs/screener_track/<기준일>.json (git 이 무시하는 폴더라 배포해도 남는다).
  같은 날 여러 번 스캔하면 종목별로 마지막 판정으로 합친다.
· 채점 — 기준일 종가 대비 N개월 뒤 종가 수익률과, 같은 기간 시장 지수(미국 SPY,
  한국 코스피 ^KS11) 수익률을 뺀 초과수익률. 판정별 평균과 '지수를 이긴 비율'을 낸다.
  주가는 과거 종가라 시점이 어긋나지 않는다.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from statistics import mean
from typing import Callable, Iterable, Optional

logger = logging.getLogger(__name__)

TRACK_DIR = Path(__file__).resolve().parents[2] / "outputs" / "screener_track"

#: 채점하는 보유 기간(이름, 달력 일수).
HORIZONS: tuple[tuple[str, int], ...] = (("1m", 30), ("3m", 91), ("6m", 182), ("12m", 365))
#: 성과를 재는 판정. 품질 미달·데이터 부족은 수가 많고 매수 판단과 무관해 뺀다.
TRACKED_VERDICTS = ("buy", "watch", "quality_expensive", "financial")
BENCHMARKS = {"US": "SPY", "KR": "^KS11"}
PRICE_CONCURRENCY = 6

_write_lock = threading.Lock()

PriceFn = Callable[[str, str, str], list]


def _snapshot_path(end_date: str, track_dir: Path) -> Path:
    return track_dir / f"{end_date}.json"


def record_scan(end_date: str, results: Iterable[dict], track_dir: Optional[Path] = None) -> int:
    """스캔 결과를 기준일 기록에 합친다. 판정이 안 된 종목(데이터 부족·오류)은 남기지 않는다."""
    track_dir = track_dir or TRACK_DIR
    rows = {
        r["ticker"]: {
            "ticker": r["ticker"],
            "name": r.get("name"),
            "market": r.get("market"),
            "verdict": r.get("verdict"),
            "gap": (r.get("value") or {}).get("gap"),
            "price_per_share": (r.get("value") or {}).get("price_per_share"),
            "sector": r.get("sector"),
            "warnings": r.get("warnings") or [],
        }
        for r in results
        if r.get("ticker") and r.get("verdict") not in (None, "insufficient") and not r.get("error")
    }
    if not rows:
        return 0
    path = _snapshot_path(end_date, track_dir)
    with _write_lock:
        track_dir.mkdir(parents=True, exist_ok=True)
        existing = {}
        if path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8")).get("results", {})
            except (OSError, ValueError) as exc:
                logger.warning("screener snapshot %s unreadable, rewriting: %s", path, exc)
        existing.update(rows)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"end_date": end_date, "results": existing}, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, path)  # 쓰는 도중 끊겨도 이전 기록이 깨지지 않게
    return len(rows)


def load_snapshots(track_dir: Optional[Path] = None) -> list[dict]:
    track_dir = track_dir or TRACK_DIR
    if not track_dir.exists():
        return []
    snapshots = []
    for path in sorted(track_dir.glob("*.json")):
        try:
            snapshots.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, ValueError) as exc:
            logger.warning("skip unreadable screener snapshot %s: %s", path, exc)
    return snapshots


def close_on_or_before(prices: list, day: date) -> Optional[float]:
    best = None
    for p in prices:
        d = str(p.time)[:10]
        if d <= day.isoformat() and (best is None or d > best[0]):
            best = (d, p.close)
    return best[1] if best else None


def _close_on_or_after(prices: list, day: date) -> Optional[float]:
    best = None
    for p in prices:
        d = str(p.time)[:10]
        if d >= day.isoformat() and (best is None or d < best[0]):
            best = (d, p.close)
    return best[1] if best else None


def forward_return(prices: list, start: date, days: int) -> Optional[float]:
    """start(이전 마지막 종가) → start+days(이후 첫 종가) 수익률."""
    begin = close_on_or_before(prices, start)
    finish = _close_on_or_after(prices, start + timedelta(days=days))
    if not begin or finish is None or begin <= 0:
        return None
    return finish / begin - 1


def evaluate(
    snapshots: list[dict],
    today: date,
    price_fn: Optional[PriceFn] = None,
) -> dict:
    """판정별·보유기간별 평균 수익률, 평균 초과수익률, 지수를 이긴 비율."""
    if price_fn is None:
        from src.tools.api import free_sources_only, get_prices

        def price_fn(ticker, start, end):
            with free_sources_only():
                return get_prices(ticker, start, end)

    dated = [s for s in snapshots if s.get("end_date")]
    first_day = min((date.fromisoformat(s["end_date"]) for s in dated), default=None)
    samples: dict[str, dict[str, list[tuple[float, float]]]] = {v: {h: [] for h, _ in HORIZONS} for v in TRACKED_VERDICTS}

    # 채점할 (기록일, 종목, 지수, 판정, 지난 기간) 을 먼저 모으고, 필요한 주가를 한꺼번에 받는다.
    jobs = []
    for snap in dated:
        start = date.fromisoformat(snap["end_date"])
        matured = [(name, days) for name, days in HORIZONS if start + timedelta(days=days) <= today]
        if not matured:
            continue
        for row in (snap.get("results") or {}).values():
            bench = BENCHMARKS.get(row.get("market") or "")
            if row.get("verdict") in TRACKED_VERDICTS and bench and row.get("ticker"):
                jobs.append((start, row["ticker"], bench, row["verdict"], matured))

    def fetch(ticker: str) -> list:
        try:
            return price_fn(ticker, (first_day - timedelta(days=10)).isoformat(), today.isoformat()) or []
        except Exception as exc:
            logger.debug("price fetch failed for %s: %s", ticker, exc)
            return []

    tickers = sorted({t for _, ticker, bench, _, _ in jobs for t in (ticker, bench)})
    # 종목이 수백 개여도 요청 한도에 걸리지 않을 만큼만 동시에 받는다.
    with ThreadPoolExecutor(max_workers=PRICE_CONCURRENCY) as pool:
        prices = dict(zip(tickers, pool.map(fetch, tickers)))

    for start, ticker, bench, verdict, matured in jobs:
        for name, days in matured:
            ret = forward_return(prices[ticker], start, days)
            bench_ret = forward_return(prices[bench], start, days)
            if ret is None or bench_ret is None:
                continue
            samples[verdict][name].append((ret, ret - bench_ret))

    summary = {
        verdict: {
            name: {
                "n": len(values),
                "avg_return": mean(r for r, _ in values) if values else None,
                "avg_excess": mean(x for _, x in values) if values else None,
                "beat_rate": sum(1 for _, x in values if x > 0) / len(values) if values else None,
            }
            for name, values in by_horizon.items()
        }
        for verdict, by_horizon in samples.items()
    }
    next_maturity = None
    if first_day:
        pending = [
            date.fromisoformat(s["end_date"]) + timedelta(days=HORIZONS[0][1])
            for s in dated
            if date.fromisoformat(s["end_date"]) + timedelta(days=HORIZONS[0][1]) > today
        ]
        next_maturity = min(pending).isoformat() if pending else None
    return {
        "as_of": today.isoformat(),
        "first_snapshot": first_day.isoformat() if first_day else None,
        "snapshots": len(dated),
        "next_maturity": next_maturity,
        "horizons": [name for name, _ in HORIZONS],
        "benchmarks": BENCHMARKS,
        "summary": summary,
    }
