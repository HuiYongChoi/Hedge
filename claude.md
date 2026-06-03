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

### D. 재무 데이터 재사용 원칙
- 종목 분석 탭에서 이미 정상 동작하는 재무 데이터 경로를 우선 재사용합니다. 특히 `/hedge-fund/fetch-metrics`의 `metrics`, `forward_metrics`, `prices`, `line_items`와 `/analyst-targets/{ticker}`의 컨센서스 목표가/현재가를 새 화면에서도 그대로 연결합니다.
- 종목간 비교, 아카이브, 차트 기능을 확장할 때 별도 임시 API나 중복 계산을 만들기 전에 기존 `fetch-metrics`, `analystTargetService`, 리포트 v5 helper/타입에서 같은 값이 이미 공급되는지 먼저 확인합니다.
- 특정 값이 비교 화면에서 비어 있으면 “데이터 없음”으로 단정하지 말고, 종목 분석 화면에서 쓰는 기존 필드명이 비교 슬롯 상태에 저장/전달/렌더링되는지 추적합니다. 예: `forward_metrics.forward_pe`, `analystTarget.consensus`, annual `line_items`, `prices`.

### E. UI Component Conventions
- 서버 의존성 충돌 문제로 인해 `shadcn/ui`의 무거운 컴포넌트(Label, RadioGroup 등) 대신 가급적 순수 HTML 태그(`<label>`, `<input type="radio">`, `<div>` dropdown)로 풀어쓰는 방식을 선호합니다 (예: `ticker-input.tsx`).
- 검색 탭 등 모든 UI는 반응형보다는 넓은 화면의 대시보드 구조에 최적화되어 있습니다.

## 4. 로컬 커밋 / 깃 푸시 / 서버 배포 절차
- **로컬 프로젝트 경로**: `/Users/huiyong/Desktop/Hedge Fund/ai-hedge-fund`
- **SSH 키**: `/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem`
- **서버**: `admin@43.203.120.8`
- **서버 내 프로젝트 경로**: `/home/admin/ai-hedge-fund/`
- **웹 루트**: `/var/www/html/hedge/`

### A. 커밋 전 원칙
- 워크트리에 사용자 작업이 섞여 있는 경우가 많으므로 `git add .` 금지. 반드시 명시 경로만 stage.
- unrelated dirty 파일은 보존한다. 자주 남아 있는 예: `docs/forward_per/README.md`, `docs/ui/`, `docs/agents/`, `tmp/`.
- 커밋 전 최소 검증으로 `git diff --check`와 관련 테스트를 실행한다.
- 로컬 시스템 `npm`/`python`이 없을 수 있으므로 Codex 번들 런타임을 우선 사용한다.

```bash
# Python tests
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 -m pytest tests/ --ignore=tests/backtesting -q

# Frontend build equivalent to npm run build when local npm is unavailable
cd app/frontend
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/typescript/bin/tsc
/Users/huiyong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/vite/bin/vite.js build
```

```bash
git add path/to/changed-file path/to/test-file
git diff --cached --check
git commit -m "fix(scope): short summary"
```

### B. GitHub 푸시
`origin`은 HTTPS remote다. 가능하면 `gh auth login && gh auth setup-git` 후 일반 푸시를 사용한다.

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD
git push origin main
git fetch origin
git rev-list --left-right --count origin/main...HEAD
```

푸시 성공 후 `0  0`이면 로컬 `HEAD`와 `origin/main`이 동기화된 상태다.

사용자가 PAT를 제공한 경우:
- 토큰을 remote URL, 커맨드 문자열, repo 파일, 커밋에 남기지 않는다.
- 임시 `GIT_ASKPASS` 또는 `gh auth login --with-token`만 사용한다.
- 대화에 토큰이 노출된 경우 푸시 후 즉시 revoke/rotate 안내.

임시 `GIT_ASKPASS` 패턴:

```bash
read -rsp "GitHub PAT: " GITHUB_TOKEN; echo
export GITHUB_TOKEN
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"; unset GITHUB_TOKEN' EXIT
cat > "$tmpdir/askpass.sh" <<'SH'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
SH
chmod 700 "$tmpdir/askpass.sh"
GIT_ASKPASS="$tmpdir/askpass.sh" GIT_TERMINAL_PROMPT=0 git push origin main
```

### C. 서버 배포
GitHub push는 서버 배포가 아니다. 서버 반영은 로컬 머신에서 deploy script를 실행해야 한다.

```bash
./deploy_aws.sh
```

이 스크립트는 로컬에서 실행해야 한다. 서버에 SSH로 들어간 뒤 `/home/admin/ai-hedge-fund` 안에서 실행하면 로컬 SSH 키 경로를 찾지 못해 실패한다.

스크립트가 하는 일:
- 서버에서 `git fetch origin && git pull origin main`
- `8000/tcp` backend 종료 후 `uvicorn app.backend.main:app` 재시작
- `app/frontend`에서 `npm install`
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build -- --base=/hedge/`
- `dist/*`를 `/var/www/html/hedge/`로 복사

성공 신호:

```text
Backend restarted.
✓ built in ...
Frontend built and copied.
```

배포 후 smoke check:

```bash
curl -I --max-time 10 http://43.203.120.8/hedge/
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem" admin@43.203.120.8 \
  'cd /home/admin/ai-hedge-fund && git rev-parse --short HEAD && pgrep -af "uvicorn app.backend.main:app" | head -3'
```

### D. GitHub 푸시가 막힌 경우의 빠른 서버 반영
GitHub 인증이 안 되어 `origin/main`에 못 올리는 경우에는 git bundle로 서버 checkout만 fast-forward하고, 다시 로컬에서 `./deploy_aws.sh`를 실행한다.

```bash
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem" admin@43.203.120.8 \
  'cd /home/admin/ai-hedge-fund && git rev-parse --short HEAD && git status --short'

git merge-base --is-ancestor <server-head> HEAD
git bundle create /tmp/hedge-deploy.bundle main ^<server-head>
git bundle verify /tmp/hedge-deploy.bundle
scp -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem" \
  /tmp/hedge-deploy.bundle admin@43.203.120.8:/tmp/hedge-deploy.bundle
```

```bash
ssh -o StrictHostKeyChecking=no -i "/Users/huiyong/Desktop/Hedge Fund/lamp-1_260530.pem" admin@43.203.120.8 << 'EOF'
set -euo pipefail
cd /home/admin/ai-hedge-fund
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "pre-deploy-$(date +%Y%m%d%H%M%S)"
fi
git bundle verify /tmp/hedge-deploy.bundle
git fetch /tmp/hedge-deploy.bundle main
git merge --ff-only FETCH_HEAD
git rev-parse --short HEAD
git status --short
EOF
```

그 다음 로컬에서:

```bash
./deploy_aws.sh
```

## 5. Troubleshooting Checklist (유의사항)
1. **Flow 연결 500 에러**: 프론트엔드에서 backend로 노드/엣지 정보를 보낼 때 시작점(`stock-analyzer-node` 등)과 도착점(`portfolio-manager-node`)이 모두 `graph_nodes`와 `graph_edges` 구조에 온전히 포함되어야 LangGraph 작동 에러가 발생하지 않습니다.
2. **포커스/키보드 이벤트 씹힘**: PopoverTrigger 등을 Input에 감싸면 radix-ui가 이벤트를 훔쳐 타이핑이 안 되는 현상이 발생합니다. dropdown UI는 가급적 absolute + div 기반으로 커스텀 작성합니다.
