import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getTickerDisplayName, resolveTickerValue, TickerInput } from '@/components/ui/ticker-input';
import { useLanguage } from '@/contexts/language-context';
import { useWorkspace } from '@/contexts/workspace-context';
import {
  DATA_SANDBOX_OVERRIDES_EVENT,
  countSandboxOverrideFields,
  getSandboxOverrideForTicker,
  loadDataSandboxOverrideSnapshot,
} from '@/lib/data-sandbox-overrides';
import { t } from '@/lib/language-preferences';
import { CalendarDays, Database, Search } from 'lucide-react';
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

const PillButton = forwardRef<HTMLButtonElement, { icon: ReactNode; label: string; value: string; title?: string }>(
  function PillButton({ icon, label, value, title }, ref) {
    return (
      <Button
        ref={ref}
        variant="outline"
        title={title}
        className="h-8 gap-1.5 rounded-full border-border/80 bg-background/90 px-3 text-xs font-medium shadow-sm whitespace-nowrap"
      >
        <span className="text-muted-foreground">{icon}</span>
        <span className="hidden text-muted-foreground xl:inline">{label}</span>
        <span className="text-primary">{value}</span>
      </Button>
    );
  },
);
PillButton.displayName = 'PillButton';

export function WorkspacePill() {
  const { language } = useLanguage();
  const { workspace, setTickers, setDateRange, setUseDataSandboxOverrides } = useWorkspace();
  const [sandboxSnapshot, setSandboxSnapshot] = useState(() => loadDataSandboxOverrideSnapshot());

  useEffect(() => {
    const refreshSnapshot = () => setSandboxSnapshot(loadDataSandboxOverrideSnapshot());

    window.addEventListener(DATA_SANDBOX_OVERRIDES_EVENT, refreshSnapshot as EventListener);
    window.addEventListener('storage', refreshSnapshot);
    return () => {
      window.removeEventListener(DATA_SANDBOX_OVERRIDES_EVENT, refreshSnapshot as EventListener);
      window.removeEventListener('storage', refreshSnapshot);
    };
  }, []);

  const tickerLabel = useMemo(() => {
    if (!workspace.tickers.trim()) {
      return t('noTickerSelected', language);
    }
    return workspace.tickers
      .split(',')
      .map(value => {
        const trimmed = value.trim();
        const resolvedTicker = resolveTickerValue(trimmed).toUpperCase();
        const displayName = getTickerDisplayName(trimmed || resolvedTicker);
        if (!resolvedTicker) return '';
        return displayName === resolvedTicker ? resolvedTicker : `${displayName} · ${resolvedTicker}`;
      })
      .filter(Boolean)
      .join(', ');
  }, [language, workspace.tickers]);

  const primaryTicker = useMemo(() => {
    return workspace.tickers
      .split(',')
      .map(value => resolveTickerValue(value.trim()).toUpperCase())
      .find(Boolean) || '';
  }, [workspace.tickers]);

  const sandboxOverrideForTicker = useMemo(() => (
    primaryTicker ? getSandboxOverrideForTicker(sandboxSnapshot, primaryTicker) : null
  ), [primaryTicker, sandboxSnapshot]);

  const sandboxOverrideCount = countSandboxOverrideFields(sandboxOverrideForTicker);
  const shouldShowSandboxChip = workspace.useDataSandboxOverrides && sandboxOverrideCount > 0;
  const sandboxValueLabel = language === 'ko'
    ? `사용 중 ${sandboxOverrideCount}`
    : `On ${sandboxOverrideCount}`;

  const periodLabel = getPeriodLabel(workspace.startDate, workspace.endDate, language);
  const workspaceScopeTitle = language === 'ko'
    ? '플로우 노드의 워크스페이스 동기화가 켜진 경우에만 적용됩니다'
    : 'Applies only to flow nodes with workspace sync ON';
  const sandboxScopeTitle = language === 'ko'
    ? 'Data Sandbox 수정값이 실제로 적용 중일 때만 표시됩니다'
    : 'Shown only when Data Sandbox overrides are actively applied';

  return (
    <div
      className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-2 py-1 shadow-sm"
      role="group"
      aria-label={language === 'ko' ? '플로우 워크스페이스 컨텍스트' : 'Flow workspace context'}
    >
      <Popover>
        <PopoverTrigger asChild>
          <PillButton
            icon={<Search className="h-3.5 w-3.5" />}
            label={t('activeTicker', language)}
            value={tickerLabel}
            title={workspaceScopeTitle}
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
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={t('period', language)}
            value={periodLabel}
            title={workspaceScopeTitle}
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

      {shouldShowSandboxChip && (
        <Popover>
          <PopoverTrigger asChild>
            <PillButton
              icon={<Database className="h-3.5 w-3.5" />}
              label={t('sandboxLabel', language)}
              value={sandboxValueLabel}
              title={sandboxScopeTitle}
            />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[340px] space-y-3 p-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-primary">{t('useDataSandboxOverrides', language)}</div>
              <div className="text-[11px] leading-relaxed text-muted-foreground">
                {sandboxOverrideForTicker && primaryTicker
                  ? t('dataSandboxOverridesAvailable', language)
                      .replace('{ticker}', primaryTicker)
                      .replace('{count}', String(sandboxOverrideCount))
                  : t('dataSandboxOverridesUnavailable', language)}
              </div>
            </div>
            <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-sm">
              <Checkbox
                checked={workspace.useDataSandboxOverrides && Boolean(sandboxOverrideForTicker)}
                disabled={!sandboxOverrideForTicker}
                onCheckedChange={checked => setUseDataSandboxOverrides(checked === true)}
                className="mt-0.5"
              />
              <span className={!sandboxOverrideForTicker ? 'text-muted-foreground' : ''}>
                {language === 'ko'
                  ? '다음 분석 요청에 Data Sandbox 수정값을 적용합니다.'
                  : 'Apply Data Sandbox overrides to the next analysis run.'}
              </span>
            </label>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
