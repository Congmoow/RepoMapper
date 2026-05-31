import type { ProjectCache } from '../cache.js';

export async function handleStatus(cache: ProjectCache): Promise<{
  indexedFiles: number;
  symbols: number;
  edges: number;
  callEdges: number;
  lastFullScan: string | null;
  lastUpdated: string | null;
  pendingChanges: Array<{ path: string; event: string }>;
  watcherActive: boolean;
  fresh: boolean;
  needsRefresh: boolean;
  refreshInProgress: boolean;
  nextAction: string | null;
}> {
  await cache.ensureReady();
  return cache.getStatus();
}
