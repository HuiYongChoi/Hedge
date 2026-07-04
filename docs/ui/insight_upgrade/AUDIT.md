# 전수점검 AUDIT — 실자료 기반 투자 인사이트 업그레이드 (2026-07-05)

4개 섹션(플로우/종목분석/종목비교/데이터 샌드박스)의 표시 항목·데이터 추적성·섹션 간 일관성·디자인을
전수점검한 결과와, 같은 커밋 사이클에서 적용한 수정 사항. 근거는 파일:라인과 라이브 API 프로브.

## 요약 판정

| 영역 | 판정 | 비고 |
|---|---|---|
| 데이터 추적성 | ✅ 양호 | 4개 섹션 모두 `/hedge-fund/fetch-metrics` + `/analyst-targets` 실데이터. 목업/하드코딩 수치 없음 |
| KR 커버리지 | ✅ 해소 | 005930.KS 라이브 프로브: EV·EV/EBITDA·ROIC·ROE·성장률 모두 채워짐 (아래 P1) |
| 신호↔점수 모순 | 🔴→✅ 수정 | 스티키 결론 칩이 종합점수 밴드와 상반 가능 → 단일 진실원천화 (아래 P0) |
| 섹션 연계성 | 🔴→✅ 일부 수정 | 비교→분석 딥링크 부재 → 추가. 샌드박스 override는 분석/플로우만 반영(비교 미반영, 후속) |
| 라벨 일관성 | ✅ 대부분/수정 | ko 라벨은 섹션 간 일치. EN 1건 정렬(Earnings→Net Income Growth) |
| 디자인 일관성 | ⚠️ 소규모 이슈 | 플로우 하드코딩 영문 상태문구 → t() 교체. 잔여 항목은 후속 목록 참조 |

## P0 — 신호↔점수↔안전마진 모순 (수정 완료)

**증상(라이브 재현, UNH)**: 상단 스티키 칩 `↑매수·강세 신뢰도 68` vs 리포트 카드 `비중 축소`(종합점수 28) vs
안전마진 −62.6%가 한 화면에 공존.

**원인(코드 추적)**:
- 카드 배지 = `getScoreBand(compositeScore)` (helpers.ts:294-300, 점수 28 → '비중 축소'/bearish).
  compositeScore는 **전 에이전트 신호의 평균** (stock-search-tab `calculateCompositeScore`).
- 스티키 칩 = **표시 중인 에이전트 1명의 신호** `displayReport.signal ?? decisions[ticker].action`
  (report-layout.tsx, 구 `stickyVerdictFromSignal`). 두 결론의 소스가 달라 구조적으로 상반 가능.

**수정**: `helpers.resolveHeadlineVerdict(signal, compositeScore, language)` 신설 — 신호 톤이 종합점수
밴드 톤과 반대(둘 다 방향성)면 **밴드 결론(라벨 포함, 예: '비중 축소')로 대체 표기**. 스티키 헤더에
`verdictLabelOverride` 지원. 회귀 테스트: `test_sticky_verdict_uses_single_source_resolver`.

## P1 — KR 결측 (라이브 검증 결과: 해소)

005930.KS `/hedge-fund/fetch-metrics` 프로브(HTTP 200):
- TTM: enterprise_value ✓, EV/EBITDA 13.76 ✓, ROIC 21.4% ✓, ROE 17.3% ✓, D/E 5.5% ✓,
  성장률 YoY/QoQ ✓, interest_coverage 6.68 ✓, FCF yield ✓
- annual: operating_income_growth +33.2% ✓ (TTM 응답에선 null이지만 비교탭은 annual 우선 조회로 보완)
- 잔여 null: line_items의 `ebitda`(비율은 별도 계산되어 무해). 백엔드 수술 불필요.
- 참고: 분기 YoY 성장률이 수 배(예: OI YoY +756%)로 나오는 것은 반도체 사이클 기저효과이며
  공식 검증됨(hedge_fund.py `(c-p)/|p|`, 실제 분기 line_items 기반). 데이터 오류 아님.

## P3 — 섹션·메뉴 연계성

- ✅ **비교→분석 딥링크 추가**: 랭킹 카드에 '분석 열기' 버튼 → `patchWorkspace({tickers})` +
  `TabService.createStockSearchTab()` (저장분석 재열람 handleRestore와 동일 패턴). 테스트 추가.
- ✅ 기존 확인: 저장분석→분석/샌드박스/비교 재열람 딥링크 있음(saved-list-row.tsx:60-88).
- ✅ 기존 확인: 샌드박스 override는 분석 탭(체크박스 'Data Sandbox 수정값 사용')과 플로우 노드 실행에
  `metric_overrides`로 전파됨(localStorage `ai-hedge-fund:data-sandbox-overrides:v1`).
- ⚠️ 후속: 비교탭은 override 미반영(표시값이 원본 데이터). 반영 시 슬롯별 '수정값' 배지 필요.

## P4/P5 — 디자인·라벨 (수정 완료분)

- ✅ 플로우 agent-output-dialog 하드코딩 영문 상태문구 4곳 → 기존 t() 키(analysisInProgress 등) 적용.
- ✅ portfolio-manager-node 'View Investment Report' → `t('viewInvestmentReport')` 신설(ko '투자 리포트 보기').
- ✅ 샌드박스 EN `financialFieldEarningsGrowth` 'Earnings Growth' → 'Net Income Growth'
  (ko '순이익 성장률' 및 비교탭 EN과 의미 정렬).
- 이전 사이클 완료분: 안전가(가격)/안전마진(%) 라벨 분리(be7bca8), 헤더 리본 신호 배지 제거,
  결론 문장 방향충돌 시 신호 생략, 중복 숫자 정규화(f79f4d5).

## 확인된 무해 사항

- SSE: 백엔드 15초 하트비트 + 서버 Apache timeout=300로 커버(프론트는 5분 stale 감지만 담당) — 조치 불필요.
- TTM 주식수 팽창 리스크: per-share 계산은 `metrics[0].outstanding_shares` 사용 관행 유지 확인.
- D/E: `debt_to_equity`(이자부채, line_items 재계산)와 `liabilities_to_equity`(부채총계) 라벨
  '이자부채비율'/'부채비율'로 구분 일관(비교·샌드박스 동일).

## 후속 개선 후보 (이번 사이클 미포함, 우선순위순)

1. 비교탭 샌드박스 override 반영 + 슬롯 배지 (연계성 완결)
2. 비교탭 인라인 ko/en 라벨 26행 → t() 키 이관 (일관성 부채, 사용자 영향 낮음)
3. 플로우 신호색 중립=yellow vs 리포트 중립=amber/gray 톤 통일
4. output-node-status 기본 문구('Idle' 등) i18n화
5. 번들 코드스플리팅(index chunk 1.6MB — 로딩 성능)
