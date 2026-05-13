import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from './types';

interface SensitivityHeatmapProps {
  matrix: Array<Array<{ wacc: number; growth: number; safetyMargin: number; intrinsicValue?: number }>> | null | undefined;
  currentWacc: number;
  currentGrowth: number;
  language: ReportLanguage;
}

export function SensitivityHeatmap({
  matrix,
  currentWacc,
  currentGrowth,
  language,
}: SensitivityHeatmapProps) {
  if (!matrix || matrix.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sensitivityTitle', language)}
        </h4>
        <span className="text-[10px] text-muted-foreground">
          {t('sensitivityCurrentAssumption', language)} · WACC {(currentWacc * 100).toFixed(1)}% / g {(currentGrowth * 100).toFixed(1)}%
        </span>
      </div>
      <div className="grid grid-cols-6 gap-px text-[10px]">
        <div className="rounded-sm bg-muted/30 p-2 text-center font-medium text-muted-foreground">WACC \ g</div>
        {matrix[0]?.map(cell => (
          <div key={`growth-${cell.growth}`} className="rounded-sm bg-muted/30 p-2 text-center font-mono text-muted-foreground">
            {(cell.growth * 100).toFixed(1)}%
          </div>
        ))}
        {matrix.map(row => [
          <div key={`wacc-${row[0]?.wacc ?? 'row'}`} className="rounded-sm bg-muted/30 p-2 text-center font-mono text-muted-foreground">
            {((row[0]?.wacc ?? 0) * 100).toFixed(1)}%
          </div>,
          ...row.map(cell => {
            const active = Math.abs(cell.wacc - currentWacc) < 0.0001 && Math.abs(cell.growth - currentGrowth) < 0.0001;
            const bg = cell.safetyMargin <= -0.6
              ? '#7f1d1d'
              : cell.safetyMargin <= -0.3
                ? '#dc2626'
                : cell.safetyMargin <= -0.1
                  ? '#f59e0b'
                  : cell.safetyMargin <= 0.1
                    ? '#fbbf24'
                    : '#10b981';
            return (
              <div
                key={`${cell.wacc}-${cell.growth}`}
                className={`min-h-[44px] rounded-sm p-2 text-center font-semibold text-white ${active ? 'border-2 border-yellow-400' : 'border border-transparent'}`}
                style={{ backgroundColor: bg }}
                title={`WACC ${(cell.wacc * 100).toFixed(1)}%, g ${(cell.growth * 100).toFixed(1)}%`}
              >
                {(cell.safetyMargin * 100).toFixed(0)}%
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
}
