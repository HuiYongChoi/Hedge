import { Button } from '@/components/ui/button';
import { t } from '@/lib/language-preferences';
import { ChevronRight } from 'lucide-react';
import { toneToClasses } from './helpers';
import type { OtherAgent, ReportLanguage, TargetTile } from './types';

interface TargetDataSidebarProps {
  tiles: TargetTile[];
  otherAgents: OtherAgent[];
  language: ReportLanguage;
  onSwitchAgent: (agentKey: string) => void;
  className?: string;
  report?: Record<string, any> | null;
}

function shortTone(tone: OtherAgent['tone']) {
  if (tone === 'bullish') return 'BUL';
  if (tone === 'bearish') return 'BEA';
  return 'NEU';
}

export function TargetDataSidebar({
  tiles,
  otherAgents,
  language,
  onSwitchAgent,
  className = '',
  report,
}: TargetDataSidebarProps) {
  return (
    <aside className={`w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-[280px] lg:self-start lg:overflow-y-auto lg:max-h-[calc(100vh-6rem)] ${className}`}>
      <div className="rounded-xl border border-border/60 bg-background p-3 shadow-sm">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('targetDataTitle', language)}
        </h3>
        {tiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            {tiles.map(tile => {
              const classes = toneToClasses(tile.tone);
              const sourceName = tile.sourceAgent
                ? (language === 'ko' ? tile.sourceAgent.nameKo : tile.sourceAgent.nameEn)
                : '';
              return (
                <div key={tile.labelKey} className={`relative rounded-lg border bg-muted/10 p-3 ${classes.border}`}>
                  {tile.sourceAgent && !tile.isFromActiveAgent && (
                    <span
                      className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 bg-background px-1 font-mono text-[10px] font-semibold text-muted-foreground"
                      title={t('targetTileFromAgent', language).replace('{name}', sourceName)}
                    >
                      {sourceName.slice(0, 1)}
                    </span>
                  )}
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(tile.labelKey, language)}
                  </div>
                  <div className={`mt-1 font-mono text-lg font-semibold ${classes.text}`}>
                    {tile.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t(tile.sublabelKey, language)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-[11px] text-muted-foreground">
            {report?.data_coverage !== undefined && report.data_coverage !== null && report.data_coverage < 0.4
              ? (language === 'ko' ? '데이터 커버리지가 낮아 핵심 타겟을 보류했습니다.' : 'Target data is on hold due to low coverage.')
              : (language === 'ko' ? '핵심 타겟 데이터가 없습니다.' : 'No target data available.')}
          </div>
        )}

        {otherAgents.length > 0 && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('otherAgentsTitle', language)}
            </h3>
            <div className="space-y-1">
              {otherAgents.map(agent => {
                const classes = toneToClasses(agent.tone);
                const displayName = language === 'ko' ? agent.displayNameKo : agent.displayNameEn;
                return (
                  <button
                    key={agent.key}
                    type="button"
                    onClick={() => onSwitchAgent(agent.key)}
                    aria-label={`${displayName} 분석으로 전환`}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-xs hover:border-border/60 hover:bg-muted/30"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${classes.bg}`} />
                      <span className="truncate font-medium">{displayName}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px]">
                      <span className={`rounded-full px-1.5 py-0.5 font-semibold ${classes.badge}`}>
                        {shortTone(agent.tone)}
                      </span>
                      <span className="font-mono text-muted-foreground">{Math.round(agent.score)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          className="mt-3 min-h-[44px] w-full"
          disabled
          aria-disabled="true"
          title={t('comingSoonLabel', language)}
        >
          {t('openConsensusMatrix', language)}
          <ChevronRight className="ml-auto h-3.5 w-3.5" />
        </Button>
      </div>
    </aside>
  );
}
