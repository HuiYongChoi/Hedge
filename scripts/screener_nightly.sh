#!/bin/bash
# 매수 후보 자동 스캔 — 지수 전체를 서버에서 끝까지 돌려 '저장 분석'과 전진 검증 기록에 남긴다.
# systemd 타이머(scripts/systemd/hedge-screener-*.timer)가 부른다. 인자: SP500 | KOSPI
set -uo pipefail
MARKET="${1:?market (SP500|KOSPI)}"
API="${HEDGE_API:-http://127.0.0.1:8000}"
started=$(date -u +%FT%TZ)
# 스캔은 스트림을 끝까지 읽는 동안만 돈다. 결과 줄 수만 세어 기록한다(최대 3시간).
results=$(curl -sS -N --max-time 10800 -X POST "$API/screener/scan" \
  -H 'Content-Type: application/json' \
  -d "{\"market\":\"$MARKET\",\"language\":\"ko\"}" | grep -c '^event: result')
status=$?
echo "screener nightly $MARKET started=$started finished=$(date -u +%FT%TZ) results=$results curl_status=$status"
