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
type PathBetweenReason =
  | 'connected'
  | 'same-file'
  | 'missing'
  | 'forward-path-only'
  | 'not-connected';

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
  direction: 'reverse-dependency';
  queryInterpretedAs: 'change-propagation';
  reason: PathBetweenReason;
  directionHint: string;
  forwardDependencyPath?: string[];
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
      direction: 'reverse-dependency',
      queryInterpretedAs: 'change-propagation',
      reason: missingPaths.length > 0 ? 'missing' : 'same-file',
      directionHint: buildDirectionHint(),
      missing: missingPaths,
      suggestions,
      warnings,
    };
  }

  const paths = findShortestPaths(graph.importedBy, from, to, maxDepth, maxPaths + 1);
  const truncated = paths.length > maxPaths;
  const pagedPaths = paths.slice(0, maxPaths);
  const forwardDependencyPath =
    paths.length === 0
      ? findShortestPaths(graph.dependsOn, from, to, maxDepth, 1)[0]
      : undefined;
  const directionWarnings = forwardDependencyPath
    ? [
        `未找到从 ${from} 到 ${to} 的反向依赖传播链，但存在正向依赖路径；如果你想问“入口依赖了什么”，请使用 repomapper_imports 或正向依赖语义。`,
      ]
    : [];

  return {
    from,
    to,
    connected: paths.length > 0,
    shortestLength: paths.length > 0 ? paths[0]!.length - 1 : null,
    paths: pagedPaths,
    truncated,
    direction: 'reverse-dependency',
    queryInterpretedAs: 'change-propagation',
    reason: paths.length > 0 ? 'connected' : forwardDependencyPath ? 'forward-path-only' : 'not-connected',
    directionHint: buildDirectionHint(),
    ...(forwardDependencyPath === undefined ? {} : { forwardDependencyPath }),
    missing: missingPaths,
    suggestions,
    warnings: [...warnings, ...directionWarnings],
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

function buildDirectionHint(): string {
  return '此工具沿反向依赖图查找“from 的变更如何传播到 to”。如果你要看 from import 了什么，请用 repomapper_imports；如果结果未连通但 forwardDependencyPath 存在，说明两者存在正向依赖路径而非变更传播路径。';
}
