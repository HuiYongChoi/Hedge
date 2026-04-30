import type { LanguageModel } from '@/data/models';

export interface WorkspaceState {
  tickers: string;
  startDate: string;
  endDate: string;
  selectedModel: LanguageModel | null;
  selectedAgents: Set<string>;
  useDataSandboxOverrides: boolean;
}

interface StoredWorkspaceState {
  tickers: string;
  startDate: string;
  endDate: string;
  selectedModel: LanguageModel | null;
  selectedAgents: string[];
  useDataSandboxOverrides: boolean;
}

export const WORKSPACE_STORAGE_KEY = 'hedgefund.workspace.v1';

function formatDate(date: Date) {
  return date.toISOString().split('T')[0];
}

export function createDefaultWorkspace(now: Date = new Date()): WorkspaceState {
  const endDate = new Date(now);
  const startDate = new Date(now);
  startDate.setMonth(startDate.getMonth() - 3);

  return {
    tickers: '',
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    selectedModel: null,
    selectedAgents: new Set(),
    useDataSandboxOverrides: false,
  };
}

export function serializeWorkspace(workspace: WorkspaceState): StoredWorkspaceState {
  return {
    tickers: workspace.tickers,
    startDate: workspace.startDate,
    endDate: workspace.endDate,
    selectedModel: workspace.selectedModel,
    selectedAgents: Array.from(workspace.selectedAgents),
    useDataSandboxOverrides: workspace.useDataSandboxOverrides,
  };
}

export function deserializeWorkspace(
  raw: string | null,
  fallback: WorkspaceState = createDefaultWorkspace(),
): WorkspaceState {
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredWorkspaceState>;

    return {
      tickers: typeof parsed.tickers === 'string' ? parsed.tickers : fallback.tickers,
      startDate: typeof parsed.startDate === 'string' ? parsed.startDate : fallback.startDate,
      endDate: typeof parsed.endDate === 'string' ? parsed.endDate : fallback.endDate,
      selectedModel: parsed.selectedModel ?? fallback.selectedModel,
      selectedAgents: Array.isArray(parsed.selectedAgents)
        ? new Set(parsed.selectedAgents.filter((value): value is string => typeof value === 'string'))
        : fallback.selectedAgents,
      useDataSandboxOverrides:
        typeof parsed.useDataSandboxOverrides === 'boolean'
          ? parsed.useDataSandboxOverrides
          : fallback.useDataSandboxOverrides,
    };
  } catch (error) {
    console.warn('Failed to deserialize workspace state from localStorage', error);
    return fallback;
  }
}

export class WorkspaceStorageService {
  static loadWorkspace(defaultWorkspace: WorkspaceState = createDefaultWorkspace()): WorkspaceState {
    try {
      return deserializeWorkspace(localStorage.getItem(WORKSPACE_STORAGE_KEY), defaultWorkspace);
    } catch (error) {
      console.warn('Failed to load workspace state from localStorage', error);
      return defaultWorkspace;
    }
  }

  static saveWorkspace(workspace: WorkspaceState): boolean {
    try {
      localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(serializeWorkspace(workspace)));
      return true;
    } catch (error) {
      console.warn('Failed to save workspace state to localStorage', error);
      return false;
    }
  }

  static clearWorkspace(): boolean {
    try {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      return true;
    } catch (error) {
      console.warn('Failed to clear workspace state from localStorage', error);
      return false;
    }
  }
}
