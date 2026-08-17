"""어닝콜 전사(ROIC.ai) — 경영진이 직접 말한 '전망'을 근거로 넣는다.

왜 필요한가 (실측)
    지금 [MANAGEMENT SAID] 블록에는 8-K Item 2.02 보도자료와 한국 영업(잠정)실적
    공정공시가 들어간다. 둘 다 **실적 숫자** 문서다. 그래서 리포트가 이렇게 적었다:

        "제공된 경영진 발언 블록에는 전망 문장이 아니라 잠정 실적 수치 위주이므로,
         전망의 문장 존재 여부는 제공된 자료에서 확인 불가입니다."

    선행 PER 4.0 같은 배수는 '이익이 급증한다'는 전제 위에 서 있는데, 그 전제를
    회사가 실제로 말했는지 확인할 자료가 없었던 것이다. 어닝콜에는 가이던스와
    애널리스트 Q&A가 있어 바로 그 문장을 준다.

키가 없으면 동작하지 않는다
    ROIC_API_KEY 가 없으면 네트워크 호출도, 모듈 임포트도 하지 않는다(EDINET 과 동일).
    무료 등급은 분당 5회 제한이라 캐시를 길게 잡고 호출 수를 최소로 유지한다.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

_BASE_URL = "https://api.roic.ai/v3.0.0"
_HTTP_TIMEOUT = 30
_CACHE_TTL = 12 * 60 * 60          # 무료 등급 분당 5회 — 캐시를 길게 잡는다
_cache: dict[str, tuple[float, "EarningsCall"]] = {}

#: 미국 티커는 거래소 접두사가 필요하다. 조회 순서는 상장 수가 많은 쪽부터.
_US_EXCHANGES = ("NASDAQ", "NYSE", "AMEX")

#: 전망·가이던스가 담긴 문장을 고르는 표현.
_GUIDANCE_RE = re.compile(
    r"\b(guidance|outlook|expect|anticipate|forecast|project|next quarter|full[- ]year|"
    r"we (?:believe|see|plan|intend)|going forward|second half|first half|capacity|"
    r"demand|backlog|margin)\b",
    re.I,
)


def is_roic_enabled() -> bool:
    """ROIC 구독키가 있는지. 모듈 임포트 없이 환경변수만 본다."""
    return bool((os.environ.get("ROIC_API_KEY") or "").strip())


@dataclass
class EarningsCall:
    ticker: str
    identifier: Optional[str] = None
    call_id: Optional[str] = None
    fiscal_year: Optional[int] = None
    fiscal_quarter: Optional[int] = None
    date: Optional[str] = None
    text: str = ""
    guidance_lines: Optional[list] = None
    char_count: int = 0
    truncated: bool = False
    error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "identifier": self.identifier,
            "call_id": self.call_id,
            "fiscal_year": self.fiscal_year,
            "fiscal_quarter": self.fiscal_quarter,
            "date": self.date,
            "text": self.text,
            "guidance_lines": self.guidance_lines or [],
            "char_count": self.char_count,
            "truncated": self.truncated,
            "error": self.error,
        }


def _api_key() -> str:
    return (os.environ.get("ROIC_API_KEY") or "").strip()


def _http_get_json(path: str, params: dict) -> dict:
    url = f"{_BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {_api_key()}",
        "Accept": "application/json",
        "User-Agent": "HyFin Research",
    })
    with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def candidate_identifiers(ticker: str) -> list[str]:
    """티커 → ROIC 식별자 후보. 이미 'EXCHANGE:SYMBOL' 이면 그대로 쓴다."""
    raw = (ticker or "").strip().upper()
    if not raw:
        return []
    if ":" in raw:
        return [raw]
    from src.tools.filings import detect_market

    market = detect_market(raw)
    if market == "KR":
        from src.tools.dart_filings import normalize_kr_code

        code = normalize_kr_code(raw) or raw
        return [f"KRX:{code}", f"KOSPI:{code}", f"KOSDAQ:{code}"]
    if market == "JP":
        code = raw.replace(".T", "")
        return [f"TSE:{code}", f"TYO:{code}"]
    return [f"{exchange}:{raw}" for exchange in _US_EXCHANGES]


def extract_guidance_lines(turns: list, limit: int = 12) -> list[str]:
    """전사에서 전망·가이던스를 말한 문장만 골라낸다.

    전사 전체는 수만 자라 프롬프트에 통째로 넣을 수 없다. 배수의 전제(이익 급증)를
    회사가 실제로 말했는지 확인하는 게 목적이므로 그 문장만 뽑는다.
    """
    lines: list[str] = []
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        speaker = str(turn.get("speaker") or "").strip()
        for sentence in re.split(r"(?<=[.!?])\s+", str(turn.get("text") or "")):
            sentence = sentence.strip()
            if len(sentence) < 60 or len(sentence) > 400:
                continue
            if not _GUIDANCE_RE.search(sentence):
                continue
            lines.append(f"{speaker}: {sentence}" if speaker else sentence)
            if len(lines) >= limit:
                return lines
    return lines


def fetch_latest_earnings_call(ticker: str, budget: int = 5000) -> EarningsCall:
    """최신 어닝콜 전사에서 전망 문장을 가져온다. 실패해도 예외를 던지지 않는다."""
    ticker_key = (ticker or "").strip().upper()
    cache_key = f"{ticker_key}:{budget}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL:
        return cached[1]

    result = EarningsCall(ticker=ticker_key)
    if not is_roic_enabled():
        result.error = "ROIC_API_KEY not configured — 어닝콜 전사 기능 비활성"
        _cache[cache_key] = (time.time(), result)
        return result

    try:
        entry = None
        for identifier in candidate_identifiers(ticker_key):
            try:
                listing = _http_get_json("/earnings-calls", {"identifier": identifier, "limit": 1})
            except Exception:
                continue
            rows = listing.get("data") or []
            if rows:
                entry = rows[0]
                result.identifier = identifier
                break

        if entry is None:
            result.error = "No earnings call found for this ticker on ROIC"
            _cache[cache_key] = (time.time(), result)
            return result

        result.call_id = str(entry.get("id") or "")
        result.fiscal_year = entry.get("fiscal_year")
        result.fiscal_quarter = entry.get("fiscal_quarter")
        result.date = entry.get("date")

        detail = _http_get_json(f"/earnings-calls/{result.call_id}", {"format": "json"})
        payload = detail.get("data") or detail
        turns = payload.get("transcript") or payload.get("turns") or []
        result.guidance_lines = extract_guidance_lines(turns)

        body = "\n".join(result.guidance_lines)
        result.char_count = len(body)
        result.truncated = len(body) > budget
        result.text = body[:budget].strip()
        if not result.text:
            result.error = "Transcript fetched but no forward-looking statement matched"
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}"

    _cache[cache_key] = (time.time(), result)
    return result


def build_earnings_call_context(call: EarningsCall) -> str:
    """LLM 프롬프트에 넣을 어닝콜 발언 블록. 근거가 없으면 빈 문자열."""
    if not call.text:
        return ""
    period = ""
    if call.fiscal_year:
        period = f"{call.fiscal_year}"
        if call.fiscal_quarter:
            period += f" Q{call.fiscal_quarter}"
    return (
        f"[MANAGEMENT SAID — {call.ticker} 어닝콜 전사 {period}, {call.date or ''}]\n"
        "아래는 경영진이 실적 발표 콘퍼런스콜에서 직접 말한 전망·가이던스 문장이다. "
        "선행 PER 등 '이익이 늘어난다'는 전제를 쓸 때는 이 문장으로 뒷받침하고, "
        "해당 문장이 없으면 `제공된 자료에서 확인 불가` 로 표기하라.\n"
        f"\n{call.text}"
    )
