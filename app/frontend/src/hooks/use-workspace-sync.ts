import { useWorkspace } from '@/contexts/workspace-context';
import { useEffect, useRef } from 'react';

interface UseWorkspaceSyncOptions {
  enabled: boolean;
  nodeTickers: string;
  nodeStartDate: string;
  nodeEndDate: string;
  setNodeTickers: (value: string) => void;
  setNodeStartDate: (value: string) => void;
  setNodeEndDate: (value: string) => void;
}

interface WorkspaceSyncSnapshot {
  tickers: string;
  startDate: string;
  endDate: string;
}

export function useWorkspaceSync({
  enabled,
  nodeTickers,
  nodeStartDate,
  nodeEndDate,
  setNodeTickers,
  setNodeStartDate,
  setNodeEndDate,
}: UseWorkspaceSyncOptions) {
  const { workspace, patchWorkspace } = useWorkspace();
  const lastWorkspaceAppliedRef = useRef<WorkspaceSyncSnapshot | null>(null);
  const applyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (applyTimeoutRef.current !== null) {
        window.clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = null;
      }
      lastWorkspaceAppliedRef.current = null;
      return;
    }

    const nextWorkspaceSnapshot = {
      tickers: workspace.tickers,
      startDate: workspace.startDate,
      endDate: workspace.endDate,
    };
    const needsNodeUpdate =
      nodeTickers !== nextWorkspaceSnapshot.tickers ||
      nodeStartDate !== nextWorkspaceSnapshot.startDate ||
      nodeEndDate !== nextWorkspaceSnapshot.endDate;

    if (!needsNodeUpdate) {
      return;
    }

    lastWorkspaceAppliedRef.current = nextWorkspaceSnapshot;

    if (applyTimeoutRef.current !== null) {
      window.clearTimeout(applyTimeoutRef.current);
    }

    applyTimeoutRef.current = window.setTimeout(() => {
      if (nodeTickers !== nextWorkspaceSnapshot.tickers) {
        setNodeTickers(nextWorkspaceSnapshot.tickers);
      }
      if (nodeStartDate !== nextWorkspaceSnapshot.startDate) {
        setNodeStartDate(nextWorkspaceSnapshot.startDate);
      }
      if (nodeEndDate !== nextWorkspaceSnapshot.endDate) {
        setNodeEndDate(nextWorkspaceSnapshot.endDate);
      }
      applyTimeoutRef.current = null;
    }, 0);

    return () => {
      if (applyTimeoutRef.current !== null) {
        window.clearTimeout(applyTimeoutRef.current);
        applyTimeoutRef.current = null;
      }
    };
  }, [
    enabled,
    setNodeEndDate,
    setNodeStartDate,
    setNodeTickers,
    workspace.endDate,
    workspace.startDate,
    workspace.tickers,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const lastAppliedSnapshot = lastWorkspaceAppliedRef.current;
    if (lastAppliedSnapshot) {
      if (
        lastAppliedSnapshot.tickers === nodeTickers &&
        lastAppliedSnapshot.startDate === nodeStartDate &&
        lastAppliedSnapshot.endDate === nodeEndDate
      ) {
        lastWorkspaceAppliedRef.current = null;
      }
      return;
    }

    const patch: Partial<typeof workspace> = {};

    if (nodeTickers !== workspace.tickers) {
      patch.tickers = nodeTickers;
    }
    if (nodeStartDate !== workspace.startDate) {
      patch.startDate = nodeStartDate;
    }
    if (nodeEndDate !== workspace.endDate) {
      patch.endDate = nodeEndDate;
    }

    if (Object.keys(patch).length === 0) {
      return;
    }

    patchWorkspace(patch);
  }, [
    enabled,
    nodeEndDate,
    nodeStartDate,
    nodeTickers,
    patchWorkspace,
    workspace.endDate,
    workspace.startDate,
    workspace.tickers,
  ]);
}
