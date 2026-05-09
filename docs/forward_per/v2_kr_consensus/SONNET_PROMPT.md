# Sonnet 인계 프롬프트 (그대로 복사 → 붙여넣기)

> 아래 코드 블록 안 내용을 통째로 Sonnet 세션에 붙여넣으면 됩니다.
> 작업 디렉토리는 `ai-hedge-fund/`로 들어간 뒤 시작.

---

```text
당신은 ai-hedge-fund 프로젝트의 v2 작업("한국 종목 Forward PER 보완")을 구현합니다.
v1은 이미 머지되어 있고, 한국 종목에서는 컨센서스가 합성되지 않아 forward의 의미가 사라진 상태입니다. 이 PR로 그걸 고칩니다.

## 0단계 — 현재 깨진 동작 (눈으로 확인하고 시작)

데이터 샌드박스에서 SK하이닉스(000660.KS)를 2026-05-09 기준으로 조회하면:
  - composition: 2024Q3, 2025Q1, 2025Q2, 2025Q3 — 모두 actual / YFinance
  - "no consensus estimate available"
  - confidence: low
  - 가장 최신 actual이 8개월 전(2025Q3), 2024Q4·2025Q4·2026Q1 누락

문제는 두 갈래로 분리됩니다:
  A. 한국 컨센서스 provider가 stub (KrFnGuideProvider) → forward가 합성되지 않음
  B. yfinance가 한국 종목 분기 EPS를 띄엄띄엄 반환 → actual 분기 자체가 결손
이번 PR은 둘 다 고칩니다.

## 1단계 — 먼저 읽기 (생략 금지, 순서대로)

  1. docs/forward_per/v2_kr_consensus/DESIGN.md   ← 본 PR의 전체 설계 (필수)
  2. docs/forward_per/v1_done/DESIGN.md            ← v1 설계 (배경)
  3. CLAUDE.md
  4. src/tools/forward_metrics.py                  ← v1로 머지된 합성 함수
  5. src/tools/estimates_api.py                    ← v1 어댑터, 한국용 stub 위치
  6. src/data/models_forward.py                    ← 모델, source literal 확장 대상
  7. src/tools/dart_api.py                         ← DART 어댑터 패턴
  8. src/tools/api.py                              ← _is_korean_ticker, get_financial_metrics
  9. src/data/cache.py                             ← forward 캐시
 10. tests/test_forward_metrics.py                 ← v1 테스트 (회귀 베이스)

설계 문서를 읽지 않고 코드부터 작성하지 마세요. 본 PR은 외부 사이트 HTML 파싱이 들어가는 만큼, DESIGN.md §6 "리스크 / 대응" 표를 머릿속에 먼저 박아두세요.

## 2단계 — 구현 범위

DESIGN.md §4 "구현 순서" 1~9번 모두. 단, §5 "명시적 비-범위"는 절대 손대지 마세요.

구체적으로:

  (1) src/data/models_forward.py 보강
       - QuarterlyEPS.source literal에 "consensus_split_from_annual" 추가
       - ForwardMetrics.currency: str = "USD" 필드 추가 (기본값 유지로 v1 회귀 없음)

  (2) src/tools/dart_api.py 확장
       - 신규 함수 fetch_quarterly_eps_series(ticker, end_date, num_quarters=8)
       - 기존 fetch_dart_metrics 패턴을 그대로 따라 작성
       - 분기보고서/반기보고서/사업보고서를 받아 분기 EPS 역산
         · 1Q 분기보고서 → Q1 그대로
         · 반기보고서 → H1 - Q1 = Q2
         · 3Q 분기보고서 → 9M - H1 = Q3
         · 사업보고서(연간) → Annual - 9M = Q4
       - 실패 시 빈 리스트 + logger.warning, 예외 전파 금지

  (3) src/tools/kr_consensus/ 패키지 신설
       - __init__.py
       - naver_finance.py: NaverConsensusProvider
           · URL: https://finance.naver.com/item/main.naver?code={6자리}
           · 티커 "000660.KS" → "000660" 변환
           · "기업실적분석"/"Financial Summary" 표에서 추정 EPS 추출
           · 분기 추정이 직접 있으면 source="consensus" 그대로 반환
           · 연간 추정만 있으면 annualized_split을 호출해 변환,
             source="consensus_split_from_annual"로 표기
           · User-Agent 명시 ("ai-hedge-fund/0.x research bot"),
             요청 후 1초 sleep, requests + BeautifulSoup만 사용
           · 실패 시 빈 리스트 + 경고
       - wise_report.py: WiseReportProvider
           · URL: https://comp.fnguide.com/SVO2/asp/SVD_Main.asp?gicode=A{6자리}
           · 동일 패턴, 분기 컨센서스가 노출되면 우선 사용
       - hankyung.py: HankyungMetaProvider (1차는 메타만, 가까운 stub)
           · 메타데이터 파싱 시도, 실패 시 빈 리스트 (LLM 호출 없음)
           · TODO 주석으로 v3 PDF 파싱 자리 명시
       - annualized_split.py: split_annual_to_next_quarter() 순수 함수
           · 입력: annual_eps, [QuarterlyEPS already realized in this fiscal year]
           · 출력: 다음 분기 추정 EPS (단일 float) + as_of 메타
           · 단순 균등 분배만 (계절성 X — 비-범위)

  (4) src/tools/estimates_api.py 라우팅 교체
       - default_provider_chain(ticker) 안에서, 한국 티커일 때
         [NaverConsensusProvider, WiseReportProvider, HankyungMetaProvider, LLMEstimateProvider]
         체인을 반환하도록 수정
       - v1의 KrFnGuideProvider 클래스는 deprecated 주석을 추가하되 삭제는 하지 않음
         (외부에서 import 가능성 대비)

  (5) src/tools/forward_metrics.py::_load_trailing_quarterly_eps 보강
       - 기존: yfinance 단일 소스
       - 변경: yfinance + (한국 티커일 때) DART fetch_quarterly_eps_series 합성
       - fiscal_period_end 기준 dedupe, DART 우선
       - 가장 최신 actual이 as_of로부터 6개월 이상 떨어졌으면
         ForwardMetrics.notes에 "actual data stale by Xd" 추가 + confidence 한 단계 강등
       - 4분기 시계열 안에 누락된 분기가 있으면 notes에 명시
         (예: "missing 2024Q4")

  (6) 통화/단위 가드
       - forward_metrics에서 current_price와 EPS의 통화/스케일 검증
       - yfinance Ticker.fast_info["currency"]를 활용
       - 미스매치 시 None 반환 + logger.warning, 예외 전파 금지

  (7) 테스트 — tests/test_forward_metrics.py 확장 + 신규 파일

       tests/test_kr_consensus.py 신규:
         - tests/fixtures/naver_finance_000660.html 픽스처 저장
         - NaverConsensusProvider가 픽스처에서 다음 분기 EPS 추출하는지
         - WiseReportProvider 동일 패턴 (fixture: comp_fnguide_A000660.html)
         - annualized_split: 연간 100,000 / 이미 실현 70,000 / 잔여 1분기 → 30,000

       tests/test_forward_metrics.py 확장:
         - SK하이닉스 회귀 테스트: provider chain을 모킹된 NaverConsensusProvider로
           주입하고 (다음 분기 EPS 12,000 반환), DART fetch도 모킹해 2025Q4·2026Q1
           반환. 결과 composition[3].source == "consensus" 또는
           "consensus_split_from_annual", 가장 최신 actual의 fiscal_period_end >=
           2025-12-31 확인
         - 미국 티커 회귀: AAPL이 v1과 동일한 결과를 내는지 (provider chain은 v1 그대로)
         - 통화 미스매치 시나리오: yfinance가 USD를 주고 EPS는 KRW일 때 None 반환

       모든 테스트는 외부 HTTP 호출 없이 PASS해야 합니다 (monkeypatch + fixture).

## 3단계 — 명시적으로 하지 말 것 (DESIGN §5)

  - playwright/selenium 등 헤드리스 브라우저 도입 금지 (requests + BeautifulSoup만)
  - 한경컨센서스 PDF 파싱 + LLM 추출 금지 (메타까지만)
  - 계절성 가중 분배 금지 (단순 균등만)
  - 미국 티커의 분기 시계열 보강 금지 (한국만)
  - 프론트엔드(app/frontend) 변경 금지
  - v1의 FinancialMetrics, get_financial_metrics 시그니처 변경 금지
  - 추정치 어댑터에서 예외 전파 금지 (빈 리스트 + 경고만)

## 4단계 — 검증 (PR 올리기 전 모두 통과 필수)

  $ cd ai-hedge-fund
  $ poetry run pytest tests/ -x
       → 기존 테스트 + v1 테스트 + 신규 테스트 모두 PASS
  $ poetry run pytest tests/test_forward_metrics.py tests/test_kr_consensus.py -v
       → 신규 케이스 모두 PASS

DESIGN.md §7 Acceptance Criteria의 8개 항목이 모두 통과해야 PR 가능.

수동 확인 (선택):
  - 데이터 샌드박스에서 000660.KS, 2026-05-09 조회 시 composition 마지막 원소가
    consensus 또는 consensus_split_from_annual 인지 눈으로 확인
  - confidence가 medium 이상으로 올라왔는지

## 5단계 — PR 메시지 형식

제목:
  feat(forward-per): wire Korean consensus + DART quarterly backfill

본문 머리:
  Implements docs/forward_per/v2_kr_consensus/DESIGN.md.
  Resolves: SK하이닉스/삼성전자/네이버 등 KR 종목에서 forward PER이
  trailing-only로 떨어지던 문제 + 분기 시계열 결손.

본문에 반드시 포함:
  - 어떤 한국 provider가 실제 구현되고 어떤 게 stub인지
  - DART 분기 EPS 역산 로직 요약
  - DESIGN §7 체크리스트 결과
  - 회귀: 미국 티커 동작 동일성 증빙 (테스트 결과)
  - 알려진 한계 (HTML 구조 변경 위험, 계절성 미반영, PDF 미파싱)

## 6단계 — 막힐 때

설계 문서로 답이 안 나오는 의사결정이 생기면 추측해 진행하지 말고, 답이 필요한 질문 목록을 먼저 정리해서 멈추세요. 특히 외부 사이트 HTML 구조는 추측하지 말고 실제 페이지를 fetch해 픽스처로 저장한 뒤 거기에 맞춰 파서를 작성하세요.

이제 0단계의 진단을 머릿속에 박은 채 1단계부터 시작하세요.
```
