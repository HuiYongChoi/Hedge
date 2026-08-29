"""시장 레짐 조회 (Investment Navigator).

원칙: 매크로는 부가 입력이지 의존성이 아니다.
    공급 측이 죽어도, 느려도, 형식이 바뀌어도 분석은 기존 상수로 100% 동작해야 한다.
    그래서 이 모듈은 어떤 실패에서도 예외를 던지지 않고 None 을 돌려준다.
    None 은 오류가 아니라 정상 경로다.

백테스트
    end_date 가 과거면 조회하지 않는다. 오늘 금리를 과거 분석에 넣으면
    그 자체로 미래 정보 유입(look-ahead)이다.

현재 상태
    공급 측 엔드포인트는 아직 열리지 않았다(2026-08-29 확인: Unknown proxy action).
    따라서 지금은 항상 None 이 반환되고 동작이 바뀌지 않는다. 저쪽이 열면 자동으로 켜진다.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.request
from datetime import date
from typing import Optional

DEFAULT_ENDPOINT = "https://hyfin.duckdns.org/proxy.php?action=macro_regime"

#: 매크로 때문에 분석 전체가 지연되면 안 된다. 짧게 끊는다.
HTTP_TIMEOUT_SECONDS = 5
#: 시장 레짐은 분 단위로 바뀌지 않는다.
CACHE_TTL_SECONDS = 6 * 3600
#: 실패는 짧게만 기억한다.
#: 성공과 같은 6시간을 적용하면 (1) 공급 측이 열린 뒤에도 최대 6시간 동안 꺼진
#: 상태가 유지되고 — 백엔드는 상주 프로세스라 재배포 전까지 안 풀린다 —
#: (2) 일시적인 500 한 번에 매크로가 반나절 죽는다.
FAILURE_CACHE_TTL_SECONDS = 600

_cache: dict[str, tuple[float, Optional[dict]]] = {}
#: 캐시가 비었을 때 여러 분석이 동시에 시작하면 같은 요청이 그 수만큼 나간다.
#: 한 번만 다녀오게 하고 나머지는 그 결과를 쓴다(대기 시간도 1회분으로 끝난다).
_fetch_lock = threading.Lock()


def _cached_value(now: float) -> tuple[bool, Optional[dict]]:
    """(유효한 캐시가 있는가, 그 값)."""
    entry = _cache.get(_endpoint())
    if not entry:
        return False, None
    stamp, payload = entry
    ttl = CACHE_TTL_SECONDS if payload is not None else FAILURE_CACHE_TTL_SECONDS
    return (now - stamp < ttl), payload


def _endpoint() -> str:
    return (os.environ.get("MACRO_REGIME_URL") or DEFAULT_ENDPOINT).strip()


def is_macro_enabled() -> bool:
    """매크로 연동을 끄고 싶을 때가 있다(백테스트 일괄 실행 등)."""
    return (os.environ.get("MACRO_REGIME_ENABLED", "1").strip().lower()
            not in ("0", "false", "no"))


def _is_past(end_date: Optional[str]) -> bool:
    if not end_date:
        return False
    try:
        return date.fromisoformat(str(end_date)[:10]) < date.today()
    except ValueError:
        return False


def fetch_macro_regime(end_date: Optional[str] = None) -> Optional[dict]:
    """레짐 페이로드. 실패·비활성·과거 시점이면 None."""
    if not is_macro_enabled():
        return None
    if _is_past(end_date):
        return None            # 과거 분석에 오늘 값을 넣지 않는다

    fresh, payload = _cached_value(time.time())
    if fresh:
        return payload

    with _fetch_lock:
        # 잠금을 기다리는 동안 다른 스레드가 이미 받아왔을 수 있다.
        fresh, payload = _cached_value(time.time())
        if fresh:
            return payload
        return _fetch_uncached()


def _fetch_uncached() -> Optional[dict]:
    cache_key = _endpoint()
    payload: Optional[dict] = None
    try:
        request = urllib.request.Request(
            cache_key, headers={"Accept": "application/json", "User-Agent": "HyFin Research"},
        )
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
        if isinstance(body, dict) and body.get("live") is not False and not body.get("error"):
            payload = body
    except Exception:
        payload = None         # 네트워크·파싱·형식 어떤 실패든 매크로 없이 간다

    _cache[cache_key] = (time.time(), payload)
    return payload
