import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface PathBetweenArgs {
  from: string;
  to: string;
  maxPaths?: number | undefined;
  maxDepth?: number | undefined;
}

const DEFAULT_MAX_PATHS = 5;
const DEFAULT_MAX_DEPTH = 12;

export async function handlePathBetween(
  cache: ProjectCache,
  args: PathBetweenArgs,
): Promise<{
  from: string;
  to: string;
  connected: boolean;
  shortestLength: number | null;
  paths: string[][];
  truncated: boolean;
  missing: string[];
  suggestions: Record<string, string[]>;
  warnings: string[];
}> {
  await cache.refresh();
  const scan = cache.getScan();
  const graph = cache.getImportGraph();

  const fromResolution = resolveRepoPath(scan, args.from, 'file');
  const toResolution = resolveRepoPath(scan, args.to, 'file');
  const from = fromResolution.path;
  const to = toResolution.path;

  const missing = new Set<string>();
  if (!fromResolution.exists) missing.add(from);
  if (!toResolution.exists) missing.add(to);

  const suggestions: Record<string, string[]> = {};
  if (fromResolution.suggestions.length > 0) suggestions[fromResolution.input] = fromResolution.suggestions;
  if (toResolution.suggestions.length > 0) suggestions[toResolution.input] = toResolution.suggestions;

  const warnings = [...fromResolution.warnings, ...toResolution.warnings];

  const maxPaths = normalizePositive(args.maxPaths, DEFAULT_MAX_PATHS);
  const maxDepth = normalizePositive(args.maxDepth, DEFAULT_MAX_DEPTH);

  const missingPaths = [...missing];

  if (missingPaths.length > 0 || from === to) {
    return {
      from,
      to,
      connected: from === to && missingPaths.length === 0,
      shortestLength: from === to && missingPaths.length === 0 ? 0 : null,
      paths: from === to && missingPaths.length === 0 ? [[from]] : [],
      truncated: false,
      missing: missingPaths,
      suggestions,
      warnings,
    };
  }

  const paths = findShortestPaths(graph.importedBy, from, to, maxDepth, maxPaths + 1);
  const truncated = paths.length > maxPaths;
  const pagedPaths = paths.slice(0, maxPaths);

  return {
    from,
    to,
    connected: paths.length > 0,
    shortestLength: paths.length > 0 ? paths[0]!.length - 1 : null,
    paths: pagedPaths,
    truncated,
    missing: missingPaths,
    suggestions,
    warnings,
  };
}

function findShortestPaths(
  adjacency: Map<string, string[]>,
  start: string,
  goal: string,
  maxDepth: number,
  limit: number,
): string[][] {
  const results: string[][] = [];
  const queue: string[][] = [[start]];
  let shortestDepth: number | undefined;

  while (queue.length > 0) {
    const path = queue.shift()!;
    const last = path[path.length - 1]!;
    const depth = path.length - 1;

    if (shortestDepth !== undefined && depth >= shortestDepth) {
      continue;
    }

    if (depth >= maxDepth) {
      continue;
    }

    for (const next of adjacency.get(last) ?? []) {
      if (path.includes(next)) {
        continue;
      }

      const extended = [...path, next];

      if (next === goal) {
        shortestDepth ??= extended.length - 1;
        results.push(extended);
        if (results.length >= limit) {
          return results;
        }
        continue;
      }

      queue.push(extended);
    }
  }

  return results;
}

function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}
