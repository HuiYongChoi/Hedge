import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/language-context';
import { t } from '@/lib/language-preferences';
import { cn } from '@/lib/utils';
import { Archive, Database, Network, PanelBottom, PanelLeft, PanelRight, Search, Settings, Workflow } from 'lucide-react';

interface TopBarProps {
  isFlowTab: boolean;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  isBottomCollapsed: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onToggleBottom: () => void;
  onSettingsClick: () => void;
  onSearchClick: () => void;
  onDataSandboxClick: () => void;
  hasFlowTab: boolean;
  isFlowTabActive: boolean;
  isOpeningFlow: boolean;
  onFlowClick: () => void;
  onSavedAnalysesClick: () => void;
  onStockCompareClick: () => void;
}

export function TopBar({
  isFlowTab,
  isLeftCollapsed,
  isRightCollapsed,
  isBottomCollapsed,
  onToggleLeft,
  onToggleRight,
  onToggleBottom,
  onSettingsClick,
  onSearchClick,
  onDataSandboxClick,
  hasFlowTab,
  isFlowTabActive,
  isOpeningFlow,
  onFlowClick,
  onSavedAnalysesClick,
  onStockCompareClick,
}: TopBarProps) {
  const { language } = useLanguage();
  const navButtonClass = "h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-700 transition-colors";

  return (
    <div className="flex items-center gap-1 rounded-full border border-border/70 bg-background/90 px-1.5 py-1 shadow-sm">
      {isFlowTab && (
        <>
          {/* Left Sidebar Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleLeft}
            className={cn(
              "h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-700 transition-colors",
              !isLeftCollapsed && "text-foreground"
            )}
            aria-label="Toggle left sidebar"
            title="Toggle Left Side Bar (⌘B)"
          >
            <PanelLeft size={16} />
          </Button>

          {/* Bottom Panel Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleBottom}
            className={cn(
              "h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-700 transition-colors",
              !isBottomCollapsed && "text-foreground"
            )}
            aria-label="Toggle bottom panel"
            title="Toggle Bottom Panel (⌘J)"
          >
            <PanelBottom size={16} />
          </Button>

          {/* Right Sidebar Toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleRight}
            className={cn(
              "h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-700 transition-colors",
              !isRightCollapsed && "text-foreground"
            )}
            aria-label="Toggle right sidebar"
            title="Toggle Right Side Bar (⌘I)"
          >
            <PanelRight size={16} />
          </Button>

          {/* Divider */}
          <div className="w-px h-5 bg-ramp-grey-700 mx-1" />
        </>
      )}

      {/* Flow Tab */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onFlowClick}
        disabled={isOpeningFlow}
        className={cn(
          navButtonClass,
          isFlowTabActive && "text-foreground"
        )}
        aria-label="Focus flow tab"
        title={hasFlowTab ? 'Flow 탭으로 이동' : '최근 Flow를 열거나 기본 Flow를 생성합니다'}
      >
        <Workflow size={16} />
        <span className="hidden 2xl:inline">{t('flows', language)}</span>
      </Button>

      {/* Data Sandbox */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onDataSandboxClick}
        className={navButtonClass}
        aria-label="Open Data Sandbox"
        title="Data Sandbox"
      >
        <Database size={16} />
        <span className="hidden 2xl:inline">{t('dataSandbox', language)}</span>
      </Button>

      {/* Stock Analysis */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSearchClick}
        className={navButtonClass}
        aria-label="Open Stock Analysis"
        title="Stock Analysis"
      >
        <Search size={16} />
        <span className="hidden 2xl:inline">{t('stockAnalysis', language)}</span>
      </Button>

      {/* Stock Comparison */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onStockCompareClick}
        className={navButtonClass}
        aria-label="Open Stock Comparison"
        title="Stock Comparison (종목간 비교)"
      >
        <Network size={16} />
        <span className="hidden 2xl:inline">{t('stockCompare', language)}</span>
      </Button>

      {/* Saved Analyses */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSavedAnalysesClick}
        className={navButtonClass}
        aria-label="Open Saved Analyses"
        title="Saved Analyses (저장 분석)"
      >
        <Archive size={16} />
        <span className="hidden 2xl:inline">{t('savedAnalyses', language)}</span>
      </Button>

      {/* Settings */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onSettingsClick}
        className="h-8 w-8 rounded-full p-0 text-muted-foreground transition-colors hover:bg-ramp-grey-700 hover:text-foreground"
        aria-label="Open settings"
        title="Open Settings (⌘,)"
      >
        <Settings size={16} />
      </Button>
    </div>
  );
}
