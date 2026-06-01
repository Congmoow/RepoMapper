import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface PathArgs {
  path: string;
  limit?: number | undefined;
  offset?: number | undefined;
}

function paginate<T>(
  items: T[],
  limit: number | undefined,
  offset: number | undefined,
): { page: T[]; total: number; offset: number; truncated: boolean } {
  const total = items.length;
  const start = normalizeOffset(offset, total);
  const page = limit === undefined ? items.slice(start) : items.slice(start, start + normalizeLimit(limit));
  return {
    page,
    total,
    offset: start,
    truncated: start + page.length < total,
  };
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 0;
  }
  return Math.floor(value);
}

function normalizeOffset(value: number | undefined, total: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 0;
  }
  return Math.min(Math.floor(value), total);
}

export async function handleImports(
  cache: ProjectCache,
  args: PathArgs,
): Promise<{
  path: string;
  imports: string[];
  count: number;
  total: number;
  offset: number;
  truncated: boolean;
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const resolution = resolveRepoPath(cache.getScan(), args.path, 'file');
  const allImports = resolution.exists
    ? (cache.getImportGraph().dependsOn.get(resolution.path) ?? [])
    : [];
  const { page, total, offset, truncated } = paginate(allImports, args.limit, args.offset);

  return {
    path: resolution.path,
    imports: page,
    count: page.length,
    total,
    offset,
    truncated,
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
  };
}

export async function handleDependents(
  cache: ProjectCache,
  args: PathArgs,
): Promise<{
  path: string;
  dependents: string[];
  count: number;
  total: number;
  offset: number;
  truncated: boolean;
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const resolution = resolveRepoPath(cache.getScan(), args.path, 'file');
  const allDependents = resolution.exists
    ? (cache.getImportGraph().importedBy.get(resolution.path) ?? [])
    : [];
  const { page, total, offset, truncated } = paginate(allDependents, args.limit, args.offset);

  return {
    path: resolution.path,
    dependents: page,
    count: page.length,
    total,
    offset,
    truncated,
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
  };
}
