import type { CacheStatus, ProjectCache } from '../cache.js';

export async function handleStatus(cache: ProjectCache): Promise<CacheStatus> {
  await cache.ensureReady();
  return cache.getStatus();
}
