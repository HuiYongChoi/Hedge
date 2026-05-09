import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModelSelector } from '@/components/ui/llm-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { useWorkspace } from '@/contexts/workspace-context';
import { Agent, getAgents } from '@/data/agents';
import { getModels, LanguageModel } from '@/data/models';
import { t } from '@/lib/language-preferences';
import { CalendarDays, Cpu, Search, Users } from 'lucide-react';
import { forwardRef, type ReactNode, useEffect, useMemo, useState } from 'react';

const PERIOD_PRESETS = [
  { months: 1, ko: '1개월', en: '1M' },
  { months: 3, ko: '3개월', en: '3M' },
  { months: 6, ko: '6개월', en: '6M' },
  { months: 12, ko: '1년', en: '1Y' },
] as const;

function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

function subtractMonths(baseDate: string, months: number) {
  const next = new Date(baseDate);
  next.setMonth(next.getMonth() - months);
  return formatDate(next);
}

function getPeriodLabel(startDate: string, endDate: string, language: 'ko' | 'en') {
  const preset = PERIOD_PRESETS.find(item => subtractMonths(endDate, item.months) === startDate);
  if (preset) {
    return language === 'ko' ? preset.ko : preset.en;
  }

  if (!startDate || !endDate) {
    return language === 'ko' ? '직접 지정' : 'Custom';
  }

  return `${startDate.slice(2).replace(/-/g, '.')} ~ ${endDate.slice(2).replace(/-/g, '.')}`;
}

const PillButton = forwardRef<HTMLButtonElement, { icon: ReactNode; label: string; value: string }>(
  function PillButton({ icon, label, value }, ref) {
    return (
      <Button
        ref={ref}
        variant="outline"
        className="h-8 max-w-[220px] gap-1.5 rounded-full border-border/80 bg-background/70 px-3 text-xs font-medium shadow-sm"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="hidden text-muted-foreground xl:inline">{label}</span>
        <span className="truncate text-primary">{value}</span>
      </Button>
    );
  },
);
PillButton.displayName = 'PillButton';

export function WorkspacePill() {
  const { language } = useLanguage();
  const { workspace, setTickers, setDateRange, setSelectedModel } = useWorkspace();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<LanguageModel[]>([]);

  useEffect(() => {
    let active = true;

    Promise.all([getAgents(), getModels()])
      .then(([nextAgents, nextModels]) => {
        if (!active) return;
        setAgents(nextAgents);
        setModels(nextModels);
      })
      .catch((error) => {
        console.warn('Failed to load workspace pill data', error);
      });

    return () => {
      active = false;
    };
  }, []);

  const selectedAgentNames = useMemo(() => {
    const names = agents
      .filter(agent => workspace.selectedAgents.has(agent.key))
      .map(agent => language === 'ko' && agent.display_name_ko ? agent.display_name_ko : agent.display_name);

    if (names.length === workspace.selectedAgents.size) {
      return names;
    }

    const missingKeys = Array.from(workspace.selectedAgents)
      .filter(key => !agents.some(agent => agent.key === key));

    return [...names, ...missingKeys];
  }, [agents, language, workspace.selectedAgents]);

  const tickerLabel = useMemo(() => {
    if (!workspace.tickers.trim()) {
      return t('noTickerSelected', language);
    }
    return workspace.tickers
      .split(',')
      .map(value => resolveTickerValue(value.trim()))
      .filter(Boolean)
      .join(', ');
  }, [language, workspace.tickers]);

  const agentCountLabel = workspace.selectedAgents.size > 0
    ? language === 'ko'
      ? `${workspace.selectedAgents.size}명`
      : `${workspace.selectedAgents.size}`
    : t('noAgentsSelected', language);

  const modelLabel = workspace.selectedModel?.display_name || 'Auto';
  const periodLabel = getPeriodLabel(workspace.startDate, workspace.endDate, language);

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <PillButton
            icon={<Search className="h-3.5 w-3.5" />}
            label={t('activeTicker', language)}
            value={tickerLabel}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] space-y-3 p-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-primary">{t('activeTicker', language)}</div>
            <div className="text-[11px] text-muted-foreground">
              {language === 'ko' ? '워크스페이스에서 공통으로 사용할 종목을 설정합니다.' : 'Set the ticker shared across the workspace.'}
            </div>
          </div>
          <TickerInput
            value={workspace.tickers}
            onChange={setTickers}
            isActive={true}
            placeholder={language === 'ko' ? '예: AAPL, MSFT' : 'e.g. AAPL, MSFT'}
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <PillButton
            icon={<Users className="h-3.5 w-3.5" />}
            label={t('agentsSelected', language)}
            value={agentCountLabel}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] space-y-3 p-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-primary">{t('agentsSelected', language)}</div>
            <div className="text-[11px] text-muted-foreground">{t('selectAgentsInStockSearch', language)}</div>
          </div>
          {selectedAgentNames.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedAgentNames.map(name => (
                <span
                  key={name}
                  className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t('noAgentsSelected', language)}</div>
          )}
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <PillButton
            icon={<Cpu className="h-3.5 w-3.5" />}
            label={t('workspaceModel', language)}
            value={modelLabel}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] space-y-3 p-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-primary">{t('workspaceModel', language)}</div>
            <div className="text-[11px] text-muted-foreground">
              {language === 'ko' ? '종목 분석 워크스페이스에서 기본으로 사용할 모델입니다.' : 'Choose the default model for the stock analysis workspace.'}
            </div>
          </div>
          <ModelSelector
            models={models}
            value={workspace.selectedModel?.model_name || ''}
            onChange={setSelectedModel}
            placeholder="Auto"
          />
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <PillButton
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={t('period', language)}
            value={periodLabel}
          />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[340px] space-y-3 p-3">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-primary">{t('period', language)}</div>
            <div className="text-[11px] text-muted-foreground">{t('applyPresetPeriod', language)}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PERIOD_PRESETS.map(preset => (
              <Button
                key={preset.months}
                type="button"
                variant="outline"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => setDateRange(subtractMonths(workspace.endDate, preset.months), workspace.endDate)}
              >
                {language === 'ko' ? preset.ko : preset.en}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">{t('startDate', language)}</label>
              <Input
                type="date"
                value={workspace.startDate}
                onChange={event => setDateRange(event.target.value, workspace.endDate)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground">{t('endDate', language)}</label>
              <Input
                type="date"
                value={workspace.endDate}
                onChange={event => setDateRange(workspace.startDate, event.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
