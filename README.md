# AI Hedge Fund Visual Simulator

LangGraph 기반의 멀티 에이전트 투자 시나리오를 시각적인 노드 에디터와 대시보드로 구동할 수 있는 지능형 투자 시뮬레이션 앱입니다.

## 주요 기능 (Features)

- **시각적 포트폴리오 빌더 (ReactFlow)** 
  - 시작 노드(Stock Analyzer)에서 여러 다양한 에이전트(워런 버핏, 마이클 버리, 기술적 분석기 등)를 캔버스에 추가한 뒤, 최종 포트폴리오 매니저 노드로 연결하여 나만의 투자 분석 파이프라인을 구축할 수 있습니다.
- **빠른 투자 검색 (Quick Stock Analysis Tab)**
  - 복잡한 연결 없이 우측 상단의 돋보기(🔍) 탭을 열어 원하는 티커를 즉시 검색(`TickerInput` 자동완성 지원)하고, 각 애널리스트들의 종합 보고서 및 최종 매수/매도 판단을 실시간 스트리밍(SSE)으로 받아볼 수 있습니다.
- **실시간 백테스팅 및 분석**
  - 단일 런(Single Run)과 과거 날짜를 설정하여 수익의 타당성을 검증하는 백테스트(Backtest) 모드를 완벽 지원합니다.
- **언어 설정 (i18n)**
  - 한국어와 영어 모드를 설정(⚙) 메뉴에서 즉각 전환할 수 있으며 브라우저 로컬 저장소에 반영됩니다.
- **멀티 LLM 모델 지원**
  - Gemini Flash 기반 모델이 기본값으로 설정되어 있으며, 필요시 각 에이전트별로 다른 모델을 지정하거나 설정 화면에서 API KEY를 통해 다양한 대규모 언어 모델을 연결할 수 있습니다.

## 기술 스택 (Tech Stack)

- **Frontend**: React, TypeScript, Vite, TailwindCSS, ReactFlow
- **Backend**: Python 3, FastAPI, LangGraph (AI 에이전트 오케스트레이션)
- **Deployment**: AWS (Apache HTTP Server)

## 실행 방법 (Quick Start)

**1. 환경 변수 설정**
```bash
cp .env.example .env
# .env 파일에 FINANCIAL_DATASETS_API_KEY와 기타 LLM API 키 작성
```

**2. 백엔드 및 의존성 셋업**
```bash
poetry install
# 필요한 경우 Poetry 가상 환경을 활성화합니다.
```

**3. 프론트엔드 및 실행**
```bash
cd app/frontend
npm install
npm run dev # 로컬 환경 구동 시
```

서버 구동 후, http://localhost:5173 에 접속하여 앱을 이용할 수 있습니다.

![Hedge Fund Interface Screenshot](./app/frontend/public/favicon.svg) *(UI 참조용)*

## 상세 아키텍처 및 시스템 컨텍스트
본 저장소의 핵심 에이전트 구성과 LLM을 위한 코드 구조 가이드는 각각 아래의 문서를 참고해 주십시오.
- [agents.md](./agents.md): 시스템에 포함된 투자 전문가 에이전트 종류와 역할에 관한 문서
- [claude.md](./claude.md): AI 코드 파트너를 위한 프론트엔드/백엔드 브릿지 및 UI 주의사항 설명서
