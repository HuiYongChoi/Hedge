import { useLanguage } from '@/contexts/language-context';
import { useTabsContext } from '@/contexts/tabs-context';
import { cn } from '@/lib/utils';
import { TabService } from '@/services/tab-service';
import { FileText, FolderOpen } from 'lucide-react';
import { useEffect } from 'react';

interface TabContentProps {
  className?: string;
}

export function TabContent({ className }: TabContentProps) {
  const { tabs, activeTabId, openTab } = useTabsContext();
  const { language } = useLanguage();

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Restore content for active tab that doesn't have it (from localStorage restoration)
  useEffect(() => {
    if (activeTab && !activeTab.content) {
      try {
        const restoredTab = TabService.restoreTab({
          type: activeTab.type,
          title: activeTab.title,
          flow: activeTab.flow,
          metadata: activeTab.metadata,
        });

        // Update the tab with restored content
        openTab({
          id: activeTab.id,
          type: restoredTab.type,
          title: restoredTab.title,
          content: restoredTab.content,
          flow: restoredTab.flow,
          metadata: restoredTab.metadata,
        });
      } catch (error) {
        console.error('Failed to restore tab content:', error);
      }
    }
  }, [activeTab, openTab]);

  if (!activeTab) {
    return (
      <div className={cn(
        "h-full w-full flex items-center justify-center bg-background text-muted-foreground",
        className
      )}>
        <div className="text-center space-y-4">
          <FolderOpen size={48} className="mx-auto text-muted-foreground/50" />
          <div>
            <div className="text-xl font-medium mb-2">
              {language === 'ko' ? 'AI 헤지펀드에 오신 것을 환영합니다' : 'Welcome to the AI Hedge Fund'}
            </div>
            <div className="text-sm max-w-md">
              {language === 'ko'
                ? '왼쪽 사이드바(⌘B)에서 플로우를 만들어 탭에서 열거나, 설정(⌘,)에서 환경설정을 구성하세요.'
                : 'Create a flow from the left sidebar (⌘B) to open it in a tab, or open settings (⌘,) to configure your preferences.'}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
            <FileText size={14} />
            <span>{language === 'ko' ? '플로우가 탭에서 열립니다' : 'Flows now open in tabs'}</span>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state if active tab content is being restored
  if (!activeTab.content) {
    return (
      <div className={cn(
        "h-full w-full flex items-center justify-center bg-background text-muted-foreground",
        className
      )}>
        <div className="text-center">
          <div className="text-lg font-medium mb-2">
            {language === 'ko' ? `${activeTab.title} 불러오는 중...` : `Loading ${activeTab.title}...`}
          </div>
        </div>
      </div>
    );
  }

  // Render all tabs simultaneously but only show the active one.
  // This preserves component state (e.g. Stock Analysis results) when switching tabs.
  return (
    <div className={cn("h-full w-full bg-background overflow-hidden relative", className)}>
      {tabs.map(tab => {
        if (!tab.content) return null;
        return (
          <div
            key={tab.id}
            className={cn(
              "absolute inset-0 h-full w-full",
              tab.id !== activeTabId && "hidden"
            )}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
