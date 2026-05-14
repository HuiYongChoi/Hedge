# 소넷에게 줄 자연어 프롬프트 (복붙용)

아래 텍스트를 그대로 소넷에게 붙여넣으면 된다.

---

`docs/ui/analyst_report_v5/DESIGN.md` 읽고, 거기 §13 의 Phase 1 작업만
구현해줘.

핵심 요약:

- 현재 `analyst-report-dashboard.tsx` 의 6-panel grid 를 **문서형 리포트**
  레이아웃으로 교체한다. 참조 스크린샷은 MU · 애스워스 다모다란 분석 화면이고,
  설계안 §2 의 3-컬럼 IA (좌측 TOC + 본문 + 우측 핵심 타겟 데이터 사이드바) 를
  따른다.
- 컬럼 1 (플로우 사이드) 은 만들지 마라 — 이미 tabs 가 한다.
- §10 의 파일 구조대로 `app/frontend/src/components/reports/analyst-report-v5/`
  폴더를 만들고 9 개 컴포넌트 + helpers.ts 를 짠다.
- 본문은 §4 처럼 numbered evidence item 으로, 숫자는 §4.3 의 정규식으로 자동
  InlineDataChip 으로 감싸기, 인용은 §4.4 의 휴리스틱으로 자동 `[a]` 삽입.
- 우측 사이드바는 §6 처럼 active agent report 에서 핵심 숫자 7 개 추출 + 다른
  에이전트 신호 4–5 개.
- WACC × g 민감도 매트릭스는 §7 — 데이터가 있을 때만 렌더하는 컴포넌트만 만들고,
  지금은 사실상 안 보임. backend 수정 금지.
- PDF 버튼은 disabled, "원문 대조" 는 기존 detail-report-view 트리거 재사용.
- §9 의 i18n 키 전부 ko + en 추가.

작업 순서는 §13 Phase 1 의 1→14 그대로 따르고, 마지막에 §14 의 수용 기준이 다
충족되는지 확인해줘. 테스트는 §12 의 신규 static 테스트 2 개 추가 + 기존
`test_stock_search_final_decision_ui_static.py` 의 6-panel 검사를 v5 컴포넌트
import 검사로 교체.

검증 단계 (CLAUDE.md §4 참고):

```bash
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q
cd app/frontend
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/typescript/bin/tsc --noEmit
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/vite/bin/vite.js build
```

다 통과한 다음 1 개 커밋 (`feat(report): document-style v5 report layout
(TOC + inline citations + target sidebar)`) 으로 origin/main 에 푸시하고,
로컬에서 `./deploy_aws.sh` 까지 돌려서 서버 배포까지 끝내고, 마지막에 §14
체크리스트 형식으로 결과만 알려줘.

주의:

- `git add .` 절대 금지. §13 작업 파일만 명시 stage.
- backend (src/, app/backend/) 는 건드리지 마라. 모든 변경은 frontend + tests
  만.
- 기존 sentiment marker (`[+][-][~][?]`) 처리는 `report-sentiment-dashboard.tsx`
  의 헬퍼를 재활용해라. 중복 구현 금지.
- 한 줄에 InlineDataChip 이 4 개 이상이면 4 번째부터는 칩 처리 skip (§15-2).
- §11 의 helpers.ts 함수들은 모두 순수 함수로 짜고, 별도로 작은 정규식 단위
  테스트가 가능하게 export 해라.
