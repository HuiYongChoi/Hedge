import { useEffect, useState } from 'react';
import { ExternalLink, FileText, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { t } from '@/lib/language-preferences';
import { brokerReportService } from '@/services/broker-report-service';
import type { BrokerReportDetail, BrokerReportSummary } from '@/services/broker-report-service';
import type { BrokerTarget, ReportLanguage } from './types';
import { formatMoney, formatPct, signalTone, upsideClass, upsidePct } from './utils';

interface BrokerReportDialogProps {
  ticker: string;
  broker: BrokerTarget | null;   // null이면 닫힘
  reports: BrokerReportSummary[];
  currentPrice: number | null;
  currency: string;
  language: ReportLanguage;
  onClose: () => void;
}

/**
 * 증권사 카드 클릭 → 그 증권사가 이 종목에 대해 낸 리포트를 보여주는 모달.
 * 좌측은 리포트 목록(최신순), 우측은 선택된 리포트의 목표가·투자의견·본문 요약.
 * 원문 PDF와 네이버 원문 페이지 링크를 함께 제공한다.
 */
export function BrokerReportDialog({
  ticker,
  broker,
  reports,
  currentPrice,
  currency,
  language,
  onClose,
}: BrokerReportDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrokerReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  // 모달이 열릴 때마다 최신 리포트를 기본 선택
  useEffect(() => {
    if (!broker) {
      setSelectedId(null);
      setDetail(null);
      setFailed(false);
      return;
    }
    setSelectedId(reports[0]?.id ?? null);
  }, [broker, reports]);

  useEffect(() => {
    if (!broker || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    brokerReportService.fetchDetail(ticker, selectedId).then(d => {
      if (cancelled) return;
      setDetail(d);
      setFailed(d === null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [ticker, broker, selectedId]);

  if (!broker) return null;

  const tone = signalTone(broker.signal);
  const upside = upsidePct(broker.target_price, currentPrice);
  const selected = reports.find(r => r.id === selectedId) ?? null;
  // 리포트 목표가와 컨센서스 표의 목표가는 시점이 달라 어긋날 수 있다.
  const detailUpside = detail?.target_price != null
    ? upsidePct(detail.target_price, currentPrice)
    : null;

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl gap-3 p-5">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex flex-wrap items-baseline gap-2 text-base">
            <span className="text-white">{broker.name}</span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone.bg} ${tone.text}`}>
              {tone.label}
            </span>
            <span className="font-mono text-sm text-white">
              {formatMoney(broker.target_price, currency, { maximumFractionDigits: 0 })}
            </span>
            {upside !== null && (
              <span className={`font-mono text-xs ${upsideClass(upside)}`}>{formatPct(upside)}</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('pcpReportDialogSubtitle', language)
              .replace('{ticker}', ticker)
              .replace('{n}', `${reports.length}`)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[210px_1fr]">
          {/* ── 리포트 목록 ── */}
          <ul className="max-h-[52vh] space-y-1 overflow-y-auto pr-1">
            {reports.map(report => {
              const active = report.id === selectedId;
              return (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(report.id)}
                    className={[
                      'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                      active
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'border-border/50 bg-card/40 hover:bg-card',
                    ].join(' ')}
                  >
                    <div className="font-mono text-[10px] text-foreground/50">
                      {report.published_date}
                    </div>
                    <div className="text-[11px] leading-snug text-white">{report.title}</div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* ── 본문 ── */}
          <div className="max-h-[52vh] overflow-y-auto rounded-lg border border-border/50 bg-card/40 p-3">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-foreground/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('pcpReportLoading', language)}
              </div>
            )}

            {!loading && failed && (
              <div className="space-y-2 text-xs text-foreground/70">
                <p>{t('pcpReportLoadFailed', language)}</p>
                {selected && (
                  <a
                    href={selected.detail_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                  >
                    {t('pcpReportOpenSource', language)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            {!loading && detail && (
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-white">{detail.title}</h4>
                  <p className="mt-0.5 font-mono text-[10px] text-foreground/50">
                    {detail.broker} · {detail.published_date}
                  </p>
                </div>

                {(detail.target_price != null || detail.opinion) && (
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-border/40 bg-background/60 px-2.5 py-2">
                    {detail.target_price != null && (
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[10px] text-foreground/55">
                          {t('pcpReportTargetPrice', language)}
                        </span>
                        <span className="font-mono text-sm font-semibold text-white">
                          {formatMoney(detail.target_price, currency, { maximumFractionDigits: 0 })}
                        </span>
                        {detailUpside !== null && (
                          <span className={`font-mono text-[11px] ${upsideClass(detailUpside)}`}>
                            {formatPct(detailUpside)}
                          </span>
                        )}
                      </span>
                    )}
                    {detail.opinion && (
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[10px] text-foreground/55">
                          {t('pcpReportOpinion', language)}
                        </span>
                        <span className="text-sm font-semibold text-white">{detail.opinion}</span>
                      </span>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  {detail.body.length > 0 ? (
                    detail.body.map((paragraph, i) => (
                      <p key={i} className="text-[12px] leading-relaxed text-foreground/85">
                        {paragraph}
                      </p>
                    ))
                  ) : (
                    <p className="text-xs text-foreground/60">{t('pcpReportNoBody', language)}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-2 text-[11px]">
                  {detail.pdf_url && (
                    <a
                      href={detail.pdf_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
                    >
                      <FileText className="h-3 w-3" />
                      {t('pcpReportOpenPdf', language)}
                    </a>
                  )}
                  <a
                    href={detail.detail_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-foreground/60 hover:underline"
                  >
                    {t('pcpReportOpenSource', language)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="ml-auto text-[10px] text-foreground/40">
                    {t('pcpReportSourceNaver', language)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
