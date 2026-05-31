import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface TreeArgs {
  path?: string | undefined;
  depth?: number | undefined;
}

export async function handleTree(
  cache: ProjectCache,
  args: TreeArgs = {},
): Promise<{
  root: string;
  depth: number;
  tree: string;
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const depth = normalizeDepth(args.depth, 3);
  const scan = cache.getScan();
  const resolution = resolveRepoPath(scan, args.path ?? '.', 'any');
  const root = resolution.path;
  const entries = [...scan.directories.map((entry) => `${entry}/`), ...scan.files];
  const visible = entries
    .filter((entry) => isUnderRoot(entry, root))
    .filter((entry) => relativeDepth(entry, root) <= depth)
    .sort((left, right) => left.localeCompare(right));

  return {
    root,
    depth,
    tree: renderTree(root, visible),
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
  };
}

function renderTree(root: string, entries: string[]): string {
  if (entries.length === 0) {
    return root;
  }

  return [root, ...entries.map((entry) => `- ${entry}`)].join('\n');
}

function isUnderRoot(entry: string, root: string): boolean {
  if (root === '.') {
    return true;
  }

  const normalized = entry.replace(/\/$/, '');
  return normalized === root || normalized.startsWith(`${root}/`);
}

function relativeDepth(entry: string, root: string): number {
  const normalized = entry.replace(/\/$/, '');
  const relative = root === '.' ? normalized : normalized.slice(root.length).replace(/^\//, '');
  if (relative.length === 0) {
    return 0;
  }

  return relative.split('/').filter(Boolean).length;
}

function normalizeDepth(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}
