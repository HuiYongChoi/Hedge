import { t } from '@/lib/language-preferences';
import type { ReportLanguage } from './types';

type StickyVerdict = 'buy' | 'sell' | 'hold' | 'on_hold';

interface StickyAnalysisHeaderProps {
  ticker: string;
  companyName: string | null;
  country: string | null;
  currentPrice: number | null;
  currency: string;
  priceChangePct: number | null;
  verdict: StickyVerdict;
  /** 신호가 종합점수와 충돌할 때 밴드 라벨('비중 축소' 등)로 대체 표기 — helpers.resolveHeadlineVerdict 참조 */
  verdictLabelOverride?: string | null;
  verdictConfidence: number | null;
  marginOfSafetyPct: number | null;
  /** 안전마진의 분자. 숫자 뒤에 "무엇 대비 무엇"인지를 붙이기 위해 받는다. */
  intrinsicValuePerShare?: number | null;
  /** 위 적정가를 실제로 만든 할인율(다모다란 자기자본비용). 없으면 WACC 로 떨어진다.
   *  WACC 자체는 헤더에서 뺐다 — 우측 '자본비용 · 자본수익성' 카드가 두 값을
   *  어느 엔진의 것인지와 함께 보여 준다. */
  discountRate?: number | null;
  trailingPe?: number | null;
  trailingEps?: number | null;
  forwardPe?: number | null;
  consensusUpsidePct?: number | null;
  targetRangePosPct?: number | null;
  language: ReportLanguage;
  placement?: 'report' | 'tabHeader';
}

function formatCurrency(value: number | null, currency: string, language: ReportLanguage) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return t('stickyPriceUnavailable', language);
  }
  const code = currency.toUpperCase();
  if (code === 'KRW') return `₩${value.toLocaleString('ko-KR', { maximumFractionDigits: 0 })}`;
  if (code === 'JPY') return `¥${value.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`;
  return `$${value.toLocaleString(language === 'ko' ? 'ko-KR' : 'en-US', { maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null, signed = false) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function normalizeConfidence(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

// 배수(PER 등)는 소수 첫째자리까지. 'x' 접미사는 붙이지 않는다(프로젝트 표기 규칙).
function formatRatio(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(1);
}

function verdictLabel(verdict: StickyVerdict, language: ReportLanguage) {
  if (verdict === 'buy') return t('verdictBuy', language);
  if (verdict === 'sell') return t('verdictSell', language);
  return t('verdictHold', language);
}

function verdictClasses(verdict: StickyVerdict) {
  if (verdict === 'buy') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if (verdict === 'sell') return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
}

function VerdictChip({
  verdict,
  labelOverride,
  confidence,
  language,
}: {
  verdict: StickyVerdict;
  labelOverride?: string | null;
  confidence: number | null;
  language: ReportLanguage;
}) {
  const normalizedConfidence = normalizeConfidence(confidence);
  return (
    <span className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdictClasses(verdict)}`}>
      <span>{labelOverride || verdictLabel(verdict, language)}</span>
      {normalizedConfidence !== null && (
        <span className="ml-1.5 font-mono text-[10px] opacity-90">
          {t('stickyConfidenceLabel', language)} {Math.round(normalizedConfidence)}
        </span>
      )}
    </span>
  );
}

export function StickyAnalysisHeader({
  ticker,
  companyName,
  country,
  currentPrice,
  currency,
  priceChangePct,
  verdict,
  verdictLabelOverride,
  verdictConfidence,
  marginOfSafetyPct,
  intrinsicValuePerShare,
  discountRate,
  trailingPe,
  trailingEps,
  forwardPe,
  consensusUpsidePct,
  targetRangePosPct,
  language,
  placement = 'report',
}: StickyAnalysisHeaderProps) {
  const isTabHeader = placement === 'tabHeader';
  const perText = formatRatio(trailingPe);
  const fwdPerText = formatRatio(forwardPe);
  const epsText = trailingEps !== null && trailingEps !== undefined && Number.isFinite(trailingEps) && trailingEps > 0
    ? formatCurrency(trailingEps, currency, language)
    : null;
  const hasMargin = marginOfSafetyPct !== null && marginOfSafetyPct !== undefined && Number.isFinite(marginOfSafetyPct);
  const hasConsensusUpside = consensusUpsidePct !== null && consensusUpsidePct !== undefined && Number.isFinite(consensusUpsidePct);
  const hasTargetRangePos = targetRangePosPct !== null && targetRangePosPct !== undefined && Number.isFinite(targetRangePosPct);
  // 안전마진은 내재가치가 있어야 계산된다. 모멘텀·매크로 분석처럼 내재가치가 없으면
  // 컨센서스 상승여력과 목표가 레인지 위치를 대체 지표로 보여준다.
  const showFallback = !hasMargin && (hasConsensusUpside || hasTargetRangePos);
  const primaryTickerLabel = companyName || ticker;
  const secondaryTickerLabel = companyName ? ticker : null;
  const targetMarginLabel = t('targetMarginPctLabel', language);

  // 안전마진은 화면에 퍼센트 하나로만 뜬다. -178% 같은 값을 만나면 독자는 그것이
  // 계산 오류인지 실제 결과인지 판단할 수 없다. 분자(내재가치)와 분모(현재가)를
  // 숫자 뒤에 그대로 붙여, 화면 위에서 바로 검산되게 한다.
  const marginBasisText = (() => {
    const iv = intrinsicValuePerShare;
    if (iv === null || iv === undefined || !Number.isFinite(iv)) return null;
    if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) return null;
    const ivText = formatCurrency(iv, currency, language);
    const priceText = formatCurrency(currentPrice, currency, language);
    return language === 'ko'
      ? `내재가치 ${ivText} vs 현재가 ${priceText}`
      : `IV ${ivText} vs price ${priceText}`;
  })();

  return (
    <div
      className={isTabHeader
        ? 'mt-3 border-t border-border/60 pt-3'
        : 'sticky top-0 z-30 -mx-4 mb-4 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/70'}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{primaryTickerLabel}</span>
          {secondaryTickerLabel && (
            <span className="font-mono text-xs font-medium text-muted-foreground">{secondaryTickerLabel}</span>
          )}
          {country && (
            <span className="rounded border border-border/60 px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
              {country}
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {/* 현재가는 화면의 모든 값이 견주는 기준점이다. 다른 칩과 같은 크기로
              두면 그 기준이 눈에 안 들어온다. */}
          <span className="font-mono text-lg font-bold leading-none text-foreground sm:text-xl">
            {formatCurrency(currentPrice, currency, language)}
          </span>
          {priceChangePct !== null && priceChangePct !== undefined && Number.isFinite(priceChangePct) && (
            <span className={`font-mono text-xs ${priceChangePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {priceChangePct > 0 ? '+' : ''}{(priceChangePct * 100).toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground sm:gap-x-3">
        <VerdictChip verdict={verdict} labelOverride={verdictLabelOverride} confidence={verdictConfidence} language={language} />
        <span className="text-border">·</span>
        {showFallback ? (
          <>
            {hasConsensusUpside && (
              <span className="whitespace-nowrap">
                {t('consensusUpsideLabel', language)} <span className="font-mono text-foreground">{formatPercent(consensusUpsidePct ?? null, true)}</span>
              </span>
            )}
            {hasTargetRangePos && (
              <>
                {hasConsensusUpside && <span className="text-border">·</span>}
                <span className="whitespace-nowrap">
                  {t('targetRangePosLabel', language)} <span className="font-mono text-foreground">{formatPercent(targetRangePosPct ?? null)}</span>
                </span>
              </>
            )}
          </>
        ) : (
          <span className="whitespace-nowrap">
            {targetMarginLabel} <span className="font-mono text-foreground">{formatPercent(marginOfSafetyPct, true)}</span>
            {marginBasisText && (
              <span className="ml-1 font-mono text-[10px] text-muted-foreground">({marginBasisText})</span>
            )}
          </span>
        )}
        {/* 헤더의 내재가치·안전마진은 다모다란 엔진이 자기자본비용으로 할인해
            만든 값이다. 여기에 가치평가 분석가의 WACC 를 적어 두면, 독자가 그
            할인율로 위 적정가를 검산하다 맞지 않는 답을 얻는다(실측: WACC 10.5%
            vs 실제 사용 9.0%). 실제로 쓰인 할인율을 그 이름으로 적는다. */}
        {discountRate !== null && discountRate !== undefined && Number.isFinite(discountRate) && (
          <>
            <span className="hidden text-border sm:inline">·</span>
            <span className="hidden whitespace-nowrap sm:inline">
              {t('stickyDiscountRateLabel', language)}{' '}
              <span className="font-mono text-foreground">{formatPercent(discountRate)}</span>
            </span>
          </>
        )}
        {perText && (
          <>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">
              {t('stickyPerLabel', language)} <span className="font-mono text-foreground">{perText}</span>
            </span>
          </>
        )}
        {epsText && (
          <>
            <span className="text-border">·</span>
            <span className="whitespace-nowrap">
              {t('stickyEpsLabel', language)} <span className="font-mono text-foreground">{epsText}</span>
            </span>
          </>
        )}
        {fwdPerText && (
          <>
            <span className="hidden text-border sm:inline">·</span>
            <span className="hidden whitespace-nowrap sm:inline">
              {t('stickyFwdPerLabel', language)} <span className="font-mono text-foreground">{fwdPerText}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
}
