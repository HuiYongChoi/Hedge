# Claude System Context & AI Architecture (claude.md)

이 문서는 추후 Claude 등 AI 어시스턴트가 프로젝트 구조를 파악하고 유지보수할 때 핵심 컨텍스트로 사용하기 위해 만들어졌습니다.

## Cluade 또는 Antigravity 내 model 사용시
- 분석/설계 단계만 Opus: Plan 또는 general-purpose 서브에이전트를 model: "opus"로 호출해 청사진 작성.
- 반복적 코드 편집/리팩토링: 변경 범위가 정해지면 Agent(general-purpose, model: "sonnet")에게 "이 파일들을 이렇게 수정해라"라고 명세를 통째로 넘겨 위임.
- 단순 검색/검증/grep/AST 파싱: Agent(Explore, model: "haiku")에게 위임.
- 메인 세션은 조율자 역할: 직접 편집은 최소화하고 서브에이전트 결과를 받아 통합·검증.

  - 프롬프트 캐싱 (Prompt Caching) 활용:
반복되는 시스템 프롬프트, API 문서, 대형 프로젝트 코드베이스는 '프로젝트(Projects)' 기능이나 프롬프트 캐싱을 사용하여 매번 토큰을 소비하지 않도록 함.

## 1. Project Overview
- **이름**: AI Hedge Fund (Visual Simulator)
- **목적**: LangGraph 기반 다중 에이전트 시스템을 사용자 친화적인 시각적 노드 기반 UI로 백테스팅하고 실시간으로 시뮬레이션할 수 있는 교육/분석 플랫폼.

## 2. Tech Stack & Architecture
- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui.
- **Visual Node Editor**: ReactFlow 기반 (`@xyflow/react`).
- **State Management**: React Context (`flow-context`, `node-context`, `language-context`).
- **Backend**: Python, FastAPI, LangGraph, LangChain.
- **Deployment**: AWS Lightsail (Apache 프록시 등).

## 3. 핵심 아키텍처 규칙
### A. API Connection & Proxy
- 로컬 환경에서는 `http://localhost:8000`을 바라보지만, 서버 배포 환경(`production`)에서는 CORS 문제 예방을 위해 동일 서버 내 프록시인 `/hedge-api/` 를 사용합니다. (`API_BASE_URL` 환경 변수 사용 원칙)
- 프론트엔드의 `index.html` 배포 기준 경로는 `--base=/hedge/` 입니다.

### B. Language (i18n) 시스템
- 외부 다국어 프레임워크(i18next 등)를 쓰지 않고, 자체 작성한 `language-preferences.ts`와 `language-context.tsx`를 통해 `en`, `ko`를 지원합니다.
- UI 문자열을 추가할 때는 반드시 `lib/language-preferences.ts`의 `translations` 사전에 키를 추가하고 컴포넌트에는 `useLanguage()` 훅을 사용하여 `t('key', language)`로 매핑합니다.

### C. Flow Execution & SSE (Server-Sent Events)
- 모든 시뮬레이션은 SSE 스트리밍을 통해 백엔드의 LangGraph 진행 상태를 실시간으로 받아옵니다.
- 프론트엔드의 `use-flow-connection.ts` 훅과 백엔드 `hedge_fund_runner.py` / `main.py`가 핵심 창구 역할을 합니다.

### D. UI Component Conventions
- 서버 의존성 충돌 문제로 인해 `shadcn/ui`의 무거운 컴포넌트(Label, RadioGroup 등) 대신 가급적 순수 HTML 태그(`<label>`, `<input type="radio">`, `<div>` dropdown)로 풀어쓰는 방식을 선호합니다 (예: `ticker-input.tsx`).
- 검색 탭 등 모든 UI는 반응형보다는 넓은 화면의 대시보드 구조에 최적화되어 있습니다.

## 4. 서버 배포 절차
- **SSH 키**: `/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem` 사용 (Hedge Fund 폴더 내 동명 키는 인증 안 됨)
- **서버**: `bitnami@54.116.99.19`, 웹 루트: `/opt/bitnami/apache/htdocs/hedge/`
- **서버 내 프로젝트 경로**: `/home/bitnami/ai-hedge-fund/`

```
# Step 1. 로컬 커밋 & 푸시
git add <파일> && git commit -m "메시지" && git push origin main

# Step 2. 서버 pull & 빌드 (하나의 명령으로)
ssh -i "/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  "cd /home/bitnami/ai-hedge-fund && git pull origin main && cd app/frontend && npm run build"

# Step 3. 배포
ssh -i "/Users/huiyong/Desktop/Vibe Investment/LightsailDefaultKey-ap-northeast-2.pem" bitnami@54.116.99.19 \
  "sudo cp -r /home/bitnami/ai-hedge-fund/app/frontend/dist/* /opt/bitnami/apache/htdocs/hedge/"
```

## 5. Troubleshooting Checklist (유의사항)
1. **Flow 연결 500 에러**: 프론트엔드에서 backend로 노드/엣지 정보를 보낼 때 시작점(`stock-analyzer-node` 등)과 도착점(`portfolio-manager-node`)이 모두 `graph_nodes`와 `graph_edges` 구조에 온전히 포함되어야 LangGraph 작동 에러가 발생하지 않습니다.
2. **포커스/키보드 이벤트 씹힘**: PopoverTrigger 등을 Input에 감싸면 radix-ui가 이벤트를 훔쳐 타이핑이 안 되는 현상이 발생합니다. dropdown UI는 가급적 absolute + div 기반으로 커스텀 작성합니다.
