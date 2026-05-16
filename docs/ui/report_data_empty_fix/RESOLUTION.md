# Analyst Report v5 Empty Data Regression Resolution

작성일: 2026-05-16

## 1. 실측 결과

서버 `bitnami@54.116.99.19`에서 Apache와 브라우저 캐시를 제외하고 `127.0.0.1:8000` 백엔드에 직접 SSE를 호출했다.

- 최초 인계 문서의 단순 payload는 현재 API 스키마와 달라 `graph_nodes`, `graph_edges` 누락으로 422 응답을 반환했다.
- 실제 UI와 동일한 graph payload로 다시 호출하자 `start`, `progress`, `complete` 이벤트가 정상 수신됐다.
- `complete.data.analyst_signals`에는 suffix가 붙은 key가 들어왔다.
  - `ben_graham_codx01.MU.reasoning`: string, 약 2,999자
  - `mohnish_pabrai_codx01.MU.reasoning`: string, 약 3,190자
  - `aswath_damodaran_codx01.MU.reasoning`: string, 약 3,076자
  - `charlie_munger_codx01.MU.reasoning`: string, 약 2,777자
  - `risk_management_agent_codx01.MU.reasoning`: dict
- `valuation_analyst` 단독 호출에서는 `analyst_signals.valuation_analyst_codx02`가 `{}`로 내려왔고, `MU.reasoning`이 없었다.
- `fair_entry_price`, `safety_margin_price` 같은 별도 안전마진 가격 필드는 실측 payload에서 확인되지 않았다.

결론: 백엔드가 모든 본문을 빈 값으로 보내는 문제가 아니었다. 일반 투자 에이전트들은 긴 reasoning 문자열을 정상 반환했고, RIM/PBR feature 이후의 `valuation_analyst` 경로와 프론트 deep-dive 도입이 본문 회귀를 유발한 범위로 확정했다.

## 2. 본문 빈 상태 Root Cause 및 적용 Diff

사용자가 선택한 전략 A에 따라 회귀가 시작된 feature/fix 묶음을 제거하고 마지막 정상 기준인 `75f9924` 동작으로 되돌렸다.

제거한 범위:

- `28a9989` backend RIM/PBR/CapEx regime feature
- `bc05c2e` frontend valuation deep-dive panel
- `4b54acf`, `e62c6d3`, `f8be5ef`, `4546303`의 실패한 forward fix/debug 시도

적용 결과:

- `app/frontend/src/components/reports/analyst-report-v5/valuation-panel/` 제거
- `report-layout.tsx`, `report-section.tsx`, `report-body.tsx`, `types.ts`, `language-preferences.ts`에서 `ValuationDeepDive`/RIM/PBR 패널 연결 제거
- `src/agents/valuation.py`를 RIM/PBR feature 이전 형태로 복원
- `tests/test_valuation_pbr_band.py`, `tests/test_valuation_rim_breakdown.py` 제거
- `tests/test_analyst_report_v5_static.py`에 RIM/PBR panel이 안전하게 재도입되기 전까지 남아 있지 않아야 한다는 회귀 방지 assertion 추가

`75f9924..HEAD` 기준 실제 남은 의도적 차이는 `helpers.ts`의 안전마진 타일 보정과 해당 static test뿐이다.

## 3. 안전마진 타일 알고리즘 및 LOCK

사용자가 선택한 안전마진 C에 따라 git history의 정상 동작을 확인했다.

- 확인 기준: `6fcc5b7 feat(report): add Price Compass Bar with FY0+FY+N annual markers`
- 당시 Price Compass Bar의 안전마진 매수 가격은 `mosPrice = intrinsic * (1 - mosBuffer)`로 계산했다.
- 기본 `mosBuffer`는 `0.25`, 즉 25%였다.
- 현재 백엔드 payload에는 별도 `safety_margin_price` 필드가 없으므로, 이 historical algorithm을 Analyst Report v5 타겟 타일에도 적용했다.

LOCK:

> 안전마진 타일은 `safetyMarginPrice = 1주당 내재가치 × (1 - 0.25)` 알고리즘으로 고정한다.
> 타일 value는 raw intrinsic value와 같으면 안 되며, 현재가 대비 `safetyMarginPrice`의 상대 괴리율을 함께 표시한다.
> 향후 별도 backend field가 추가되기 전까지 임의로 raw intrinsic value를 안전마진 타일에 다시 표시하지 않는다.

적용 diff:

- `helpers.ts`
  - `SAFETY_MARGIN_PRICE_BUFFER = 0.25` 추가
  - `resolveMarginOfSafetySnapshot` 반환값에 `safetyMarginPrice` 추가
  - `extractTargetTiles`의 `targetMargin` candidate가 raw `metrics.intrinsicValue.value`를 직접 포맷하지 않도록 변경
  - `buildSafetyMarginPrice` 추가
  - `formatSafetyMarginTarget` 추가
- `tests/test_analyst_report_v5_static.py`
  - 안전마진 타일 value가 raw intrinsic value를 직접 사용하지 않는지 assertion 추가
  - `formatMarginTarget(value, metrics.intrinsicValue?.value...)` 재발 금지 assertion 추가

## 4. 사용자 안내

배포 후에는 브라우저 캐시 영향을 배제하기 위해 다음 중 하나를 권장한다.

1. 시크릿 창에서 `http://54.116.99.19/hedge/#investor-agents` 접속
2. 또는 DevTools Network 탭에서 `Disable cache` 체크 후 새로고침
3. 기존 분석 결과는 이전 bundle/이전 run 결과일 수 있으므로 새 분석을 한 번 실행

정상 기대값:

- 섹션 01~06이 모두 "이 섹션에 적용할 데이터가 없습니다."로만 보이면 안 된다.
- SK하이닉스는 헤더에서 `SK하이닉스 · 애스워스 다모다란`처럼 회사명으로 표시된다.
- `1주당 내재가치`와 `안전마진` 타일의 ₩가격은 서로 달라야 한다.
- 안전마진 타일은 25% buffer가 반영된 보수적 가격과 현재가 대비 +/- 퍼센트를 함께 표시한다.
