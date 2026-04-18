import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { cn } from '@/lib/utils';
import { TabService } from '@/services/tab-service';
import { BarChart3, Bot, Brain, Database, FileText, GitBranch, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';

interface TabContentProps {
  className?: string;
}

function MainGuide({ language }: { language: 'ko' | 'en' }) {
  const isKo = language === 'ko';
  const stages = isKo
    ? [
        {
          icon: Database,
          title: '데이터 수집 및 표준화',
          body: '백엔드는 yfinance, DART, FMP, AlphaVantage, Financial Datasets fallback을 조합해 가격, 재무제표, 지표, 뉴스, 공시 데이터를 수집합니다. 누락값은 N/A로 보존하고 에이전트가 임의 수치를 만들지 않도록 표준화합니다.',
        },
        {
          icon: Bot,
          title: '에이전트 정량 평가',
          body: '워런 버핏, 찰리 멍거, 다모다란, 캐시 우드 등 각 에이전트는 자신의 투자 철학에 맞는 지표를 우선 검토하고 bullish, bearish, neutral 신호와 신뢰도를 만듭니다.',
        },
        {
          icon: BarChart3,
          title: '종합 점수',
          body: '각 에이전트의 방향성과 신뢰도를 0~100점 구간으로 환산합니다. 80점 이상은 강력 매수, 60~79점은 매수, 40~59점은 관망, 20~39점은 비중 축소, 19점 이하는 강력 매도 구간입니다.',
        },
        {
          icon: Brain,
          title: '포트폴리오 매니저 종합',
          body: '포트폴리오 매니저는 에이전트별 근거를 다시 묶어 최종 판단, 약식 요약, 원문 대조 리포트 확인 포인트를 제공합니다. 시드머니 주문 수량보다 판단 상태와 근거 요약을 우선합니다.',
        },
      ]
    : [
        {
          icon: Database,
          title: 'Data Collection And Standardization',
          body: 'The backend combines yfinance, DART, FMP, AlphaVantage, and Financial Datasets fallbacks to collect prices, statements, metrics, news, and filings. Missing values stay as N/A so agents cannot invent financial numbers.',
        },
        {
          icon: Bot,
          title: 'Agent Quant Scoring',
          body: 'Warren Buffett, Charlie Munger, Aswath Damodaran, Cathie Wood, and other agents prioritize the metrics their investment styles require, then produce bullish, bearish, or neutral signals with confidence.',
        },
        {
          icon: BarChart3,
          title: 'Composite Score',
          body: 'Agent direction and confidence are normalized into a 0-100 score. 80+ is Strong Buy, 60-79 is Buy, 40-59 is Watch, 20-39 is Reduce, and below 20 is Strong Sell.',
        },
        {
          icon: Brain,
          title: 'Portfolio Manager Synthesis',
          body: 'The portfolio manager combines analyst reasoning into a final decision, executive summary, and source cross-check points. The UI emphasizes decision status and evidence over seed-money order sizing.',
        },
      ];

  return (
    <div className="h-full w-full overflow-y-auto bg-background text-foreground">
      <main className="mx-auto flex min-h-full max-w-6xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="border-b border-border/70 pb-7">
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <GitBranch className="h-4 w-4 text-blue-500" />
            <span>{isKo ? 'AI Hedge Fund Visual Simulator' : 'AI Hedge Fund Visual Simulator'}</span>
          </div>
          <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-tight tracking-normal text-primary">
            {isKo
              ? '메인페이지에서 전체 분석 흐름과 점수 산정 방식을 확인하세요'
              : 'Review the full analysis flow and scoring logic from the main page'}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
            {isKo
              ? '이 화면은 설정 페이지가 아니라 앱의 작동 방식을 설명하는 기준 화면입니다. Flow 또는 종목 분석 탭을 열기 전, 백엔드 데이터 파이프라인과 에이전트 판단 구조가 어떻게 연결되는지 빠르게 확인할 수 있습니다.'
              : 'This is the reference screen for how the app works, not a settings page. Before opening a Flow or Stock Analysis tab, you can review how the backend data pipeline connects to agent decisions.'}
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {stages.map((stage) => {
            const Icon = stage.icon;
            return (
              <div key={stage.title} className="rounded-md border border-border/70 bg-muted/10 p-5">
                <div className="mb-3 flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                    <Icon className="h-4 w-4 text-blue-500" />
                  </span>
                  <h2 className="text-base font-semibold text-primary">{stage.title}</h2>
                </div>
                <p className="text-sm leading-7 text-muted-foreground">{stage.body}</p>
              </div>
            );
          })}
        </section>

        <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-md border border-border/70 bg-muted/10 p-5">
            <div className="mb-3 flex items-center gap-3">
              <FileText className="h-4 w-4 text-emerald-500" />
              <h2 className="text-base font-semibold text-primary">
                {isKo ? '원문 대조와 결과 보존' : 'Source Cross-Check And Result Persistence'}
              </h2>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {isKo
                ? '에이전트 결과에는 SEC 10-K 또는 DART 사업보고서에서 확인해야 할 원문 대조 체크리스트가 포함됩니다. 한 번 조회한 결과와 보고서, 조회 상태는 DB에 저장되어 페이지 이동이나 새로고침 뒤에도 다시 복원되는 방향으로 관리됩니다.'
                : 'Agent outputs include source cross-check checklists for SEC 10-K or DART filings. Viewed results, reports, and query state are stored in the database so navigation or refreshes can restore them.'}
            </p>
            <p className="mt-3 text-sm font-medium text-primary">
              {isKo ? '결과는 DB에 저장되며, 임의 초기화되지 않도록 관리됩니다.' : 'Results are saved to the database and are protected from accidental reset.'}
            </p>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/10 p-5">
            <div className="mb-3 flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-amber-500" />
              <h2 className="text-base font-semibold text-primary">
                {isKo ? '설정과 API 노출 정책' : 'Settings And API Visibility'}
              </h2>
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {isKo
                ? '설정 화면은 Models, Theme, Language만 제공합니다. 금융/LLM API 키는 사용자가 직접 조작하는 UI로 노출하지 않고, 백엔드가 저장된 키와 환경 변수를 이용해 데이터 전처리와 모델 호출에 활용합니다.'
                : 'Settings expose only Models, Theme, and Language. Financial and LLM API keys are not shown as user-facing controls; the backend uses saved keys and environment variables for preprocessing and model calls.'}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTabId, openTab } = useTabsContext();
  const { language } = useLanguage();

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Restore content for active tab that doesn't have it (from localStorage restoration)
  useEffect(() => {
    if (activeTab && !activeTab.content) {
      try {
        const restoredTab = TabService.restoreTab({
          type: activeTab.type,
          title: activeTab.title,
          flow: activeTab.flow,
          metadata: activeTab.metadata,
        });

        // Update the tab with restored content
        openTab({
          id: activeTab.id,
          type: restoredTab.type,
          title: restoredTab.title,
          content: restoredTab.content,
          flow: restoredTab.flow,
          metadata: restoredTab.metadata,
        });
      } catch (error) {
        console.error('Failed to restore tab content:', error);
      }
    }
  }, [activeTab, openTab]);

  if (!activeTab) {
    return (
      <div className={cn(
        "h-full w-full bg-background",
        className
      )}>
        <MainGuide language={language} />
      </div>
    );
  }

  // Show loading state if active tab content is being restored
  if (!activeTab.content) {
    return (
      <div className={cn(
        "h-full w-full flex items-center justify-center bg-background text-muted-foreground",
        className
      )}>
        <div className="text-center">
          <div className="text-lg font-medium mb-2">
            {language === 'ko' ? `${activeTab.title} 불러오는 중...` : `Loading ${activeTab.title}...`}
          </div>
        </div>
      </div>
    );
  }

  // Render all tabs simultaneously but only show the active one.
  // This preserves component state (e.g. Stock Analysis results) when switching tabs.
  return (
    <div className={cn("h-full w-full bg-background overflow-hidden relative", className)}>
      {tabs.map(tab => {
        if (!tab.content) return null;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 h-full w-full",
              tab.id !== activeTabId && "hidden"
            )}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
