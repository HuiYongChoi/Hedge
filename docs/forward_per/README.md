# Forward TTM EPS / Forward PER 작업 패키지

직전 3분기 발표치 + 다음 1분기 컨센서스 예측치를 합성한 **Forward TTM EPS / Forward PER**을 모든 애널리스트 에이전트가 트레일링 지표와 함께 참고할 수 있도록 하는 기능입니다.

## 폴더 구조

| 폴더 | 상태 | 내용 |
|---|---|---|
| [`v1_done/`](./v1_done/) | ✅ 머지 완료 | 데이터 모델 + FMP/yfinance provider + 합성 함수 + valuation/fundamentals 통합 |
| [`v2_kr_consensus/`](./v2_kr_consensus/) | ✅ 머지 완료 | 한국 종목 컨센서스 provider (Naver/WiseReport) + DART 분기 시계열 보강 |
| [`v3_agent_integration/`](./v3_agent_integration/) | 🟡 설계 완료 / 구현 대기 | 14개 personality 에이전트 LLM 프롬프트에 forward outlook 표준 블록 주입 + state 캐싱 |

## 진행 흐름

1. **v1**: trailing-only fallback 포함 기본 파이프라인 구축 → 머지 완료.
2. **v2**: 한국 종목 컨센서스 provider + DART 분기 시계열 보강 → 머지 완료.
3. **v3** (현재): forward 데이터가 personality 에이전트(Damodaran, Buffett 등) LLM 보고서에 반영되지 않는 문제 해결. 공통 헬퍼 + state 캐싱으로 일괄 주입.
4. **v4** (예정, 미설계): personality별로 forward를 다르게 해석 (Lynch=PEG, Buffett=owner earnings × growth 등), 한경컨센서스 PDF + LLM 추출.

## 인계 프롬프트

각 단계마다 그대로 복붙하면 되는 인계 프롬프트가 들어 있습니다:

- v1: [`v1_done/CODEX_PROMPT.md`](./v1_done/CODEX_PROMPT.md) (사용 완료)
- v2: [`v2_kr_consensus/SONNET_PROMPT.md`](./v2_kr_consensus/SONNET_PROMPT.md) (사용 완료)
- v3: [`v3_agent_integration/CODEX_PROMPT.md`](./v3_agent_integration/CODEX_PROMPT.md) ← **다음 작업**

## v3 — 왜 필요한가 (한 줄 요약)

> v2까지 forward EPS/PER 파이프라인은 정확하지만, Damodaran 등 14개 personality 에이전트가 `get_forward_metrics`를 전혀 호출하지 않아 LLM 보고서가 trailing 5년 데이터에만 머문다. v3가 공통 헬퍼 + state 캐싱으로 모든 에이전트의 LLM 입력에 forward outlook 표준 블록을 주입한다.
