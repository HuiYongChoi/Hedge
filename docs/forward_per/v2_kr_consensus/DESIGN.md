# v2 — 한국 종목 Forward PER 보완 설계

> 전제: v1 (`../v1_done/`)이 이미 머지되어 trailing-only fallback이 작동 중.
> v2 목표: 한국 상장주에 대해 **증권사 컨센서스 EPS**가 실제로 합성에 들어가도록, 그리고 분기 시계열 자체의 누락/지연 문제를 함께 해결한다.

---

## 0. 동기 — 현재 어떤 화면이 나오는가 (SK하이닉스, 2026-05-09 기준)

| 항목 | 현재 화면 | 무엇이 잘못됐나 |
|---|---|---|
| Forward TTM EPS | 46.77K | 미래 분기가 0개 — 그냥 트레일링이다 |
| Forward PER | 36.05x | 현재가/트레일링EPS와 동일. 의미 없음 |
| Composition | 2024Q3, 2025Q1, 2025Q2, 2025Q3 (모두 actual / YFinance) | **2024Q4 누락**, **2025Q4·2026Q1 누락**. 가장 최신이 8개월 전 |
| 컨센서스 | 0개 (`no consensus estimate available`) | KrFnGuide=stub, LLM 폴백 미구현 → 한국 종목은 항상 trailing-only로 떨어짐 |
| Confidence | low | 정확하지만 영구적으로 low인 상태 |

문제는 두 갈래로 분리되며 **둘 다 고쳐야 한다**:

- **문제 A — 컨센서스 데이터 부재**: 한국 종목용 provider가 비어 있다.
- **문제 B — 분기 시계열 결손**: yfinance가 한국 종목의 분기 EPS를 띄엄띄엄 반환한다. 이걸 그대로 두면 컨센서스가 들어와도 forward TTM = `Q_{n-2} + Q_{n-1} + Q_n + Q_{n+1}` 의 actual 3개가 너무 오래된 분기로 채워져 의미가 흐려진다.

---

## 1. 설계 원칙

1. **v1 인터페이스 보존.** `get_forward_metrics()` 시그니처/반환 모델은 그대로. 내부만 보강.
2. **소스 어댑터는 추가, 기존 어댑터는 미이동.** v1의 `FMP/YFinance/LLM-fallback`은 그대로 두고, 한국 라우팅에 들어갈 새 provider 클래스를 추가한다.
3. **연간→분기 분배는 명시적.** 한국 컨센서스는 보통 "2026E EPS 100,000원" 형태(연간). 분기 EPS를 직접 못 받으면 분배 helper가 actual 분기를 빼고 잔여 분기 수로 나눈다. `composition[].source`는 `"consensus_split_from_annual"`로 별도 표기.
4. **분기 시계열은 다중 소스 합성.** yfinance만 믿지 않는다. yfinance → DART 분기보고서 → FnGuide 표 순서로 누락 분기를 보강한다.
5. **사이트 의존을 격리한다.** 모든 외부 HTML/PDF 파싱은 어댑터 한 클래스에 가둔다. requests + BeautifulSoup 의존만 추가, 무거운 헤드리스 브라우저는 1차 비-범위.
6. **모든 외부 호출은 캐시.** 사이트 robots.txt 위반 위험 + 속도. 1일 TTL.

---

## 2. 데이터 소스 결정 트리 (한국 종목)

| 우선 | 소스 | 데이터 | 1차 PR 구현 | 비고 |
|---|---|---|---|---|
| 1 | **네이버 금융 종목 페이지** (`finance.naver.com/item/main.naver?code=000660`) | 추정 EPS (연간 2026E/2027E + 일부 분기) | ✅ 실 구현 | HTML 표 안정적, 무료. robots/속도 유의 |
| 2 | **WiseReport** (`comp.fnguide.com/SVO2/asp/SVD_Main.asp?gicode=A000660`) | 분기/연간 추정 EPS, 매출, 영업이익 | ✅ 실 구현 | FnGuide 무료 포털. 분기 컨센서스 노출 가능 |
| 3 | **한경컨센서스** (`consensus.hankyung.com`) | 증권사 리포트 PDF + 메타 | ⚠️ 메타만 (PDF는 v3) | 다음 분기 EPS 추출은 LLM 비용↑ |
| 4 | **DART 분기보고서** | actual 분기 EPS (시계열 보강용 — 컨센서스 X) | ✅ 실 구현 | `dart_api.py` 확장. **문제 B 해결의 핵심** |
| 5 | **트레일링 폴백** (v1) | — | (그대로) | 위 1~3 모두 실패 시 |

라우팅 (`_is_korean_ticker(ticker)` true일 때):
```
[NaverConsensusProvider, WiseReportProvider, HankyungMetaProvider, LLMEstimateProvider]
```

---

## 3. 두 갈래 알고리즘 보완

### 3.1 문제 A 해결 — `KrConsensusProvider` 패키지 신설

```
src/tools/kr_consensus/
├── __init__.py
├── naver_finance.py          # NaverConsensusProvider
├── wise_report.py            # WiseReportProvider
├── hankyung.py               # HankyungMetaProvider (1차는 stub 가깝게, 메타만)
└── annualized_split.py       # 연간 추정 EPS → 다음 분기 EPS 분배 helper
```

**`NaverConsensusProvider` 동작**:
1. `https://finance.naver.com/item/main.naver?code={6자리}` 호출 (티커가 `005930.KS`면 `005930`).
2. 추정실적 컨센서스 표 파싱 (보통 "기업실적분석" / "Financial Summary" 영역에 분기/연간 추정치 포함).
3. 다음 분기 EPS가 **직접 노출**되면 그대로 `QuarterlyEPS(source="consensus", provider="NaverFinance")` 반환.
4. 분기 추정이 없고 연간만 있으면 `annualized_split`로 변환 후 `source="consensus_split_from_annual"`.

**`annualized_split.split_annual_to_next_quarter()`**:
- 입력: `annual_eps_estimate`, 해당 회계연도 안에서 이미 발표된 actual 분기 리스트.
- 잔여 분기 수 `R = 4 - len(actuals_in_year)`.
- 단순 분배: `next_q_eps = (annual_eps - sum(actuals_in_year)) / R`.
- 옵션(2차): 직전 연도 같은 분기의 비중으로 가중 분배 (계절성).
- 1차에는 단순 분배만.

**컨센서스 신선도**:
- 페이지에서 `갱신일자` 또는 `as of` 텍스트를 추출. 못 찾으면 fetch 시각을 `as_of`로.
- 45일 초과 시 `notes`에 경고 + confidence 강등.

### 3.2 문제 B 해결 — 분기 시계열 다중 소스 합성

`src/tools/forward_metrics.py::_load_trailing_quarterly_eps()`를 다음과 같이 보강:

```
1. yfinance에서 분기 EPS 시계열 (지금 동작) → 후보 리스트 A
2. _is_korean_ticker(ticker)이면 DART 분기보고서/반기보고서/사업보고서에서 분기 EPS 추출 → 후보 리스트 B
   (반기/사업보고서에서는 [반기 - 1Q] 또는 [연간 - 9개월]으로 단일 분기 EPS 역산)
3. A∪B를 fiscal_period_end로 deduplicate, B 우선 (DART는 official)
4. 기준일 as_of로부터 ≤ 9개월 안의 분기가 4개 이상 모이는지 검증
5. 누락 분기가 있으면 ForwardMetrics.notes에 명시 ("missing 2024Q4, 2025Q4")
6. 가장 최신 actual의 fiscal_period_end가 as_of로부터 6개월 이상 떨어졌으면 confidence를 한 단계 강등
```

이걸로 SK하이닉스의 경우:
- yfinance가 2024Q3 / 2025Q1~Q3만 줘도, DART에서 2024Q4 / 2025Q4 / 2026Q1을 보충
- 직전 3분기 actual = 2025Q3 / 2025Q4 / 2026Q1
- 다음 분기 (2026Q2) consensus = 네이버 금융에서 가져온 EPS

### 3.3 통화/단위 가드

`forward_metrics`에 다음 검증 추가:
- `current_price` 단위 ≡ `eps` 단위 (KRW per share).
- yfinance는 `Ticker(...).fast_info["currency"]`로 검증.
- 미스매치 시 변환 시도 → 실패하면 `None` 반환 + 경고.

### 3.4 모델 보강 — `src/data/models_forward.py`

```python
QuarterlyEPS.source: Literal[
    "actual",
    "consensus",
    "consensus_split_from_annual",  # NEW
    "guidance",
    "llm_extracted",
]

ForwardMetrics.currency: str = "USD"   # NEW, default 기존 동작 유지
ForwardMetrics.notes: list[str]        # 기존 — 진단 메시지 명시 사용
```

---

## 4. 구현 순서

1. **모델 보강** — `models_forward.py`에 `currency`, source enum 확장.
2. **DART 분기 EPS 추출** — `src/tools/dart_api.py`에 `fetch_quarterly_eps_series(ticker, end_date, num_quarters)` 추가. 기존 `fetch_dart_metrics` 옆에.
3. **`kr_consensus` 패키지 신설** — `naver_finance.py` 우선 구현, `wise_report.py` 그 다음, `hankyung.py`는 메타만 (1차 stub-ish).
4. **`annualized_split` helper** — 단위 테스트로 검증.
5. **`estimates_api.py` 라우팅 교체** — 한국 티커일 때 `[NaverConsensusProvider, WiseReportProvider, HankyungMetaProvider, LLMEstimateProvider]` 체인.
6. **`forward_metrics._load_trailing_quarterly_eps` 보강** — DART 보조 소스 합성 + 누락/지연 진단 notes.
7. **통화 가드** — `current_price` ↔ `eps` 단위 검증.
8. **테스트**:
   - 단위: `annualized_split`, 네이버 HTML 파서 (HTML 픽스처 저장 후 mocking)
   - 통합: `005930.KS`, `000660.KS`, `035420.KS` 3종 — 컨센서스 1개 이상 들어왔는지, composition[3].source가 consensus 계열인지
   - 회귀: 미국 티커(AAPL, MSFT)는 v1 동작과 동일한지
9. **SK하이닉스 케이스 캡처 회귀 테스트** — 이미지의 입력(000660.KS, 2026-05-09)을 fixture로 박아 두고, 결과 composition의 가장 최신 actual이 2025Q3보다 신선한지 + consensus가 1개 들어가는지 PASS 조건으로.

---

## 5. 명시적 비-범위 (v2에서 하지 않을 것)

- 헤드리스 브라우저(playwright/selenium) 도입 — 1차는 requests + bs4만.
- 한경컨센서스 PDF 파싱 → LLM 추출 — v3로 미룸 (메타까지만).
- 계절성 가중 분배 — 단순 균등 분배만.
- 미국 티커의 분기 시계열 보강 (FMP에 DART 같은 보조소스 도입) — 미국은 yfinance/FMP가 충분.
- 프론트엔드 라벨/툴팁 변경 — 백엔드 데이터 파이프라인까지만. (UI는 백엔드 변화에 자동 반응)

---

## 6. 리스크 / 대응

| 리스크 | 대응 |
|---|---|
| 네이버 금융 HTML 구조 변경 | 파서를 단일 함수로 격리, 실패 시 빈 리스트 + 경고. WiseReport로 자동 폴백. 픽스처로 회귀 테스트 |
| robots.txt / 트래픽 매너 | User-Agent 명시, 1초 sleep, 1일 캐시. 동일 종목 동일 날짜 1회만 호출 |
| 연간→분기 분배의 부정확성 | `source="consensus_split_from_annual"`로 명시 노출. 에이전트 프롬프트가 "분기 분배 추정"임을 알 수 있게 |
| DART 분기보고서 게시 지연 | as_of - 가장 최신 분기가 6개월 초과 시 confidence 강등 |
| 통화 미스매치 | 명시 가드 + 실패 시 None 반환 |

---

## 7. Acceptance Criteria

v2 PR이 머지되려면 다음이 모두 PASS:

- [ ] `get_forward_metrics("000660.KS", as_of="2026-05-09")`의 `composition` 마지막 원소 `source ∈ {consensus, consensus_split_from_annual}`.
- [ ] 같은 호출에서 `composition[2].fiscal_period_end ≥ 2025-12-31` (즉 가장 최신 actual이 2025Q4 이후).
- [ ] `confidence` 가 `medium` 이상 (신선한 컨센서스 + 신선한 actual).
- [ ] `notes` 에 누락 분기가 있었다면 명시되어 있다.
- [ ] `005930.KS`(삼성전자), `035420.KS`(네이버) 동일하게 컨센서스 1개 이상 합성됨.
- [ ] 미국 티커(AAPL/MSFT)의 결과는 v1 acceptance와 동일 (회귀 없음).
- [ ] 외부 HTTP 의존 없는 단위 테스트가 모두 PASS (네이버 HTML 픽스처 사용).
- [ ] 어떤 외부 소스도 예외 전파하지 않음 (실패 시 빈 리스트 + 경고).

---

## 8. 참고 — 기존 코드 후크

- `src/tools/dart_api.py` — `fetch_dart_metrics()` 패턴 그대로 따라 분기 시계열 함수 추가
- `src/tools/api.py:200 _is_korean_ticker()` — 라우팅 키
- `src/tools/api.py:864 get_financial_metrics(period="quarter")` — yfinance 분기 시계열 진입점 (보강 시 같이 사용)
- `src/tools/forward_metrics.py::_load_trailing_quarterly_eps` — v1에서 만들어진 함수, v2에서 보강
- `src/tools/estimates_api.py::default_provider_chain` — 한국 분기에 새 체인 주입
- `src/data/models_forward.py` — `QuarterlyEPS.source` literal 확장, `ForwardMetrics.currency` 추가
