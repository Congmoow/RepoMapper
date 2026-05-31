import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface PathArgs {
  path: string;
}

export async function handleImports(
  cache: ProjectCache,
  args: PathArgs,
): Promise<{
  path: string;
  imports: string[];
  count: number;
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const resolution = resolveRepoPath(cache.getScan(), args.path, 'file');
  const imports = resolution.exists
    ? (cache.getImportGraph().dependsOn.get(resolution.path) ?? [])
    : [];

  return {
    path: resolution.path,
    imports,
    count: imports.length,
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
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const resolution = resolveRepoPath(cache.getScan(), args.path, 'file');
  const dependents = resolution.exists
    ? (cache.getImportGraph().importedBy.get(resolution.path) ?? [])
    : [];

  return {
    path: resolution.path,
    dependents,
    count: dependents.length,
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
  };
}
