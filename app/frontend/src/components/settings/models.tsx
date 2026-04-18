import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/contexts/language-context';
import { cn } from '@/lib/utils';
import { Brain, Database, KeyRound, ShieldCheck } from 'lucide-react';
import { type ComponentType } from 'react';

interface ModelsProps {
  className?: string;
}

interface ServiceGroup {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  services: string[];
}

export function Models({ className }: ModelsProps) {
  const { language } = useLanguage();
  const isKorean = language === 'ko';

  const serviceGroups: ServiceGroup[] = [
    {
      icon: Brain,
      title: isKorean ? 'AI 모델 호출' : 'AI model calls',
      description: isKorean
        ? '에이전트 추론과 포트폴리오 매니저 요약은 서버에서 설정된 LLM 제공자를 통해 실행됩니다.'
        : 'Agent reasoning and portfolio-manager summaries run through LLM providers configured on the server.',
      services: ['OpenAI', 'Anthropic', 'Google Gemini', 'Groq', 'DeepSeek', 'OpenRouter', 'Ollama'],
    },
    {
      icon: Database,
      title: isKorean ? '재무/시장 데이터' : 'Financial and market data',
      description: isKorean
        ? '기업 분석에 필요한 가격, 재무제표, 현금흐름, 성장성, 공시 데이터를 백엔드에서 수집하고 표준화합니다.'
        : 'The backend collects and standardizes prices, statements, cash-flow, growth, and filing data for analysis.',
      services: ['yfinance', 'SEC EDGAR', 'DART', 'FMP', 'Alpha Vantage', 'Financial Datasets', 'pykrx'],
    },
    {
      icon: ShieldCheck,
      title: isKorean ? '원문 검증 링크' : 'Source cross-check links',
      description: isKorean
        ? '사용자가 보고서 근거를 직접 대조할 수 있도록 원문 공시와 시장 참고 링크를 제공합니다.'
        : 'The app provides filing and market-reference links so users can verify report evidence directly.',
      services: ['SEC 10-K', 'DART', 'Finviz', 'Naver Finance'],
    },
  ];

  return (
    <div className={cn('space-y-6', className)}>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-primary">
          {isKorean ? '연동 및 데이터 안내' : 'Integrations and Data'}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {isKorean
            ? '이 화면은 API 키를 입력하거나 조회하는 곳이 아닙니다. 분석에 필요한 모델과 금융 데이터 연동은 백엔드에서 안전하게 처리됩니다.'
            : 'This screen does not collect or expose API keys. Model and financial-data integrations are handled securely by the backend.'}
        </p>
      </div>

      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 flex-shrink-0 text-emerald-400" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-emerald-300">
              {isKorean ? '키 노출 없이 서버에서만 사용' : 'Keys are used server-side only'}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {isKorean
                ? '브라우저는 원본 API 키를 읽거나 다운로드하지 않습니다. 저장된 키와 환경 변수는 백엔드가 데이터 수집, 전처리, LLM 호출을 수행할 때만 사용합니다.'
                : 'The browser cannot read or download raw API keys. Stored keys and environment variables are used only by the backend for data collection, preprocessing, and LLM calls.'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3">
        {serviceGroups.map((group) => {
          const Icon = group.icon;

          return (
            <section
              key={group.title}
              className="rounded-md border border-border bg-muted/10 p-4"
            >
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-400" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-primary">{group.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{group.description}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {group.services.map((service) => (
                      <Badge
                        key={service}
                        variant="outline"
                        className="rounded-full border-border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground"
                      >
                        {service}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
