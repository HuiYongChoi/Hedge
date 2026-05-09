# Codex 인계 프롬프트 (그대로 복사 → 붙여넣기)

> 아래 코드 블록 안 내용을 통째로 코덱스에 붙여넣으면 됩니다.
> 작업 디렉토리는 `ai-hedge-fund/`로 들어간 뒤 시작.

---

```text
당신은 ai-hedge-fund 프로젝트에서 "Forward TTM EPS / Forward PER" 기능을 구현합니다.

## 1단계 — 먼저 읽기 (생략 금지)

다음 파일을 순서대로 읽고 전체 설계와 제약을 머리에 넣으세요:

  1. docs/forward_per/DESIGN.md            ← 전체 설계, 알고리즘, 가중치 표, Acceptance Criteria
  2. docs/forward_per/skeleton/data/models_forward.py
  3. docs/forward_per/skeleton/tools/estimates_api.py
  4. docs/forward_per/skeleton/tools/forward_metrics.py
  5. CLAUDE.md                              ← 프로젝트 운영 규칙
  6. src/tools/api.py                       ← 기존 트레일링 메트릭 진입점 (특히 get_financial_metrics, get_prices, get_market_cap, _is_korean_ticker)
  7. src/data/models.py                     ← FinancialMetrics 정의
  8. src/data/cache.py                      ← Cache 클래스 구조
  9. src/agents/valuation.py                ← 1차 통합 타깃
 10. src/agents/fundamentals.py             ← 1차 통합 타깃
 11. src/agents/peter_lynch.py              ← P/E·PEG 사용 예시 (참고)

설계 문서를 읽지 않고 코드부터 작성하지 마세요. 모르는 것이 있으면 본문 §7 "참고 — 기존 코드 후크" 섹션의 라인 번호를 따라가서 먼저 확인하세요.

## 2단계 — 구현 범위 (이번 PR에서 할 것)

DESIGN.md §3 "구현 순서"의 1~6번까지만 이번 PR에 포함합니다. 7~8번(나머지 페르소나 통합, 문서 업데이트)은 후속 PR입니다.

구체적으로:

  (1) src/data/models_forward.py 신설
       — docs/forward_per/skeleton/data/models_forward.py 를 그대로 src 트리로 옮기되,
         스켈레톤 안에 명시된 validator/검증 TODO를 채우세요.

  (2) src/tools/estimates_api.py 신설
       — 스켈레톤을 옮기고, FMPEstimateProvider 와 YFinanceEstimateProvider 두 개만
         실제로 구현하세요. KrFnGuideProvider, LLMEstimateProvider 는 stub 그대로 두되
         빈 리스트를 반환하고 INFO 로그만 남기세요.
       — import 경로는 src 기준으로 수정 (skeleton의 상대 import 주석 참고).
       — FMP 키는 os.environ["FMP_API_KEY"]에서 읽고, 없으면 YFinance로 폴백.
       — 어떤 provider도 예외를 전파하지 않습니다 (logger.warning + 빈 리스트).

  (3) src/tools/forward_metrics.py 신설
       — 스켈레톤을 옮기고, raise NotImplementedError 로 표시된 모든 helper를 구현.
       — _load_trailing_quarterly_eps, _latest_close, _trailing_only_fallback 핵심.
       — 캐시는 모듈-레벨 dict로 시작. 분리된 캐시 객체로 발전시키지 마세요 (DESIGN §4).

  (4) src/data/cache.py 확장
       — get_forward_metrics(key) / set_forward_metrics(key, ForwardMetrics) 메서드 추가.
       — 키는 "{ticker}_{as_of_iso}" 형식. 기존 _merge_data 패턴을 따르지 말고
         단순 dict 덮어쓰기로 충분 (forward는 하루 단위 스냅샷).

  (5) tests/test_forward_metrics.py 신설
       — DESIGN.md §6 Acceptance Criteria 7개 항목을 1:1로 테스트 케이스화.
       — provider는 페이크/모킹으로 주입 (forward_metrics에 providers 인자 있음).
       — 실제 네트워크 호출은 하지 마세요. monkeypatch로 get_financial_metrics,
         get_prices를 모킹.

  (6) src/agents/valuation.py + src/agents/fundamentals.py 통합
       — get_forward_metrics(ticker, as_of_date=end_date) 호출.
       — 시그널 reasoning에 trailing_pe 와 forward_pe 둘 다 노출.
       — DESIGN.md §2.4 가중치 표를 따르되, 둘 다 0.5/0.5로 시작.
       — confidence == "low" 인 경우 forward 가중치를 0으로 강등 (가드).

## 3단계 — 명시적으로 하지 말 것

- 기존 src/data/models.py 의 FinancialMetrics 변경 금지.
- 기존 src/tools/api.py 의 get_financial_metrics 시그니처/동작 변경 금지.
- 한국 에프앤가이드/와이즈에프엔 실제 호출 구현 금지 (stub만).
- LLM 폴백 실제 호출 구현 금지 (stub만, NotImplementedError 그대로 둬도 무방하나 호출 시 빈 리스트 반환).
- 프론트엔드(app/frontend) 변경 금지.
- 이번 PR에서 워런 버핏 등 나머지 페르소나 통합 금지.
- 분기 발표 캘린더 통합 금지 (TTL은 1일 고정).
- EPS 정의 정규화(GAAP↔Adjusted) 금지 — 1차에선 notes 경고만.

## 4단계 — 검증 (PR 올리기 전 반드시 통과)

  $ cd ai-hedge-fund
  $ poetry install        # 또는 기존 환경 활성화
  $ poetry run pytest tests/ -x
       → 기존 테스트가 모두 그대로 통과해야 함 (회귀 없음).
  $ poetry run pytest tests/test_forward_metrics.py -v
       → 신규 케이스 7건 모두 PASS.

DESIGN.md §6 Acceptance Criteria 체크리스트의 모든 항목이 통과해야 PR 가능.

## 5단계 — PR 메시지 형식

제목:
  feat(forward-per): add forward TTM EPS + forward PER data layer

본문 머리:
  Implements docs/forward_per/DESIGN.md §3 steps 1–6.
  Out of scope (follow-up PR): persona-wide integration (step 7), docs (step 8).

본문에 반드시 포함:
  - 어떤 provider가 실제 구현되었고 어떤 게 stub인지
  - DESIGN §6 체크리스트 결과
  - 테스트 실행 결과 요약
  - 알려진 한계 (예: 한국 종목은 confidence="low"로만 동작)

## 6단계 — 막힐 때

설계 문서로 답이 안 나오는 의사결정이 생기면, 추측해서 진행하지 말고 답이 필요한 질문 목록을 먼저 정리해서 멈추세요. 추측해서 만든 코드보다 정확한 질문이 훨씬 가치 있습니다.

이제 1단계부터 시작하세요.
```

---

## 참고: 이 프롬프트로 코덱스가 만들어낼 산출물

- 신규 파일 5개:
  - `src/data/models_forward.py`
  - `src/tools/estimates_api.py`
  - `src/tools/forward_metrics.py`
  - `tests/test_forward_metrics.py`
- 수정 파일 3개:
  - `src/data/cache.py` (forward 캐시 메서드 2개 추가)
  - `src/agents/valuation.py` (forward PER 통합)
  - `src/agents/fundamentals.py` (forward PER 통합)

후속 PR 1건이 따라옵니다 (나머지 페르소나 7~9개 통합 + CLAUDE.md/agents.md 문서 업데이트).
