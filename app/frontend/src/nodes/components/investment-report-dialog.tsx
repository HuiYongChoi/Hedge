import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
    return (
      <div className="space-y-1 text-sm leading-relaxed">
        {parsedReasoning.split('\n').map((line, idx) => (
          <p key={idx} className="whitespace-pre-wrap">{line}</p>
        ))}
      </div>
    );
  }

  if (typeof parsedReasoning === 'object' && !Array.isArray(parsedReasoning)) {
    return (
      <div className="space-y-1.5 text-sm">
        {Object.entries(parsedReasoning).map(([key, value]) => (
          <div key={key}>
            <span className="font-semibold">{toLabel(key)}: </span>
            <span>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
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
    const label = signal === 'bullish' ? t('bullish') :
                  signal === 'bearish' ? t('bearish') : t('neutral');
    return <span className="text-sm">{label}</span>;
  };

  const getConfidenceBadge = (confidence: number) => {
    const rounded = Number(confidence.toFixed(1));
    return <span className="text-sm">{rounded}%</span>;
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
                      <div key={`reasoning-${ticker}`} className="mt-2">
                        <p className="font-semibold mb-1">{ticker} {t('summary')}</p>
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
                  <AccordionTrigger className="text-base font-medium px-4 py-3">
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
                              <CardHeader className="pb-3">
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
