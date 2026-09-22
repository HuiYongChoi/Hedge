import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from './types';

interface SensitivityCell {
  wacc: number;
  growth: number;
  safetyMargin: number;
  intrinsicValue?: number;
}

interface SensitivityHeatmapProps {
  matrix: SensitivityCell[][] | null | undefined;
  currentWacc: number;
  currentGrowth: number;
  language: ReportLanguage;
}

/**
 * 칸 색과 범례가 따로 놀지 않도록 구간을 한 곳에 모은다.
 * find(margin <= max) 로 위에서부터 걸리는 첫 구간을 쓴다.
 */
const BANDS = [
  { max: -0.6, color: '#7f1d1d', ko: '많이 비쌈', en: 'Far overvalued', rangeKo: '−60% 이하', rangeEn: 'below −60%' },
  { max: -0.3, color: '#dc2626', ko: '비쌈', en: 'Overvalued', rangeKo: '−60 ~ −30%', rangeEn: '−60 to −30%' },
  { max: -0.1, color: '#f59e0b', ko: '조금 비쌈', en: 'Slightly rich', rangeKo: '−30 ~ −10%', rangeEn: '−30 to −10%' },
  { max: 0.1, color: '#fbbf24', ko: '비슷', en: 'Fair', rangeKo: '−10 ~ +10%', rangeEn: '−10 to +10%' },
  { max: Infinity, color: '#10b981', ko: '쌈', en: 'Undervalued', rangeKo: '+10% 초과', rangeEn: 'above +10%' },
] as const;

type Band = (typeof BANDS)[number];

function bandOf(safetyMargin: number): Band {
  return BANDS.find(band => safetyMargin <= band.max) ?? BANDS[BANDS.length - 1];
}

function bandLabel(band: Band, language: ReportLanguage) {
  return language === 'ko' ? band.ko : band.en;
}

function bandRange(band: Band, language: ReportLanguage) {
  return language === 'ko' ? band.rangeKo : band.rangeEn;
}

/** 부호를 눈에 보이게 — '싸다/비싸다'가 부호 하나로 갈리는 표라서 +를 생략하지 않는다. */
function fmtSigned(ratio: number) {
  const pct = ratio * 100;
  const rounded = Math.round(pct);
  if (rounded === 0) return '0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
}

function fmtRate(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function sameAssumption(a: number, b: number) {
  return Math.abs(a - b) < 0.0001;
}

export function SensitivityHeatmap({
  matrix,
  currentWacc,
  currentGrowth,
  language,
}: SensitivityHeatmapProps) {
  if (!matrix || matrix.length === 0 || !matrix[0]?.length) return null;

  const ko = language === 'ko';
  const columnCount = matrix[0].length;
  const cells = matrix.flat();
  const margins = cells.map(cell => cell.safetyMargin);
  const minMargin = Math.min(...margins);
  const maxMargin = Math.max(...margins);
  const activeCell = cells.find(
    cell => sameAssumption(cell.wacc, currentWacc) && sameAssumption(cell.growth, currentGrowth),
  ) ?? null;

  // 표 안에서 부호가 갈리면 결론 자체가 가정에 따라 뒤집힌다 — 한 칸만 보면 안 된다는 신호.
  const verdictFlips = minMargin < 0 && maxMargin > 0;

  // 성장률을 좌우로 옮겨도 값이 같은 경우가 있다(모델이 초기 성장률에 상한을 둔다).
  // 그때 "성장률은 영향이 없다"고 오해하지 않도록 이유를 적어준다.
  const growthHasNoEffect = columnCount > 1
    && matrix.every(row => row.every(cell => Math.abs(cell.safetyMargin - row[0].safetyMargin) < 0.005));

  const activeColumn = matrix[0].findIndex(cell => sameAssumption(cell.growth, currentGrowth));
  const columnIndex = activeColumn >= 0 ? activeColumn : Math.floor(columnCount / 2);
  const lowestWaccCell = matrix[0][columnIndex];
  const highestWaccCell = matrix[matrix.length - 1][columnIndex];
  const waccSwing = Math.abs(lowestWaccCell.safetyMargin - highestWaccCell.safetyMargin);

  const activeVerdict = activeCell
    ? activeCell.safetyMargin > 0.1
      ? (ko ? '계산대로면 지금 주가가 싼 쪽입니다.' : 'On these numbers the current price looks cheap.')
      : activeCell.safetyMargin < -0.1
        ? (ko ? '계산대로면 지금 주가가 비싼 쪽입니다.' : 'On these numbers the current price looks expensive.')
        : (ko ? '계산값과 지금 주가가 비슷합니다.' : 'Fair value and the current price are close.')
    : null;

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/15 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('sensitivityTitle', language)}
        </h4>
        <span className="text-[10px] text-muted-foreground">
          {t('sensitivityCurrentAssumption', language)} · WACC {fmtRate(currentWacc)} / g {fmtRate(currentGrowth)}
        </span>
      </div>

      <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        {t('sensitivityIntro', language)}
      </p>

      <div
        className="grid gap-px text-[10px]"
        style={{ gridTemplateColumns: `repeat(${columnCount + 1}, minmax(0, 1fr))` }}
      >
        <div className="flex flex-col items-center justify-center rounded-sm bg-muted/30 p-2 text-center font-medium leading-tight text-muted-foreground">
          <span>{ko ? '할인율 ＼ 성장률' : 'WACC ＼ g'}</span>
          {ko && <span className="text-[8px] opacity-70">WACC ＼ g</span>}
        </div>
        {matrix[0].map(cell => (
          <div key={`growth-${cell.growth}`} className="rounded-sm bg-muted/30 p-2 text-center font-mono text-muted-foreground">
            {fmtRate(cell.growth)}
          </div>
        ))}
        {matrix.map(row => [
          <div key={`wacc-${row[0]?.wacc ?? 'row'}`} className="rounded-sm bg-muted/30 p-2 text-center font-mono text-muted-foreground">
            {fmtRate(row[0]?.wacc ?? 0)}
          </div>,
          ...row.map(cell => {
            const active = sameAssumption(cell.wacc, currentWacc) && sameAssumption(cell.growth, currentGrowth);
            const band = bandOf(cell.safetyMargin);
            const readout = ko
              ? `할인율 ${fmtRate(cell.wacc)}, 성장률 ${fmtRate(cell.growth)} 가정 → 적정가가 지금 주가보다 ${fmtSigned(cell.safetyMargin)} (${bandLabel(band, language)})`
              : `WACC ${fmtRate(cell.wacc)}, growth ${fmtRate(cell.growth)} → fair value ${fmtSigned(cell.safetyMargin)} vs today's price (${bandLabel(band, language)})`;
            return (
              <div
                key={`${cell.wacc}-${cell.growth}`}
                className={`min-h-[44px] rounded-sm p-2 text-center font-semibold text-white ${active ? 'border-2 border-yellow-400' : 'border border-transparent'}`}
                style={{ backgroundColor: band.color }}
                title={readout}
                aria-label={readout}
              >
                {fmtSigned(cell.safetyMargin)}
              </div>
            );
          }),
        ])}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {t('sensitivityAxisHint', language)}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        <span className="font-medium">{t('sensitivityLegendLabel', language)}</span>
        {BANDS.map(band => (
          <span key={band.color} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ backgroundColor: band.color }} />
            <span>{bandLabel(band, language)}</span>
            <span className="font-mono opacity-70">{bandRange(band, language)}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 space-y-1.5 rounded-md border border-border/50 bg-background/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        {activeCell && (
          <p>
            <span className="font-semibold text-foreground">{t('sensitivityCurrentCellLabel', language)}</span>
            {ko
              ? ` — 이 보고서가 실제로 쓴 가정입니다(할인율 ${fmtRate(activeCell.wacc)}, 성장률 ${fmtRate(activeCell.growth)}). 여기서 계산한 적정가는 지금 주가보다 `
              : ` — the assumptions this report actually used (WACC ${fmtRate(activeCell.wacc)}, growth ${fmtRate(activeCell.growth)}). Fair value there sits `}
            <span className="font-semibold text-foreground">{fmtSigned(activeCell.safetyMargin)}</span>
            {ko ? ' 입니다. ' : ' versus today\'s price. '}
            {activeVerdict}
          </p>
        )}
        <p>
          {verdictFlips
            ? (ko
              ? `가정을 표 끝까지 흔들면 ${fmtSigned(minMargin)} ~ ${fmtSigned(maxMargin)}로 부호가 뒤집힙니다. 결론이 가정에 크게 좌우되니 한 칸만 보고 판단하지 마세요.`
              : `Across the whole grid the result spans ${fmtSigned(minMargin)} to ${fmtSigned(maxMargin)}, flipping sign. The verdict hinges on the assumptions — don't read a single cell.`)
            : (ko
              ? `가정을 표 끝까지 흔들어도 ${fmtSigned(minMargin)} ~ ${fmtSigned(maxMargin)} 범위에 머뭅니다 — 결론의 방향은 바뀌지 않습니다.`
              : `Across the whole grid the result stays between ${fmtSigned(minMargin)} and ${fmtSigned(maxMargin)} — the direction of the verdict does not change.`)}
        </p>
        {waccSwing >= 0.02 && (
          <p>
            {ko
              ? `할인율을 ${fmtRate(lowestWaccCell.wacc)}로 낮추면 ${fmtSigned(lowestWaccCell.safetyMargin)}, ${fmtRate(highestWaccCell.wacc)}로 올리면 ${fmtSigned(highestWaccCell.safetyMargin)}입니다 — 결과를 가장 크게 움직이는 것은 할인율입니다.`
              : `Cutting the discount rate to ${fmtRate(lowestWaccCell.wacc)} gives ${fmtSigned(lowestWaccCell.safetyMargin)}; raising it to ${fmtRate(highestWaccCell.wacc)} gives ${fmtSigned(highestWaccCell.safetyMargin)} — the discount rate moves the answer most.`}
          </p>
        )}
        {growthHasNoEffect && (
          <p>
            {ko
              ? '성장률 칸을 좌우로 옮겨도 숫자가 같습니다 — 이 모델은 초기 성장률에 상한을 두기 때문에, 이미 상한을 넘은 구간에서는 성장률을 조금 올리고 내려도 결과에 반영되지 않습니다.'
              : 'Moving across the growth columns changes nothing — the model caps the early-stage growth rate, so once the assumption is already above that cap, small growth changes do not reach the result.'}
          </p>
        )}
      </div>
    </div>
  );
}
