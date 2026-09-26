"""매수 후보 스캔의 재무 스냅샷 — 재무는 오래 기억하고, 매일은 주가만 다시 계산한다.

스캔이 느린 이유는 종목마다 재무제표를 새로 받아 두 에이전트를 돌리기 때문이다. 그런데
판정의 두 축 중 '우량한가'(수익성·성장·재무건전성)는 재무제표로만 정해지고, 재무제표는
분기에 한 번 바뀐다. 매일 바뀌는 것은 '지금 싼가'의 분모인 시가총액뿐이다.

그래서 전체 계산을 한 번 하면 다음을 파일로 남긴다.
  · 펀더멘털 에이전트의 세 항목 신호(판정에 쓰는 부분만)
  · 가치평가 모델별 적정가 총액과 가중치, 주식 수
  · 그때의 시가총액과 같은 날 종가
다음 스캔에서는 오늘 종가 하나만 받아 시가총액을 종가 비율로 옮기고, 가치평가 에이전트와
똑같은 방식(모델별 괴리 → 또래 이상치 제외 → 가중평균)으로 괴리율을 다시 낸다. 그때와 같은
주가를 넣으면 전체 계산과 같은 값이 나온다.

스냅샷은 14~28일(종목마다 다르게 흩어 둔다) 지나면 버리고 전체 계산을 다시 한다 — 새 분기
실적이 그 안에 반영된다. 한꺼번에 만료되어 어느 날 스캔이 다시 느려지지 않도록 만료일을 흩는다.
'새로 계산'은 스냅샷을 쓰지 않는다.

파일은 outputs/screener_snapshots/ 에 둔다(git 무시 폴더라 배포해도 유지된다).
"""

from __future__ import annotations

import json
import logging
import os
import re
import zlib
from datetime import date, timedelta
from pathlib import Path
from typing import Callable, Optional

from src.screener.quality_buy import QUALITY_AXES, blend, classify

logger = logging.getLogger(__name__)

SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "outputs" / "screener_snapshots"
#: 3 — SEC 태그 병합 수정(src/tools/api.py _sec_fact_candidates) 전에 만든 스냅샷은 낡은 재무일 수 있어 버린다.
VERSION = 3
#: 스냅샷 유효 기간(일). 종목마다 MIN~MIN+SPREAD-1 사이로 흩는다.
MIN_AGE_DAYS = 14
AGE_SPREAD_DAYS = 15
#: 기준 종가를 찾을 때 거슬러 올라가는 날 수(휴장일·연휴).
PRICE_LOOKBACK_DAYS = 10

PriceFn = Callable[[str, str, str], list]


def _default_price_fn(ticker: str, start: str, end: str) -> list:
    from src.tools.api import free_sources_only, get_prices

    with free_sources_only():
        return get_prices(ticker, start, end) or []


def max_age_days(ticker: str) -> int:
    return MIN_AGE_DAYS + zlib.crc32(ticker.upper().encode()) % AGE_SPREAD_DAYS


def _path(ticker: str, snapshot_dir: Optional[Path]) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", ticker.upper())
    return (snapshot_dir or SNAPSHOT_DIR) / f"{safe}.json"


def close_on_or_before(prices: list, day: str) -> Optional[tuple[str, float]]:
    """그날(휴장이면 그 전 거래일) 종가."""
    best: Optional[tuple[str, float]] = None
    for p in prices:
        when = str(getattr(p, "time", "") or "")[:10]
        close = getattr(p, "close", None)
        if not when or when > day or close is None or close <= 0:
            continue
        if best is None or when > best[0]:
            best = (when, float(close))
    return best


def _latest_close(ticker: str, day: str, price_fn: PriceFn) -> Optional[tuple[str, float]]:
    start = (date.fromisoformat(day) - timedelta(days=PRICE_LOOKBACK_DAYS)).isoformat()
    try:
        return close_on_or_before(price_fn(ticker, start, day), day)
    except Exception as exc:
        logger.debug("snapshot price fetch failed for %s: %s", ticker, exc)
        return None


def _models_from_valuation(valuation: Optional[dict]) -> Optional[dict]:
    """가치평가 에이전트가 괴리율을 낼 때 쓴 합산 입력(모델별 적정가 총액·가중치, 시가총액, 주식 수).

    설명용 *_analysis 블록은 모델이 아닌 것(rim_analysis)도 있고 뒤에서 덮이기도 해서(pbr_band_analysis)
    읽지 않는다 — 에이전트가 따로 남긴 blend_inputs 만 쓴다.
    """
    inputs = ((valuation or {}).get("reasoning") or {}).get("blend_inputs") or {}
    market_cap = inputs.get("market_cap")
    models = {
        name: {"value": float(m["value"]), "weight": float(m["weight"])}
        for name, m in (inputs.get("models") or {}).items()
        if isinstance(m, dict) and isinstance(m.get("value"), (int, float)) and m["value"] > 0
        and isinstance(m.get("weight"), (int, float))
    }
    if not models or not isinstance(market_cap, (int, float)) or market_cap <= 0:
        return None
    shares = inputs.get("shares")
    return {"models": models, "market_cap": float(market_cap), "shares": float(shares) if shares else None}


def build_snapshot(
    entry: dict,
    end_date: str,
    result: dict,
    fundamentals: Optional[dict],
    valuation: Optional[dict],
    financial: bool,
) -> Optional[dict]:
    """전체 계산 한 번의 결과로 스냅샷을 만든다. 재무 판정이 안 된 종목은 남기지 않는다."""
    if not fundamentals or result.get("error") or result.get("verdict") == "insufficient":
        return None
    models = _models_from_valuation(valuation)
    quality = classify(fundamentals, None)["quality"] or {}
    if (quality.get("passed") or financial) and models is None:
        # 가치평가가 필요한 종목인데 실패했다면 일시적일 수 있다 — 기억하지 않고 다음에 다시 계산한다.
        return None
    reasoning = fundamentals.get("reasoning") or {}
    return {
        "version": VERSION,
        "ticker": entry["ticker"],
        "name": entry.get("name"),
        "market": entry.get("market"),
        "sector": result.get("sector"),
        "industry": result.get("industry"),
        "financial": financial,
        "scanned_on": end_date,
        # 판정에 쓰는 세 항목만 남긴다(에이전트 결과 전체는 크다).
        "fundamentals": {"reasoning": {key: reasoning.get(key) for key in QUALITY_AXES.values() if reasoning.get(key)}},
        "valuation": models,
    }


def save(snapshot: dict, base_close: Optional[tuple[str, float]], snapshot_dir: Optional[Path] = None) -> None:
    """스냅샷을 파일에 쓴다. 가치평가가 있는데 기준 종가를 못 받으면 주가 재계산이 안 되니 남기지 않는다."""
    if snapshot.get("valuation") and not base_close:
        return
    data = {**snapshot, "base_close": list(base_close) if base_close else None}
    path = _path(snapshot["ticker"], snapshot_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def save_with_base_close(snapshot: dict, price_fn: Optional[PriceFn] = None, snapshot_dir: Optional[Path] = None) -> None:
    base_close = None
    if snapshot.get("valuation"):
        base_close = _latest_close(snapshot["ticker"], snapshot["scanned_on"], price_fn or _default_price_fn)
    save(snapshot, base_close, snapshot_dir)


def load(ticker: str, end_date: str, snapshot_dir: Optional[Path] = None) -> Optional[dict]:
    """쓸 수 있는 스냅샷. 오래됐거나, 기준일이 스냅샷보다 앞서면(과거 시점 스캔) 없음."""
    path = _path(ticker, snapshot_dir)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if data.get("version") != VERSION or not data.get("scanned_on"):
        return None
    scanned = date.fromisoformat(data["scanned_on"])
    day = date.fromisoformat(end_date)
    if day < scanned or (day - scanned).days > max_age_days(ticker):
        return None
    return data


def reprice(
    entry: dict,
    end_date: str,
    price_fn: Optional[PriceFn] = None,
    snapshot_dir: Optional[Path] = None,
) -> Optional[dict]:
    """스냅샷이 있으면 오늘 종가만으로 판정을 다시 낸다. 쓸 수 없으면 None — 전체 계산을 한다."""
    snap = load(entry["ticker"], end_date, snapshot_dir)
    if snap is None:
        return None
    valuation = None
    val = snap.get("valuation")
    if val:
        base = snap.get("base_close")
        if not base:
            return None
        if base[0] == end_date or snap["scanned_on"] == end_date:
            close = (base[0], float(base[1]))
        else:
            close = _latest_close(entry["ticker"], end_date, price_fn or _default_price_fn)
        if not close:
            return None
        market_cap = val["market_cap"] * close[1] / float(base[1])
        valuation = blend(val["models"], market_cap, val.get("shares"))
    return {
        "ticker": entry["ticker"],
        "name": entry.get("name") or snap.get("name"),
        "market": entry.get("market") or snap.get("market"),
        "sector": entry.get("sector") or snap.get("sector"),
        "industry": entry.get("industry") or snap.get("industry"),
        **classify(
            snap["fundamentals"], valuation, financial=bool(snap.get("financial")),
            sector=entry.get("sector") or snap.get("sector"),
        ),
        "error": None,
        # 재무를 마지막으로 계산한 날 — 화면에 '재무 기준일'로 보여 준다.
        "fundamentals_as_of": snap["scanned_on"],
    }
