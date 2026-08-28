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
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Optional

_BASE_URL = "https://api.roic.ai/v3.0.0"
_HTTP_TIMEOUT = 30
_CACHE_TTL = 12 * 60 * 60          # 무료 등급 분당 5회 — 캐시를 길게 잡는다
_cache: dict[str, tuple[float, "EarningsCall"]] = {}
#: 티커 → 맞았던 거래소 식별자. 거래소 탐색 호출을 한 번만 쓰기 위한 기억.
_identifier_cache: dict[str, str] = {}

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


class RateLimited(Exception):
    """무료 등급 분당 호출 한도(5회)에 걸린 상태. '자료 없음'과 구분해야 한다."""


_RETRY_AFTER_RE = re.compile(r"Retry in (\d+)")
_MAX_RATE_LIMIT_RETRIES = 3


def _http_get_json(path: str, params: dict) -> dict:
    """429 는 재시도한다 — 한도 초과를 '자료 없음'으로 오인하면 조용히 근거가 빠진다."""
    url = f"{_BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(_MAX_RATE_LIMIT_RETRIES + 1):
        request = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {_api_key()}",
            "Accept": "application/json",
            "User-Agent": "HyFin Research",
        })
        try:
            with urllib.request.urlopen(request, timeout=_HTTP_TIMEOUT) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == _MAX_RATE_LIMIT_RETRIES:
                if exc.code == 429:
                    raise RateLimited("ROIC 무료 등급 호출 한도 초과") from exc
                raise
            body = ""
            try:
                body = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                pass
            match = _RETRY_AFTER_RE.search(body)
            time.sleep((int(match.group(1)) if match else 8) + 2)
    raise RateLimited("ROIC 무료 등급 호출 한도 초과")


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


#: 콜 진행 안내·면책 문구. 'expect' 같은 단어가 들어 있어 전망 문장으로 오인된다.
#: 실측(삼성전자 2026 Q2): "We expect today's conference call to last approximately 1 hour."
#: 이런 문장만 12개 뽑히면 근거로서 아무 값이 없다.
_HOUSEKEEPING_RE = re.compile(
    r"conference call|webcast|replay|operator instruction|turn(?:ing)? the call over|"
    r"forward[-\s]looking statement|safe harbor|non[-\s]GAAP|"
    r"refer to (?:our|the)|press release|earnings release|投資家|"
    r"question[-\s]and[-\s]answer|Q&A session|will (?:review|follow up|then)|"
    r"thank you for joining|welcome to the|good (?:morning|afternoon|evening)|"
    r"my name is|joining me (?:today|on)|before (?:we|handing)|hand(?:ing)? (?:the call|over) to",
    re.I,
)

#: 숫자나 명시적 가이던스 표현이 있으면 근거로서 값이 크다.
_EXPLICIT_GUIDANCE_RE = re.compile(r"\b(guidance|outlook|we expect|we anticipate|we forecast)\b", re.I)


def extract_guidance_lines(turns: list, limit: int = 12) -> list[str]:
    """전사에서 전망·가이던스를 말한 문장만 골라낸다.

    전사 전체는 수만 자라 프롬프트에 통째로 넣을 수 없다. 배수의 전제(이익 급증)를
    회사가 실제로 말했는지 확인하는 게 목적이므로 그 문장만 뽑되,
    (1) 콜 진행 안내는 버리고 (2) 숫자·명시적 가이던스가 있는 문장을 앞세운다.
    """
    scored: list[tuple[int, int, str]] = []
    order = 0
    for turn in turns:
        if not isinstance(turn, dict):
            continue
        speaker = str(turn.get("speaker") or "").strip()
        if re.fullmatch(r"(?i)operator", speaker):
            continue
        for sentence in re.split(r"(?<=[.!?])\s+", str(turn.get("text") or "")):
            sentence = sentence.strip()
            if len(sentence) < 60 or len(sentence) > 400:
                continue
            if not _GUIDANCE_RE.search(sentence) or _HOUSEKEEPING_RE.search(sentence):
                continue
            score = 0
            if _EXPLICIT_GUIDANCE_RE.search(sentence):
                score += 2
            if re.search(r"\d", sentence):
                score += 1
            order += 1
            scored.append((-score, order, f"{speaker}: {sentence}" if speaker else sentence))
    scored.sort()
    return [line for _score, _order, line in scored[:limit]]


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
        # 거래소 접두사를 하나씩 시도하면 분당 한도를 금방 태운다. 한 번 맞은 식별자는
        # 오래 기억해 두고 다음부터는 곧장 그것만 쓴다.
        candidates = candidate_identifiers(ticker_key)
        known = _identifier_cache.get(ticker_key)
        if known:
            candidates = [known] + [c for c in candidates if c != known]

        for identifier in candidates:
            try:
                listing = _http_get_json("/earnings-calls", {"identifier": identifier, "limit": 1})
            except RateLimited:
                # 한도 초과는 일시적이다. 12시간 캐시에 넣으면 그동안 근거가 통째로 빠진다.
                result.error = "ROIC 무료 등급 호출 한도 초과 — 잠시 후 다시 시도"
                return result
            except Exception:
                continue      # 해당 거래소에 없는 티커 — 다음 후보로
            rows = listing.get("data") or []
            if rows:
                entry = rows[0]
                result.identifier = identifier
                _identifier_cache[ticker_key] = identifier
                break

        if entry is None:
            result.error = "No earnings call found for this ticker on ROIC"
            _cache[cache_key] = (time.time(), result)
            return result

        result.call_id = str(entry.get("id") or "")
        result.fiscal_year = entry.get("fiscal_year")
        result.fiscal_quarter = entry.get("fiscal_quarter")
        result.date = entry.get("date")

        # 전사 조회는 목록의 id 가 아니라 **식별자 + 회계연도/분기**로 한다.
        # (id 를 경로에 넣으면 "No ticker matches the supplied identifier" 404)
        detail = _http_get_json(
            f"/earnings-calls/{urllib.parse.quote(result.identifier or '', safe=':')}",
            {"fiscal_year": result.fiscal_year, "fiscal_quarter": result.fiscal_quarter},
        )
        payload = detail.get("data") if isinstance(detail.get("data"), dict) else detail
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
        "인용할 때는 영어 원문을 그대로 적고, 바로 아랫줄에 괄호로 한국어 번역을 붙여라 "
        "— 원문은 근거이고 번역은 독자를 위한 것이므로 둘 다 필요하다.\n"
        f"\n{call.text}"
    )
