import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useNodeContext } from '@/contexts/node-context';
import { useLanguage } from '@/contexts/language-context';
import { copyTextToClipboard, stringifyClipboardValue } from '@/utils/clipboard-utils';
import { formatTextIntoParagraphs, isJsonString } from '@/utils/text-utils';
import { AlignJustify, Copy, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AgentFormulaToggle } from '@/components/ui/agent-formula-tooltip';

/** Converts snake_case / camelCase key to a readable label */
function toReadableKey(key: string, t: any): string {
  // If translation exists exactly
  const translated = t(key as any);
  if (translated !== key) return translated;

  const formatted = key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, l => l.toUpperCase());

  const translatedFormatted = t(formatted as any);
  if (translatedFormatted !== formatted) return translatedFormatted;

  return formatted;
}

/** Signal badge color */
function signalColor(signal: string): string {
  const s = signal.toLowerCase();
  if (s === 'bullish' || s === 'buy' || s === 'positive') return 'bg-green-500/15 text-green-400 border border-green-500/30';
  if (s === 'bearish' || s === 'sell' || s === 'negative') return 'bg-red-500/15 text-red-400 border border-red-500/30';
  return 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30';
}

function formatKoreanWonAmount(rawValue: string): string {
  const number = Number(rawValue.replace(/,/g, ''));
  if (!Number.isFinite(number)) return rawValue;

  const sign = number < 0 ? '-' : '';
  const absNumber = Math.abs(number);
  const joUnit = 1_000_000_000_000;
  const eokUnit = 100_000_000;

  if (absNumber >= joUnit) {
    let jo = Math.floor(absNumber / joUnit);
    const eok = Math.floor((absNumber % joUnit) / eokUnit);
    return eok > 0
      ? `${sign}${jo.toLocaleString()}조 ${eok.toLocaleString()}억 원`
      : `${sign}${jo.toLocaleString()}조 원`;
  }

  if (absNumber >= eokUnit) {
    return `${sign}${Math.floor(absNumber / eokUnit).toLocaleString()}억 원`;
  }

  return `${sign}${Math.round(absNumber).toLocaleString()}원`;
}

function normalizeFinancialDisplayText(text: string): string {
  return text
    .replace(/현금으로\s*돌아오는\s*힘/g, '잉여현금흐름(FCF) 창출력')
    .replace(/영업현금흐름\(FCF\)/g, '잉여현금흐름(FCF)')
    .replace(/\bNet\s+cash\b/gi, '순현금(Net Cash)')
    // Remove trailing 'x' from Debt-To-Equity expressions (e.g. 0.11x -> 0.11)
    .replace(/\bD\/E\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\s*\(([^)]+)\)/gi, 'Debt-To-Equity(부채비율): $1 ($2)')
    .replace(/\bD\/E\s*[:=]?\s*(\d+(?:\.\d+)?)\s*x\b/gi, 'Debt-To-Equity(부채비율): $1')
    .replace(/(Debt-To-Equity\(부채비율\):?\s*)(\d+(?:\.\d+)?)\s*x\b/gi, '$1$2')
    .replace(/(부채비율[^\d]{0,4})(\d+(?:\.\d+)?)\s*x\b/g, '$1$2')
    .replace(/(Debt-To-Equity\(부채비율\):?\s*\d+(?:\.\d+)?)\s*\(([^)]+)\)/g, '$1 ($2)')
    // Any large number suffixed with 원 -> convert to 조/억 units for readability
    .replace(
      /(?:~|약\s*)?(₩|KRW\s*)?([0-9]{1,3}(?:[,\s][0-9]{3}){2,}(?:\.\d+)?|[0-9]{9,}(?:\.\d+)?)\s*원/gi,
      (_match, _currency: string | undefined, rawNumber: string) => formatKoreanWonAmount(rawNumber.replace(/[,\s]/g, '')),
    )
    // Market Cap / Intrinsic Value label with explicit KRW / ₩ prefix
    .replace(
      /(시가\s*총액|시가총액|Market Cap\(시가총액\)|Market Cap|Intrinsic Value\(내재가치\)|Intrinsic Value|내재가치)\s*[:：]?\s*(?:~|약\s*)?(₩|KRW\s+)([0-9]{1,3}(?:[,\s][0-9]{3})+(?:\.\d+)?|[0-9]{9,}(?:\.\d+)?)/gi,
      (_match, label: string, _currency: string, rawNumber: string) => `${label.replace(/\s+/g, ' ').trim()}: ${formatKoreanWonAmount(rawNumber.replace(/[,\s]/g, ''))}`,
    );
}

const FINANCIAL_METRIC_CHIP_PATTERN =
  /(Debt-To-Equity\(부채비율\)|잉여현금흐름\(FCF\)\s*수익률|FCF\s*수익률|순현금\(Net Cash\)|EV\/EBITDA|EV\/EBIT|Current Ratio|유동비율)/i;

function renderInlineFinancialText(text: string): React.ReactNode[] {
  const normalizedText = normalizeFinancialDisplayText(text);
  return normalizedText.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((segment, index) => {
    const isBold = segment.startsWith('**') && segment.endsWith('**');
    const content = isBold ? segment.slice(2, -2) : segment;

    if (!isBold) {
      return <span key={index}>{content}</span>;
    }

    if (FINANCIAL_METRIC_CHIP_PATTERN.test(content)) {
      return (
        <span
          key={index}
          className="financial-metric-chip inline-flex items-center rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary"
        >
          {content}
        </span>
      );
    }

    return (
      <strong key={index} className="font-semibold text-foreground">
        {content}
      </strong>
    );
  });
}

function renderFinancialParagraph(paragraph: string, index: number): React.ReactElement {
  const normalizedParagraph = normalizeFinancialDisplayText(paragraph.trim());
  const heading = normalizedParagraph.match(/^(#{2,6})\s+(.+)$/);
  if (heading) {
    return (
      <h4 key={index} className="mt-4 first:mt-0 text-base font-semibold text-foreground">
        {renderInlineFinancialText(heading[2])}
      </h4>
    );
  }

  const numbered = normalizedParagraph.match(/^(\d+\.)\s+(.+)$/);
  if (numbered) {
    return (
      <p key={index} className="flex gap-2 text-sm leading-7 text-muted-foreground">
        <span className="font-semibold text-primary">{numbered[1]}</span>
        <span>{renderInlineFinancialText(numbered[2])}</span>
      </p>
    );
  }

  const bullet = normalizedParagraph.match(/^[-•]\s+(.+)$/);
  if (bullet) {
    return (
      <p key={index} className="flex gap-2 text-sm leading-7 text-muted-foreground">
        <span className="mt-[0.65rem] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
        <span>{renderInlineFinancialText(bullet[1])}</span>
      </p>
    );
  }

  return (
    <p key={index} className="text-sm leading-7 text-muted-foreground">
      {renderInlineFinancialText(normalizedParagraph)}
    </p>
  );
}

/** Recursively render a value from a parsed JSON object in human-readable form */
function RenderValue({ value }: { value: any }): React.ReactElement {
  const { t } = useLanguage();

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">N/A</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-400' : 'text-red-400'}>{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-blue-400 font-mono">{value.toLocaleString()}</span>;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (['bullish', 'buy', 'bearish', 'sell', 'neutral', 'hold', 'positive', 'negative'].includes(lower)) {
      return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${signalColor(lower)}`}>{t(lower as any).toUpperCase()}</span>;
    }
    return <span className="text-foreground leading-relaxed">{renderInlineFinancialText(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc list-inside space-y-1 mt-1">
        {value.map((item, i) => (
          <li key={i}><RenderValue value={item} /></li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <div className="space-y-2 mt-1 pl-3 border-l border-border">
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <span className="text-xs text-muted-foreground font-medium">{toReadableKey(k, t)}: </span>
            <RenderValue value={v} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

/** Human-readable display for an analysis value (string JSON or object) */
function AnalysisView({ content }: { content: unknown }) {
  const { t } = useLanguage();
  if (!content) return null;
  const contentString = stringifyClipboardValue(content);

  // Try to parse as JSON and display structured
  if (isJsonString(contentString)) {
    try {
      const parsed = JSON.parse(contentString);
      if (typeof parsed === 'object' && parsed !== null) {
        return (
          <div className="space-y-3">
            {Object.entries(parsed).map(([key, value]) => (
              <div key={key} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="text-xs font-semibold text-primary mb-1.5 uppercase tracking-wide">
                  {toReadableKey(key, t)}
                </div>
                <RenderValue value={value} />
              </div>
            ))}
          </div>
        );
      }
    } catch (_) {}
  }

  // Plain text fallback
  const paragraphs = formatTextIntoParagraphs(normalizeFinancialDisplayText(contentString));
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {paragraphs.map((p, i) => renderFinancialParagraph(p, i))}
    </div>
  );
}

interface AgentOutputDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  nodeId: string;
  flowId: string | null;
}

export function AgentOutputDialog({
  isOpen,
  onOpenChange,
  name,
  nodeId,
  flowId
}: AgentOutputDialogProps) {
  const { getAgentNodeDataForFlow } = useNodeContext();

  const agentNodeData = getAgentNodeDataForFlow(flowId);
  const nodeData = agentNodeData[nodeId] || {
    status: 'IDLE',
    ticker: null,
    message: '',
    messages: [],
    lastUpdated: 0
  };

  const messages = nodeData.messages || [];
  const nodeStatus = nodeData.status;

  const [copySuccess, setCopySuccess] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const initialFocusRef = useRef<HTMLDivElement>(null);
  const { t, language } = useLanguage();

  // Collect all analysis from all messages into a single analysis dictionary
  const allAnalysis = messages
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) // Sort by timestamp
    .reduce<Record<string, unknown>>((acc, msg) => {
      // Add analysis from this message to our accumulated analysis
      if (msg.analysis && Object.keys(msg.analysis).length > 0) {
        // Filter out null values before adding to our accumulated decisions
        const validDecisions = Object.entries(msg.analysis)
          .filter(([_, value]) => value !== null && value !== undefined)
          .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
          }, {} as Record<string, unknown>);

        if (Object.keys(validDecisions).length > 0) {
          // Combine with accumulated decisions, newer messages overwrite older ones for the same ticker
          return { ...acc, ...validDecisions };
        }
      }
      return acc;
    }, {});

  // Get all unique tickers that have decisions
  const tickersWithDecisions = Object.keys(allAnalysis);

  // Reset selected ticker when node changes
  useEffect(() => {
    setSelectedTicker(null);
  }, [nodeId]);

  // If no ticker is selected but we have decisions, select the first one
  useEffect(() => {
    if (tickersWithDecisions.length > 0 && (!selectedTicker || !tickersWithDecisions.includes(selectedTicker))) {
      setSelectedTicker(tickersWithDecisions[0]);
    }
  }, [tickersWithDecisions, selectedTicker]);

  // Get the selected decision text
  const selectedDecision = selectedTicker && allAnalysis[selectedTicker] ? allAnalysis[selectedTicker] : null;

  const copyToClipboard = async () => {
    if (selectedDecision) {
      const didCopy = await copyTextToClipboard(selectedDecision);
      if (didCopy) {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } else {
        console.error('Failed to copy text');
      }
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      defaultOpen={false}
      modal={true}
    >
      <DialogTrigger asChild>
        <div className="border-t border-border p-3 flex justify-end items-center cursor-pointer hover:bg-accent/50" onClick={() => onOpenChange(true)}>
          <div className="flex items-center gap-1">
            <div className="text-subtitle text-muted-foreground">{t('output')}</div>
            <AlignJustify className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </div>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-[1200px] w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        autoFocus={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <DialogTitle className="text-xl">{name}</DialogTitle>
          </div>
          <AgentFormulaToggle agentKey={nodeId} language={language as 'ko' | 'en'} />
        </DialogHeader>

        <div className="pt-2 flex-1 min-h-0 flex flex-col" ref={initialFocusRef} tabIndex={-1}>
          {/* Analysis Section (full width — log panel removed for readability) */}
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium text-primary">{t('analysis')}</h3>
            <div className="flex items-center gap-2">
              {tickersWithDecisions.length > 0 && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground font-medium">Ticker:</span>
                  <select
                    className="text-xs p-1 rounded bg-background border border-border cursor-pointer"
                    value={selectedTicker || ''}
                    onChange={(e) => setSelectedTicker(e.target.value)}
                    autoFocus={false}
                  >
                    {tickersWithDecisions.map((ticker) => (
                      <option key={ticker} value={ticker}>
                        {ticker}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-lg p-4 bg-muted/10">
            {tickersWithDecisions.length > 0 ? (
              selectedDecision ? (
                <>
                  <div className="mb-4 pb-3 border-b border-border flex justify-between items-center">
                    <h4 className="font-semibold text-lg">{t('summaryFor')} {selectedTicker}</h4>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs relative"
                      onClick={copyToClipboard}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      {copySuccess ? t('copied') : t('copy')}
                    </Button>
                  </div>
                  <AnalysisView content={selectedDecision} />
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {nodeStatus === 'IN_PROGRESS'
                    ? t('analysisInProgress')
                    : t('noAnalysisForTicker')}
                </div>
              )
            ) : nodeStatus === 'IN_PROGRESS' ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Analysis in progress...
              </div>
            ) : nodeStatus === 'COMPLETE' ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Analysis completed with no results
              </div>
            ) : nodeStatus === 'ERROR' ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Analysis failed
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                No analysis available
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
