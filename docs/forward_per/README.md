# Forward TTM EPS / Forward PER 작업 패키지

직전 3분기 발표치 + 다음 1분기 컨센서스 예측치를 합성한 **Forward TTM EPS / Forward PER**을 모든 애널리스트 에이전트가 트레일링 지표와 함께 참고할 수 있도록 하는 기능입니다.

## 폴더 구조

| 폴더 | 상태 | 내용 |
|---|---|---|
| [`v1_done/`](./v1_done/) | ✅ 머지 완료 | 데이터 모델 + FMP/yfinance provider + 합성 함수 + valuation/fundamentals 통합 |
| [`v2_kr_consensus/`](./v2_kr_consensus/) | 🟡 설계 완료 / 구현 대기 | 한국 종목 컨센서스 provider + DART 분기 시계열 보강 |

## 진행 흐름

1. **v1**: trailing-only fallback 포함 기본 파이프라인 구축 → 머지 완료.
2. **v2** (현재): 한국 종목에서 컨센서스가 들어오지 않아 forward의 의미가 없는 문제 해결. SK하이닉스/삼성전자/네이버 등 KOSPI 대형주에서 증권사 가이던스 기반 forward PER이 찍히도록.
3. **v3** (예정, 미설계): 한경컨센서스 PDF + LLM 추출, 계절성 가중 분배, 분기 발표 캘린더 기반 캐시 TTL.

## 인계 프롬프트

각 단계마다 그대로 복붙하면 되는 인계 프롬프트가 들어 있습니다:

- v1: [`v1_done/CODEX_PROMPT.md`](./v1_done/CODEX_PROMPT.md) (이미 사용 완료)
- v2: [`v2_kr_consensus/SONNET_PROMPT.md`](./v2_kr_consensus/SONNET_PROMPT.md) ← **다음 작업**

## v2 — 왜 필요한가 (한 줄 요약)

> 데이터 샌드박스에서 SK하이닉스 2026-05-09 조회 시 `composition` 4개가 모두 actual이고 가장 최신이 8개월 전(2025Q3) — 컨센서스 0개. forward라는 이름만 남고 실질은 stale trailing이다. v2가 이걸 고친다.
