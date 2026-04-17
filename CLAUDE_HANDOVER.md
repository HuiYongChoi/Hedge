# Claude Code 인계 사항 (Handover Document)

## 현재 작업 목표
AI 헤지펀드 애플리케이션의 **완전한 한국어 현지화(Localization)** 및 **포트폴리오 매니저 모듈의 Gemini API Quota 초과(429 Error)로 인한 무한 로딩/에러 문제 해결**입니다.

## 현재까지 진행된 작업 (완료된 부분)
1. **백엔드 (분석가 메타데이터 현지화 체계 구축)**
   - 파일: `src/utils/analysts.py`
   - 내용: `ANALYST_CONFIG` 딕셔너리에 각 에이전트(애널리스트)별로 `display_name_ko`, `description_ko`, `investing_style_ko` 필드를 추가하여 한국어 번역 사전을 백엔드 하드코딩으로 구축했습니다.
   - 내용: API 응답을 반환하는 `get_agents_list()` 함수가 이 한국어 필드를 포함하여 반환하도록 수정했습니다.

2. **프론트엔드 (타입 정의 업데이트)**
   - 파일: `app/frontend/src/data/agents.ts`
   - 내용: `Agent` 인터페이스에 추가된 한국어 필드(`display_name_ko`, `description_ko`, `investing_style_ko`)를 Optional 타입으로 추가했습니다.

## 다음 진행할 작업 (Claude Code가 이어서 해야 할 부분)

### 1. 프론트엔드 노드 UI 한국어 반영 (Flow Context & Node Components)
- `getAgents()` API를 통해 받아온 `display_name_ko`, `description_ko` 데이터를 사이드바 컴포넌트 추가 시나 노드가 렌더링될 때 활용해야 합니다.
- 파일: `app/frontend/src/contexts/flow-context.tsx` 
  - `addComponentToFlow` 함수에서 노드를 생성할 때, 현재 상태(`useLanguage` 훅으로 가져온 언어 설정 등)에 따라 노드의 `data.label` 및 `data.description`에 한국어 데이터를 주입하도록 개선해야 합니다.
- 파일: `app/frontend/src/nodes/components/agent-node.tsx` 등 관련 UI
  - 언어 설정 변경 시 실시간으로 한국어 이름과 설명이 반영되도록 로직을 추가하거나 수정하세요.

### 2. 포트폴리오 매니저 (Portfolio Manager) 429 에러 예외 처리 개선
- 무료 제공되는 Gemini API 쿼터(분당/일일 제한)를 쉽게 초과하여 429 에러가 발생하면, 포트폴리오 매니저 노드가 무한 In Progress 상태가 되거나 500/503 에러로 튕기는 문제입니다.
- 파일: `src/agents/portfolio_manager.py` 및 `src/utils/llm.py`
  - 현재 `call_llm`에 `default_factory`가 작성되어 있어 실패 시 기본 "hold" 결정을 내리도록 되어 있으나, LangGraph의 `run_graph_async`를 거치는 동안 예외가 catch되지 않고 SSE stream으로 `ErrorEvent`가 전송되어 프론트엔드에서 뻗는 것으로 보입니다.
  - LLM 호출 실패 시 발생한 예외를 안전하게 catch하고 `default_factory`의 결과물(기본값)이 파이프라인에서 정상적인 응답 결과로서 매끄럽게 처리·반환되도록 하여 흐름이 끊기거나 에러 팝업을 내지 않게 조치하세요.

## 로컬 커밋 정보
- 이 문서와 함께 현재까지 변경된 모든 코드 사항을 로컬 Git에 Commit 해두었습니다. 이 시점부터 작업을 이어가면 됩니다.
