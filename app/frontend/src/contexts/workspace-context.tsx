import type { LanguageModel } from '@/data/models';
import {
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

export interface Workspace extends WorkspaceState {}

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

  const value = useMemo<WorkspaceContextType>(() => ({
    workspace,
    setTickers: (value: string) => {
      setWorkspace(prev => ({ ...prev, tickers: value }));
    },
    setDateRange: (startDate: string, endDate: string) => {
      setWorkspace(prev => ({ ...prev, startDate, endDate }));
    },
    setSelectedModel: (model: LanguageModel | null) => {
      setWorkspace(prev => ({ ...prev, selectedModel: model }));
    },
    toggleAgent: (key: string) => {
      setWorkspace(prev => {
        const selectedAgents = new Set(prev.selectedAgents);
        if (selectedAgents.has(key)) {
          selectedAgents.delete(key);
        } else {
          selectedAgents.add(key);
        }
        return { ...prev, selectedAgents };
      });
    },
    setSelectedAgents: (agents: Set<string>) => {
      setWorkspace(prev => ({ ...prev, selectedAgents: new Set(agents) }));
    },
    setUseDataSandboxOverrides: (value: boolean) => {
      setWorkspace(prev => ({ ...prev, useDataSandboxOverrides: value }));
    },
    resetWorkspace: () => {
      setWorkspace(createDefaultWorkspace());
      WorkspaceStorageService.clearWorkspace();
    },
    patchWorkspace: (patch: Partial<Workspace>) => {
      setWorkspace(prev => ({ ...prev, ...cloneWorkspacePatch(patch) }));
    },
  }), [workspace]);

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
