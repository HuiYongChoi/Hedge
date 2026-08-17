import { useCallback, useState } from 'react';
import { ChevronDown, ExternalLink, Loader2 } from 'lucide-react';

import type { ReportLanguage } from './types';

const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' &&
   (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:8000'
    : '/hedge-api');

/**
 * 공시 원문 펼쳐보기.
 *
 * 보고서 본문에 "실제 표현 확인" 같은 숙제를 적어 두면 독자가 할 일이 남는다.
 * 대신 원문을 여기에 붙여 두고 필요할 때만 펼치게 한다 — 평소에는 접혀 있어
 * 흐름을 끊지 않고, 확인하고 싶을 때는 한 번의 클릭으로 끝난다.
 *
 * 처음 펼칠 때만 받아온다. 원문은 수십만 자라 미리 받으면 화면이 느려진다.
 */

interface FilingSection {
  item: string;
  title: string;
  text: string;
  char_count: number;
  truncated: boolean;
}

interface FilingPayload {
  company_name?: string | null;
  form?: string | null;
  filing_date?: string | null;
  source_url?: string | null;
  sections?: FilingSection[];
  error?: string | null;
  supported?: boolean;
}

interface Props {
  ticker: string;
  language: ReportLanguage;
}

export function FilingSourceDisclosure({ ticker, language }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<FilingPayload | null>(null);

  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next || payload || loading || !ticker) return;
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/sec-filings/${encodeURIComponent(ticker)}?period=annual`,
      );
      setPayload(response.ok ? await response.json() : { error: `HTTP ${response.status}` });
    } catch (error: any) {
      setPayload({ error: error?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }, [open, payload, loading, ticker]);

  const label = language === 'ko' ? '공시 원문 펼쳐보기' : 'Open filing source text';
  const sections = payload?.sections || [];
  const unavailable = payload && !loading && sections.length === 0;

  return (
    <div className="mt-4 rounded-lg border border-border/60">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>
          {label}
          {payload?.form ? ` · ${payload.form}` : ''}
          {payload?.filing_date ? ` (${payload.filing_date})` : ''}
        </span>
        <span className="flex items-center gap-1.5">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {loading && (
            <p className="text-xs text-muted-foreground">
              {language === 'ko' ? '원문을 불러오는 중입니다…' : 'Loading source text…'}
            </p>
          )}

          {unavailable && (
            <p className="text-xs text-muted-foreground">
              {language === 'ko'
                ? '이 종목의 공시 원문을 가져오지 못했습니다. 아래 출처 링크에서 직접 확인할 수 있습니다.'
                : 'Could not load the filing text. Use the source link below instead.'}
            </p>
          )}

          {sections.map(section => (
            <section key={section.item}>
              <h4 className="mb-1 text-xs font-semibold text-foreground">
                {section.title}
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {section.char_count.toLocaleString()}
                  {language === 'ko' ? '자' : ' chars'}
                  {section.truncated ? (language === 'ko' ? ' · 일부' : ' · excerpt') : ''}
                </span>
              </h4>
              {/* 원문은 길다. 스스로 스크롤해 페이지 흐름을 밀어내지 않게 한다. */}
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-sans text-[11px] leading-relaxed text-muted-foreground">
                {section.text}
              </pre>
            </section>
          ))}

          {payload?.source_url && (
            <a
              href={payload.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {language === 'ko' ? '공시 원문 전체 보기' : 'View full filing'}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
