import type { CacheStatus, ProjectCache } from '../cache.js';

export async function handleRefresh(cache: ProjectCache): Promise<CacheStatus> {
  await cache.refresh();
  return cache.getStatus();
}
