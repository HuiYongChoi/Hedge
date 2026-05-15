# 소넷에게 줄 자연어 프롬프트 (복붙용)

아래 텍스트를 그대로 소넷에게 붙여넣으면 된다. (CLAUDE.md §모델 사용 규칙: 분석/설계는 Opus, 반복 편집/리팩토링은 Sonnet.)

---

`docs/ui/valuation_rim_pbr/DESIGN.md` 를 처음부터 끝까지 읽고, 거기 §9 의
Phase 1 → Phase 2 → Phase 3 을 그대로 구현해줘.

핵심 요약:

- **목적**: SK하이닉스처럼 CapEx 가 큰 메모리 반도체 종목에서 현재 FCFF DCF 가
  내재가치를 50만 원대로 토하는 "CapEx 덫" 문제를, **RIM per-share 분해 표시**
  + **PBR Band** + **CapEx-aware regime 가중 자동 재조정** 으로 보완한다.
- **백엔드** (`src/agents/valuation.py`): §3 대로 `calculate_residual_income_breakdown`
  / `calculate_pbr_band` / `detect_capex_regime` 3 개 헬퍼 신규 작성 + 기존
  `valuation_analyst_agent` 의 weights 분기 + reasoning 출력 보강. 기존
  `calculate_residual_income_value` 는 호환을 위해 그대로 둔다.
- **프런트** (`app/frontend/src/components/reports/analyst-report-v5/`):
  §4 대로 `valuation-panel/` 폴더에 7 개 파일 신규 작성. report-section.tsx 의
  section-02 안, 기존 `SensitivityHeatmap` 아래에 mount.
- 컴포넌트는 **3 개 카드** 로 구성: ValuationComparisonCard (DCF·RIM·PBR Mid
  side-by-side) + RimDetailCard (BV/Excess/Terminal stacked bar + ROE/Ke/Spread
  stats) + PbrBandCard (SVG thermometer + 환산가 칩 + sparkline + 조건부
  rerating banner).
- §4.9 의 i18n 키 (ko + en) 전부 `lib/language-preferences.ts` 양쪽 사전에 추가.
- §3.5 의 reasoning JSON 계약을 정확히 맞추기. 프런트는 그 계약을 그대로 신뢰한다.
- regime 이 `capex_heavy` 일 때 weights 는 `{dcf 0.20, owner 0.25, ev 0.20,
  rim 0.20, pbr 0.15}`, 그 외에는 `{dcf 0.30, owner 0.30, ev 0.15, rim 0.10,
  pbr 0.15}`. PBR band 가 None 이면 그 가중치를 0 으로 떨어뜨리고 비례 재분배.
- 카드 3 개는 활성 agent 가 `valuation_analyst` 또는 `aswath_damodaran` 일 때만
  렌더. 다른 agent 활성 시 숨김.

작업 순서:

1. **Phase 1 (백엔드)** — §9 의 1~5 단계 그대로. pytest 그린 확인 후
   `feat(valuation): RIM breakdown, PBR band, CapEx-aware regime weights`
   커밋. 한 커밋으로 마무리.
2. **Phase 2 (프런트)** — §9 의 7~12 단계. tsc + vite build 그린 확인 후
   `feat(report): valuation deep-dive panel (DCF/RIM/PBR comparison + PBR band)`
   커밋.
3. **Phase 3 (배포)** — `git push origin main` → 로컬에서 `./deploy_aws.sh` →
   smoke check (curl + ssh). CLAUDE.md §4 절차 그대로.

검증 단계 (CLAUDE.md §4):

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q
cd app/frontend
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/typescript/bin/tsc --noEmit
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/vite/bin/vite.js build
```

마지막에 §8 의 수용 기준 체크리스트 9 개를 모두 충족했는지 점검하고, 충족 결과만
짧게 알려줘.

주의:

- `git add .` 절대 금지. §5 의 파일별 체크리스트에 적힌 경로만 명시 stage.
- 사용자의 dirty working tree (예: `docs/forward_per/README.md`,
  `docs/ui/...`, `tmp/`) 는 보존. 함부로 stash/discard 금지.
- 한국 종목 통화 단위는 KRW per share. abbreviation (M/B) 금지 — PBR band
  환산가 칩은 정확한 ₩ 가격을 표시한다. `formatPriceExact` 를 utils.ts 에 작성.
- recharts 의존성이 이미 있으면 sparkline 에 활용, 없으면 순수 SVG `<polyline>`
  으로 대체. `package.json` 수정 금지.
- RIM 의 `cost_of_equity` 는 우선 0.10 고정. WACC 와 동기화는 다음 라운드.
- `ri0 <= 0` 인 경우 RIM 은 BV 만 잡고 PV/Terminal 은 0 으로 두고 카드는 그래도
  렌더한다 (BV bar 만 100% 차지). signal 은 `neutral`.
- `book_value`, `bvps`, `shares_outstanding` 안전 fallback 로직은 §3.7 가드레일
  그대로.
- 컴포넌트 색 토큰은 기존 evidence-item.tsx 의 bullish/bearish/neutral 클래스 패밀리
  (`text-emerald-*`, `text-red-*`, `text-amber-*`) 만 사용. 새 팔레트 금지.
- 카드 모두 SSR 안전 (`window` 접근은 useEffect 안에서만).
- 새 pytest 2 개 (`test_valuation_rim_breakdown.py`, `test_valuation_pbr_band.py`)
  와 `test_analyst_report_v5_static.py` 의 추가 케이스 (`test_valuation_panel_files_exist`,
  `test_valuation_panel_i18n_keys_present`) 까지 모두 통과해야 한다.
- 실서비스 종목 검증은 `000660.KS`, `005930.KS`, `MU` 3 종으로 한다 (로컬에서
  돌릴 수 있으면 좋고, 못 돌리면 fixture 단위 테스트로 대체).

데이터/UX 가설 검증 (꼭 답해줘):

- §3.5 의 reasoning JSON 키가 실제로 `analyst_signals → valuation_analyst →
  {ticker}` 로 직렬화돼서 프런트에 도달하는 게 맞는지 (현재 코드 286~291 라인
  `valuation_analysis[ticker] = {"signal", "confidence", "reasoning"}` 구조와
  호환되는지) 한 줄로 명시.
- regime amber chip + rerating banner 가 실제로 SK하이닉스 fixture 에서 떴는지
  스크린샷 또는 텍스트 캡처로 확인.

작업 끝나면 §8 체크리스트 형식으로 결과만 알려줘. 부가 설명/요약 금지.
