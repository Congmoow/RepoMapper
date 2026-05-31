import type { ProjectCache } from '../cache.js';

interface HubsArgs {
  limit?: number | undefined;
}

export async function handleHubs(
  cache: ProjectCache,
  args: HubsArgs = {},
): Promise<{ hubs: Array<{ path: string; dependentCount: number; importsCount: number }> }> {
  await cache.refresh();
  const graph = cache.getImportGraph();
  const limit = normalizeLimit(args.limit, 10);
  const hubs = [...graph.importedBy.entries()]
    .map(([filePath, dependents]) => ({
      path: filePath,
      dependentCount: dependents.length,
      importsCount: graph.dependsOn.get(filePath)?.length ?? 0,
    }))
    .sort(
      (left, right) =>
        right.dependentCount - left.dependentCount || left.path.localeCompare(right.path),
    )
    .slice(0, limit);

  return { hubs };
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}
