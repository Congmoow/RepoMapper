import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface TreeArgs {
  path?: string | undefined;
  depth?: number | undefined;
}

interface TreeEntry {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  depth: number;
  parent?: string;
}

export async function handleTree(
  cache: ProjectCache,
  args: TreeArgs = {},
): Promise<{
  root: string;
  depth: number;
  tree: string;
  entries: TreeEntry[];
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
  const structuredEntries = visible.map((entry) => toTreeEntry(entry, root));

  return {
    root,
    depth,
    tree: renderTree(root, visible),
    entries: structuredEntries,
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
  };
}

function renderTree(root: string, entries: string[]): string {
  if (entries.length === 0) {
    return root;
  }

  return [
    root,
    ...entries
      .filter((entry) => entry.replace(/\/$/, '') !== root)
      .map((entry) => {
        const displayEntry = entry.replace(/\/$/, '');
        const name = displayEntry.split('/').at(-1) ?? displayEntry;
        const marker = entry.endsWith('/') ? `${name}/` : name;
        const depth = Math.max(relativeDepth(entry, root) - 1, 0);
        return `${'  '.repeat(depth)}- ${marker}`;
      }),
  ].join('\n');
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

function toTreeEntry(entry: string, root: string): TreeEntry {
  const isDirectory = entry.endsWith('/');
  const path = entry.replace(/\/$/, '');
  const parent = parentPath(path);
  const depth = relativeDepth(path, root);

  return {
    path,
    name: path === '.' ? '.' : path.split('/').at(-1)!,
    kind: isDirectory ? 'dir' : 'file',
    depth,
    ...(parent === undefined ? {} : { parent }),
  };
}

function parentPath(entry: string): string | undefined {
  const index = entry.lastIndexOf('/');
  if (index === -1) {
    return undefined;
  }

  return entry.slice(0, index);
}

function normalizeDepth(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }

  return Math.floor(value);
}
