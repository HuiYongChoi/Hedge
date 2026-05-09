import type { LanguageModel } from '@/data/models';
import {
  useCallback,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createDefaultWorkspace,
  WorkspaceStorageService,
  type WorkspaceState,
} from '@/services/workspace-storage';

export type Workspace = WorkspaceState;

interface WorkspaceContextType {
  workspace: Workspace;
  setTickers: (value: string) => void;
  setDateRange: (startDate: string, endDate: string) => void;
  setSelectedModel: (model: LanguageModel | null) => void;
  toggleAgent: (key: string) => void;
  setSelectedAgents: (agents: Set<string>) => void;
  setUseDataSandboxOverrides: (value: boolean) => void;
  resetWorkspace: () => void;
  patchWorkspace: (patch: Partial<Workspace>) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function cloneWorkspacePatch(patch: Partial<Workspace>): Partial<Workspace> {
  if (!patch.selectedAgents) {
    return patch;
  }

  return {
    ...patch,
    selectedAgents: new Set(patch.selectedAgents),
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    WorkspaceStorageService.loadWorkspace(createDefaultWorkspace()),
  );
  const persistTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      WorkspaceStorageService.saveWorkspace(workspace);
    }, 300);

    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
    };
  }, [workspace]);

  const setTickers = useCallback((value: string) => {
    setWorkspace(prev => ({ ...prev, tickers: value }));
  }, []);

  const setDateRange = useCallback((startDate: string, endDate: string) => {
    setWorkspace(prev => ({ ...prev, startDate, endDate }));
  }, []);

  const setSelectedModel = useCallback((model: LanguageModel | null) => {
    setWorkspace(prev => ({ ...prev, selectedModel: model }));
  }, []);

  const toggleAgent = useCallback((key: string) => {
    setWorkspace(prev => {
      const selectedAgents = new Set(prev.selectedAgents);
      if (selectedAgents.has(key)) {
        selectedAgents.delete(key);
      } else {
        selectedAgents.add(key);
      }
      return { ...prev, selectedAgents };
    });
  }, []);

  const setSelectedAgents = useCallback((agents: Set<string>) => {
    setWorkspace(prev => ({ ...prev, selectedAgents: new Set(agents) }));
  }, []);

  const setUseDataSandboxOverrides = useCallback((value: boolean) => {
    setWorkspace(prev => ({ ...prev, useDataSandboxOverrides: value }));
  }, []);

  const resetWorkspace = useCallback(() => {
    setWorkspace(createDefaultWorkspace());
    WorkspaceStorageService.clearWorkspace();
  }, []);

  const patchWorkspace = useCallback((patch: Partial<Workspace>) => {
    setWorkspace(prev => ({ ...prev, ...cloneWorkspacePatch(patch) }));
  }, []);

  const value = useMemo<WorkspaceContextType>(() => ({
    workspace,
    setTickers,
    setDateRange,
    setSelectedModel,
    toggleAgent,
    setSelectedAgents,
    setUseDataSandboxOverrides,
    resetWorkspace,
    patchWorkspace,
  }), [
    patchWorkspace,
    resetWorkspace,
    setDateRange,
    setSelectedAgents,
    setSelectedModel,
    setTickers,
    setUseDataSandboxOverrides,
    toggleAgent,
    workspace,
  ]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextType {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}
