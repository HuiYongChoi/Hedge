import { WorkspacePill } from '@/components/layout/workspace-pill';
import { BottomPanel } from '@/components/panels/bottom/bottom-panel';
import { LeftSidebar } from '@/components/panels/left/left-sidebar';
import { RightSidebar } from '@/components/panels/right/right-sidebar';
import { TabBar } from '@/components/tabs/tab-bar';
import { TabContent } from '@/components/tabs/tab-content';
import { SidebarProvider } from '@/components/ui/sidebar';
import { FlowProvider, useFlowContext } from '@/contexts/flow-context';
import { LayoutProvider, useLayoutContext } from '@/contexts/layout-context';
import { TabsProvider, useTabsContext } from '@/contexts/tabs-context';
import { WorkspaceProvider } from '@/contexts/workspace-context';
import { useLayoutKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { SidebarStorageService } from '@/services/sidebar-storage';
import { flowService } from '@/services/flow-service';
import { TabService } from '@/services/tab-service';
import { ReactFlowProvider } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import { TopBar } from './layout/top-bar';

// Create a LayoutContent component to access the FlowContext, TabsContext, and LayoutContext
function LayoutContent() {
  const { reactFlowInstance } = useFlowContext();
  const { openTab, activeTabType, flowTabs, focusFirstFlowTab } = useTabsContext();
  const { isBottomCollapsed, expandBottomPanel, collapseBottomPanel, toggleBottomPanel } = useLayoutContext();
  const isFlowTab = activeTabType === 'flow';
  const hasFlowTab = flowTabs.length > 0;
  
  // Initialize sidebar states from storage service
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(() => 
    SidebarStorageService.loadLeftSidebarState(false)
  );
  
  const [isRightCollapsed, setIsRightCollapsed] = useState(() => 
    SidebarStorageService.loadRightSidebarState(false)
  );
  const [savedFlowPanelState, setSavedFlowPanelState] = useState<{
    left: boolean;
    right: boolean;
    bottom: boolean;
  } | null>(null);
  const [isOpeningFlow, setIsOpeningFlow] = useState(false);

  // Track actual sidebar widths for dynamic positioning
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(280);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(300);

  const handleSettingsClick = () => {
    const tabData = TabService.createSettingsTab();
    openTab(tabData);
  };

  const handleSearchClick = () => {
    const tabData = TabService.createStockSearchTab();
    openTab(tabData);
  };

  const handleDataSandboxClick = () => {
    const tabData = TabService.createDataSandboxTab();
    openTab(tabData);
  };

  const handleFlowClick = useCallback(async () => {
    if (hasFlowTab) {
      focusFirstFlowTab();
      return;
    }

    setIsOpeningFlow(true);
    try {
      const flows = await flowService.getFlows();
      const sortedFlows = [...flows].sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at).getTime();
        const dateB = new Date(b.updated_at || b.created_at).getTime();
        return dateB - dateA;
      });
      const targetFlow = sortedFlows.find(flow => !flow.is_template) ?? sortedFlows[0];

      if (targetFlow) {
        const fullFlow = await flowService.getFlow(targetFlow.id);
        openTab(TabService.createFlowTab(fullFlow));
        return;
      }

      const defaultFlow = await flowService.createDefaultFlow(
        reactFlowInstance?.getNodes() || [],
        reactFlowInstance?.getEdges() || [],
        reactFlowInstance?.getViewport() || { x: 0, y: 0, zoom: 1 },
      );
      openTab(TabService.createFlowTab(defaultFlow));
    } catch (error) {
      console.error('Failed to open flow from top navigation:', error);
    } finally {
      setIsOpeningFlow(false);
    }
  }, [focusFirstFlowTab, hasFlowTab, openTab, reactFlowInstance]);

  // Add keyboard shortcuts for toggling sidebars and fit view
  useLayoutKeyboardShortcuts(
    () => { if (isFlowTab) setIsRightCollapsed(!isRightCollapsed); }, // Cmd+I for right sidebar
    () => { if (isFlowTab) setIsLeftCollapsed(!isLeftCollapsed); },   // Cmd+B for left sidebar
    () => reactFlowInstance.fitView({ padding: 0.1, duration: 500 }), // Cmd+O for fit view
    // Note: undo/redo will be handled directly in the Flow component for now
    undefined, // undo
    undefined, // redo
    () => { if (isFlowTab) toggleBottomPanel(); }, // Cmd+J for bottom panel
    handleSettingsClick, // Shift+Cmd+J for settings
  );

  useEffect(() => {
    if (activeTabType === null) return;

    if (activeTabType === 'flow') {
      if (savedFlowPanelState) {
        setIsLeftCollapsed(savedFlowPanelState.left);
        setIsRightCollapsed(savedFlowPanelState.right);
        if (savedFlowPanelState.bottom) {
          collapseBottomPanel();
        } else {
          expandBottomPanel();
        }
        setSavedFlowPanelState(null);
      }
      return;
    }

    setSavedFlowPanelState(prev => prev ?? {
      left: isLeftCollapsed,
      right: isRightCollapsed,
      bottom: isBottomCollapsed,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabType]);

  const effectiveIsLeftCollapsed = isFlowTab ? isLeftCollapsed : true;
  const effectiveIsRightCollapsed = isFlowTab ? isRightCollapsed : true;
  const effectiveIsBottomCollapsed = isFlowTab ? isBottomCollapsed : true;

  // Save sidebar states whenever they change
  useEffect(() => {
    SidebarStorageService.saveLeftSidebarState(isLeftCollapsed);
  }, [isLeftCollapsed]);

  useEffect(() => {
    SidebarStorageService.saveRightSidebarState(isRightCollapsed);
  }, [isRightCollapsed]);

  // Calculate tab bar and bottom panel positioning based on actual sidebar widths
  const getSidebarBasedStyle = () => {
    let left = 0;
    let right = 0;
    
    if (!effectiveIsLeftCollapsed) {
      left = leftSidebarWidth;
    }
    
    if (!effectiveIsRightCollapsed) {
      right = rightSidebarWidth;
    }
    
    return {
      left: `${left}px`,
      right: `${right}px`,
    };
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden relative bg-background">
      {/* Header rail: tabs, workspace context, and app navigation share one layer. */}
      <div 
        className="absolute top-0 z-40 flex items-stretch gap-2 border-b bg-panel pr-2 transition-all duration-200"
        style={getSidebarBasedStyle()}
      >
        <TabBar className="min-w-0 flex-1 border-b-0" />
        <div className="flex shrink-0 items-center py-1">
          <WorkspacePill />
        </div>
        <div className="flex shrink-0 items-center py-1">
          <TopBar
            isFlowTab={isFlowTab}
            isLeftCollapsed={effectiveIsLeftCollapsed}
            isRightCollapsed={effectiveIsRightCollapsed}
            isBottomCollapsed={effectiveIsBottomCollapsed}
            onToggleLeft={() => setIsLeftCollapsed(!isLeftCollapsed)}
            onToggleRight={() => setIsRightCollapsed(!isRightCollapsed)}
            onToggleBottom={toggleBottomPanel}
            onSettingsClick={handleSettingsClick}
            onSearchClick={handleSearchClick}
            onDataSandboxClick={handleDataSandboxClick}
            hasFlowTab={hasFlowTab}
            isFlowTabActive={isFlowTab}
            isOpeningFlow={isOpeningFlow}
            onFlowClick={handleFlowClick}
          />
        </div>
      </div>

      {/* Main content area */}
      <main 
        className="absolute inset-0 overflow-hidden" 
        style={{
          left: !effectiveIsLeftCollapsed ? `${leftSidebarWidth}px` : '0px',
          right: !effectiveIsRightCollapsed ? `${rightSidebarWidth}px` : '0px',
          top: '40px', // Tab bar height
          bottom: !effectiveIsBottomCollapsed ? `${bottomPanelHeight}px` : '0px',
        }}
      >
        <TabContent className="h-full w-full" />
      </main>

      {/* Floating left sidebar */}
      <div className={cn(
        "absolute top-0 left-0 z-30 h-full transition-transform",
        effectiveIsLeftCollapsed && "transform -translate-x-full opacity-0"
      )}>
        <LeftSidebar
          isCollapsed={effectiveIsLeftCollapsed}
          onCollapse={() => setIsLeftCollapsed(true)}
          onExpand={() => setIsLeftCollapsed(false)}
          onWidthChange={setLeftSidebarWidth}
        />
      </div>

      {/* Floating right sidebar */}
      <div className={cn(
        "absolute top-0 right-0 z-30 h-full transition-transform",
        effectiveIsRightCollapsed && "transform translate-x-full opacity-0"
      )}>
        <RightSidebar
          isCollapsed={effectiveIsRightCollapsed}
          onCollapse={() => setIsRightCollapsed(true)}
          onExpand={() => setIsRightCollapsed(false)}
          onWidthChange={setRightSidebarWidth}
        />
      </div>

      {/* Bottom panel */}
      <div 
        className={cn(
          "absolute bottom-0 z-20 transition-transform",
          effectiveIsBottomCollapsed && "transform translate-y-full opacity-0"
        )}
        style={getSidebarBasedStyle()}
      >
        <BottomPanel
          isCollapsed={effectiveIsBottomCollapsed}
          onCollapse={collapseBottomPanel}
          onExpand={expandBottomPanel}
          onToggleCollapse={toggleBottomPanel}
          onHeightChange={setBottomPanelHeight}
        />
      </div>
    </div>
  );
}

export function Layout() {
  return (
    <SidebarProvider defaultOpen={true}>
      <ReactFlowProvider>
        <WorkspaceProvider>
          <FlowProvider>
            <TabsProvider>
              <LayoutProvider>
                <LayoutContent />
              </LayoutProvider>
            </TabsProvider>
          </FlowProvider>
        </WorkspaceProvider>
      </ReactFlowProvider>
    </SidebarProvider>
  );
}
