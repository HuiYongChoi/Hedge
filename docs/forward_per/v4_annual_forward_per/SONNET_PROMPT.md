# Sonnet 핸드오프 프롬프트 (v4 + 대시보드 재설계 + 배포 포함)

작업 디렉토리: `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund`
현재 HEAD: `d515d53 fix(ui): merge orphan report checklist numbers`

## 미션 (한 문장)
`docs/forward_per/v4_annual_forward_per/DESIGN.md` 의 §1-13 전부를 한 번에 구현하고,
테스트·빌드까지 통과한 뒤 직접 커밋·푸시·서버 배포까지 끝낸다.

## 가장 먼저 읽을 것
1. `docs/forward_per/v4_annual_forward_per/DESIGN.md` ← 전체 명세 (필수)
2. `CLAUDE.md` ← 커밋/푸시/배포 절차

그 다음 코드:
- `src/data/models_forward.py`
- `src/tools/forward_metrics.py`
- `src/tools/estimates_api.py`
- `src/tools/kr_consensus/naver_finance.py`, `src/tools/kr_consensus/annualized_split.py`
- `src/utils/forward_outlook.py`
- `src/agents/valuation.py`
- `app/backend/routes/hedge_fund.py`
- `app/frontend/src/components/tabs/data-sandbox-tab.tsx`
- `app/frontend/src/components/tabs/stock-search-tab.tsx`
- `app/frontend/src/data/agents.ts`
- `app/frontend/src/lib/language-preferences.ts`
- 기존 정적 테스트: `tests/test_forward_metrics_datasandbox_static.py`

## 작업 단위 (이 순서로)
1. **연간 Forward PER 데이터 계층** — DESIGN.md §1~5 (모델 + 3개 provider + 합성 + 오버라이드 + 에이전트 페이로드)
2. **Data Sandbox 카드 확장** — DESIGN.md §6~7 (TTM tile 옆 연간 FY0/FY+1 tile 추가, i18n)
3. **새 분석 리포트 대시보드** — DESIGN.md §11 (6-패널 그리드 + 헤더 + 분석가 strip + 크로스체크 체크리스트)
4. **테스트 추가/확장** — DESIGN.md §8 + §11.7
5. **빌드 검증** — pytest + tsc + vite build 전부 통과
6. **커밋 2개** — DESIGN.md §13.1
7. **GitHub push** — §13.2
8. **`./deploy_aws.sh` 로컬에서 실행** — §13.3
9. **smoke check + 보고** — §13.4

## Acceptance (전부 만족해야 종료)
DESIGN.md §9 의 1~5번 + §12 의 6~11번.

요약하면:
- `pytest tests/ --ignore=tests/backtesting -q` 통과
- 프론트 `tsc` + `vite build` 통과
- `/hedge-fund/fetch-metrics` 가 `forward_pe_fy0`, `forward_pe_fy1` 채워서 응답 (MU 기준)
- Data Sandbox Forward PER 카드에 TTM + 연간 2 tile 보임, 오버라이드 동작
- 종목 분석 탭이 6-패널 대시보드 + 분석가 strip 으로 렌더됨
- 분석가 strip 클릭 시 헤더/Thesis/Verdict 가 그 분석가 기준으로 갱신
- Cross-check 체크 상태는 ticker 단위로 localStorage 영속
- 2개 커밋이 origin/main 에 푸시되고, 서버 HEAD 가 동일 sha, `curl -I http://54.116.99.19/hedge/` 가 200

## 절대 금지
- TTM 4-분기 composition validator, `_blend_trailing_forward_pe` 가중치 변경.
- `git add .` 또는 무관한 dirty 파일(`docs/forward_per/README.md`, `tmp/`, `docs/ui/`, `docs/agents/`) stage.
- `git commit --amend`, force push, `git reset --hard`.
- `--no-verify`, `--no-gpg-sign` 등 훅/서명 스킵.
- 서버에 SSH 로 들어가서 `./deploy_aws.sh` 실행 (반드시 로컬에서).
- 새 npm / pypi 의존성 추가.
- 새 백엔드 엔드포인트 추가.
- 기존 빈 상태/에러 처리 UI 회귀.

## 막혔을 때
- 외부 API (FMP, Naver, YFinance) 가 네트워크 오류면 mock fixture 로 단위 테스트만 통과시키고
  실제 호출은 try/except 로 무해하게 떨어뜨릴 것. forward_pe_fy0/fy1 가 None 이면 카드가
  "연간 컨센서스 없음" placeholder 로 렌더되어야 한다.
- `gh auth` 가 만료됐으면 CLAUDE.md §B 의 임시 `GIT_ASKPASS` 패턴 사용. PAT 를 코드/커밋/로그에
  남기지 말 것.
- `./deploy_aws.sh` 가 npm install 단계에서 실패하면 `NODE_OPTIONS=--max-old-space-size=4096`
  가 셸에 export 됐는지 확인.

## 보고 양식
끝나면 다음을 정확히 출력:
- 두 커밋 sha + 메시지 1줄
- `origin/main` 과의 동기화 검증 결과 (`0  0` 이어야 함)
- 서버 HEAD sha
- `pytest -q` 마지막 줄
- `tsc` / `vite build` 성공 여부
- `curl -I http://54.116.99.19/hedge/` HTTP 상태
- 대시보드 레이아웃 한 줄 묘사
