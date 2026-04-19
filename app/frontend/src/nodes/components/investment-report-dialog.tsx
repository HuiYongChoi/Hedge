import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { extractBaseAgentKey } from '@/data/node-mappings';
import { useLanguage } from '@/contexts/language-context';
import { createAgentDisplayNames } from '@/utils/text-utils';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

interface InvestmentReportDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  outputNodeData: any;
  connectedAgentIds: Set<string>;
}

type ActionType = 'buy' | 'sell' | 'long' | 'short' | 'cover' | 'hold';

/** Convert snake_case key to readable label */
function toLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/** Render reasoning that may be a string or an object, always as human-readable text */
function ReasoningView({ reasoning }: { reasoning: any }) {
  if (!reasoning) return null;

  let parsedReasoning = reasoning;
  if (typeof reasoning === 'string') {
    const trimmed = reasoning.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        parsedReasoning = JSON.parse(trimmed);
      } catch (e) {
        // Not valid JSON, keep as string
      }
    }
  }

  if (typeof parsedReasoning === 'string') {
    const lines = parsedReasoning.split('\n');
    return (
      <div className="space-y-1.5 text-sm leading-relaxed">
        {lines.map((line, idx) => {
          if ((line.includes('Details:') || line.includes('details:')) && line.includes(',')) {
            const prefixMatch = line.match(/^(.*?Details:\s*)(.*)/i);
            const prefix = prefixMatch ? prefixMatch[1] : 'Details: ';
            const content = prefixMatch ? prefixMatch[2] : line;
            
            // Split by comma if the next token looks like a key (Word:)
            const parts = content.split(/,\s*(?=[A-Za-z0-9\s]+:)/).filter(Boolean);
            
            if (parts.length > 2) {
              return (
                <div key={idx} className="bg-muted/30 p-3 rounded-md border border-border mt-2 mb-2">
                  <span className="font-semibold text-primary block mb-2">{prefix.trim()}</span>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                    {parts.map((p, i) => {
                      const splitIdx = p.indexOf(':');
                      if (splitIdx !== -1) {
                        const k = p.substring(0, splitIdx).trim();
                        const v = p.substring(splitIdx + 1).trim();
                        return (
                          <li key={i} className="flex">
                            <span className="font-semibold text-muted-foreground mr-2 min-w-[90px]">{k}:</span>
                            <span className="break-all">{v}</span>
                          </li>
                        );
                      }
                      return <li key={i}>{p.trim()}</li>;
                    })}
                  </ul>
                </div>
              );
            }
          }
          return <p key={idx} className="whitespace-pre-wrap">{line}</p>;
        })}
      </div>
    );
  }

  if (typeof parsedReasoning === 'object' && !Array.isArray(parsedReasoning)) {
    return (
      <div className="space-y-2 text-sm">
        {Object.entries(parsedReasoning).map(([key, value]) => (
          <div key={key} className="rounded border border-border bg-muted/20 px-3 py-2">
            <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
              {toLabel(key)}
            </div>
            {typeof value === 'string' ? (
              <p className="leading-relaxed">{value}</p>
            ) : (
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                {JSON.stringify(value, null, 2)}
              </pre>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (Array.isArray(parsedReasoning)) {
    return (
      <ul className="list-disc list-inside text-sm space-y-1">
        {parsedReasoning.map((item: any, i: number) => (
          <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>
        ))}
      </ul>
    );
  }

  return <p className="text-sm">{String(parsedReasoning)}</p>;
}

export function InvestmentReportDialog({
  isOpen,
  onOpenChange,
  outputNodeData,
  connectedAgentIds,
}: InvestmentReportDialogProps) {
  const { t } = useLanguage();

  // Check if this is a backtest result
  if (outputNodeData?.decisions?.backtest?.type === 'backtest_complete') {
    return null;
  }

  if (!outputNodeData || !outputNodeData.decisions) {
    return null;
  }

  const getActionIcon = (action: ActionType) => {
    switch (action) {
      case 'buy':
      case 'long':
      case 'cover':
        return <ArrowUp className="h-4 w-4 text-green-500" />;
      case 'sell':
      case 'short':
        return <ArrowDown className="h-4 w-4 text-red-500" />;
      case 'hold':
        return <Minus className="h-4 w-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getActionLabel = (action: string) => {
    if (action === 'buy' || action === 'long' || action === 'cover') return t('longAction');
    if (action === 'sell' || action === 'short') return t('shortAction');
    if (action === 'hold') return t('holdAction');
    return action;
  };

  const getSignalBadge = (signal: string) => {
    const variant = signal === 'bullish' ? 'success' :
                   signal === 'bearish' ? 'destructive' : 'outline';
    const label = signal === 'bullish' ? t('bullish') :
                  signal === 'bearish' ? t('bearish') : t('neutral');
    return (
      <Badge variant={variant as any}>{label}</Badge>
    );
  };

  const getConfidenceBadge = (confidence: number) => {
    let variant = 'outline';
    if (confidence >= 50) variant = 'success';
    else if (confidence >= 0) variant = 'warning';
    const rounded = Number(confidence.toFixed(1));
    return (
      <Badge variant={variant as any}>{rounded}%</Badge>
    );
  };

  const tickers = Object.keys(outputNodeData.decisions || {});
  const connectedUniqueAgentIds = Array.from(connectedAgentIds);
  const agents = Object.keys(outputNodeData.analyst_signals || {})
    .filter(agent =>
      extractBaseAgentKey(agent) !== 'risk_management_agent' && connectedUniqueAgentIds.includes(agent)
    );

  const agentDisplayNames = createAgentDisplayNames(agents);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{t('investmentReport')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-8 my-4">
          {/* Summary Section */}
          <section>
            <h2 className="text-lg font-semibold mb-4">{t('summary')}</h2>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  {t('recommendedActions')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('tickerCol')}</TableHead>
                      <TableHead>{t('priceCol')}</TableHead>
                      <TableHead>{t('actionCol')}</TableHead>
                      <TableHead>{t('confidenceCol')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickers.map(ticker => {
                      const decision = outputNodeData.decisions[ticker];
                      const currentPrice = outputNodeData.current_prices?.[ticker] || 'N/A';
                      return (
                        <TableRow key={ticker}>
                          <TableCell className="font-medium">{ticker}</TableCell>
                          <TableCell>${typeof currentPrice === 'number' ? currentPrice.toFixed(2) : currentPrice}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {getActionIcon(decision.action as ActionType)}
                              <span className="capitalize">{getActionLabel(decision.action)}</span>
                            </div>
                          </TableCell>
                          <TableCell>{getConfidenceBadge(decision.confidence)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                
                {/* Overall Reasoning from Portfolio Manager */}
                <div className="mt-6 space-y-4">
                  {tickers.map(ticker => {
                    const decision = outputNodeData.decisions[ticker];
                    if (!decision?.reasoning) return null;
                    return (
                      <div key={`reasoning-${ticker}`} className="bg-muted/30 p-4 rounded-md">
                        <h3 className="text-sm font-semibold mb-2">{ticker} {t('summary')}</h3>
                        <ReasoningView reasoning={decision.reasoning} />
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Analyst Signals Section */}
          <section>
            <h2 className="text-lg font-semibold mb-4">{t('analystSignals')}</h2>
            <Accordion type="multiple" className="w-full">
              {tickers.map(ticker => (
                <AccordionItem key={ticker} value={ticker}>
                  <AccordionTrigger className="text-base font-medium px-4 py-3 bg-muted/30 rounded-md hover:bg-muted/50">
                    <div className="flex items-center gap-2">
                      {ticker}
                      <div className="flex items-center gap-1">
                        {getActionIcon(outputNodeData.decisions[ticker].action as ActionType)}
                        <span className="text-sm font-normal text-muted-foreground">
                          {getActionLabel(outputNodeData.decisions[ticker].action)}
                        </span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4 px-1">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4">
                        {agents.map(agent => {
                          const signal = outputNodeData.analyst_signals[agent]?.[ticker];
                          if (!signal) return null;

                          return (
                            <Card key={agent} className="overflow-hidden">
                              <CardHeader className="bg-muted/50 pb-3">
                                <div className="flex items-center justify-between">
                                  <CardTitle className="text-base">
                                    {agentDisplayNames.get(agent) || agent}
                                  </CardTitle>
                                  <div className="flex items-center gap-2">
                                    {getSignalBadge(signal.signal)}
                                    {getConfidenceBadge(signal.confidence)}
                                  </div>
                                </div>
                              </CardHeader>
                              <CardContent className="pt-3">
                                <ReasoningView reasoning={signal.reasoning} />
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
