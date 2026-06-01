import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface ImpactArgs {
  paths: string[];
  depth?: number | undefined;
  minDepth?: number | undefined;
  limit?: number | undefined;
}

export async function handleImpact(
  cache: ProjectCache,
  args: ImpactArgs,
): Promise<{
  roots: string[];
  depth: number;
  minDepth: number;
  impacted: string[];
  totalImpacted: number;
  truncated: boolean;
  levelTotals: Record<number, number>;
  levels: Record<number, string[]>;
  missingRoots: string[];
  suggestions: Record<string, string[]>;
  warnings: string[];
}> {
  await cache.refresh();
  const scan = cache.getScan();
  const graph = cache.getImportGraph();
  const resolutions = args.paths.map((filePath) => resolveRepoPath(scan, filePath, 'file'));
  const roots = resolutions.map((resolution) => resolution.path);
  const traversalRoots = resolutions
    .filter((resolution) => resolution.exists)
    .map((resolution) => resolution.path);
  const missingRoots = resolutions
    .filter((resolution) => !resolution.exists)
    .map((resolution) => resolution.path);
  const suggestions = Object.fromEntries(
    resolutions
      .filter((resolution) => resolution.suggestions.length > 0)
      .map((resolution) => [resolution.input, resolution.suggestions]),
  );
  const warnings = resolutions.flatMap((resolution) => resolution.warnings);
  const depth = normalizeDepth(args.depth, 2);
  const minDepth = Math.min(normalizeDepth(args.minDepth, 1), depth);
  const seen = new Set(traversalRoots);
  const impacted = new Set<string>();
  let frontier = traversalRoots;
  const levels: Record<number, string[]> = {};
  const levelTotals: Record<number, number> = {};

  for (let level = 1; level <= depth; level += 1) {
    const next = new Set<string>();

    for (const filePath of frontier) {
      for (const dependent of graph.importedBy.get(filePath) ?? []) {
        if (!seen.has(dependent)) {
          seen.add(dependent);
          next.add(dependent);
        }
      }
    }

    const values = sortByHubWeight([...next], graph.importedBy);
    if (level >= minDepth) {
      levels[level] = values;
      levelTotals[level] = values.length;
      for (const filePath of values) {
        impacted.add(filePath);
      }
    }
    frontier = values;

    if (frontier.length === 0) {
      break;
    }
  }

  const allImpacted = sortByHubWeight([...impacted], graph.importedBy);
  const limit = normalizeLimit(args.limit);
  const pagedImpacted = limit === undefined ? allImpacted : allImpacted.slice(0, limit);

  return {
    roots,
    depth,
    minDepth,
    impacted: pagedImpacted,
    totalImpacted: allImpacted.length,
    truncated: pagedImpacted.length < allImpacted.length,
    levelTotals,
    levels,
    missingRoots,
    suggestions,
    warnings,
  };
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return undefined;
  }

  return Math.floor(value);
}

function normalizeDepth(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}

function sortByHubWeight(values: string[], importedBy: Map<string, string[]>): string[] {
  return values.sort(
    (left, right) =>
      (importedBy.get(right)?.length ?? 0) - (importedBy.get(left)?.length ?? 0) ||
      left.localeCompare(right),
  );
}
