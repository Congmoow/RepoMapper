import path from 'node:path';

import type { ScanResult } from '../../types/index.js';
import { readTextFile } from '../../utils/fs.js';
import type { ImportEdge } from '../import-graph.js';

const goModulePathCache = new Map<string, string | undefined>();

export function clearGoModulePathCacheForTesting(): void {
  goModulePathCache.clear();
}

export async function parseGoImports(rootPath: string, scan: ScanResult): Promise<ImportEdge[]> {
  const modulePath = await readGoModulePath(rootPath);
  if (modulePath === undefined) {
    return [];
  }

  const goFiles = scan.files.filter((file) => file.endsWith('.go'));
  const fileEdges = await Promise.all(
    goFiles.map((file) => extractGoImportEdgesForFile(rootPath, file, scan, modulePath)),
  );

  return fileEdges.flat();
}

export async function extractGoImportEdgesForFile(
  rootPath: string,
  file: string,
  scan: ScanResult,
  modulePathOverride?: string,
): Promise<ImportEdge[]> {
  if (!file.endsWith('.go')) {
    return [];
  }

  const modulePath = modulePathOverride ?? (await readGoModulePath(rootPath));
  if (modulePath === undefined) {
    return [];
  }

  const content = await readTextFile(path.join(rootPath, file));
  if (content === undefined) {
    return [];
  }

  return extractGoImportEdges(content, file, modulePath, buildGoPackageRepresentatives(scan.files));
}

async function readGoModulePath(rootPath: string): Promise<string | undefined> {
  const resolvedRoot = path.resolve(rootPath);
  if (goModulePathCache.has(resolvedRoot)) {
    return goModulePathCache.get(resolvedRoot);
  }

  const content = await readTextFile(path.join(rootPath, 'go.mod'));
  if (content === undefined) {
    goModulePathCache.set(resolvedRoot, undefined);
    return undefined;
  }

  const modulePath = content.match(/^module\s+(\S+)/m)?.[1];
  goModulePathCache.set(resolvedRoot, modulePath);
  return modulePath;
}

function buildGoPackageRepresentatives(files: string[]): Map<string, string> {
  const representatives = new Map<string, string>();
  const filesByDir = new Map<string, string[]>();

  for (const file of files.filter((entry) => entry.endsWith('.go'))) {
    const dir = path.posix.dirname(file);
    const dirFiles = filesByDir.get(dir) ?? [];
    dirFiles.push(file);
    filesByDir.set(dir, dirFiles);
  }

  for (const [dir, dirFiles] of filesByDir.entries()) {
    representatives.set(dir, chooseGoPackageRepresentative(dir, dirFiles));
  }

  return representatives;
}

function chooseGoPackageRepresentative(dir: string, files: string[]): string {
  const sortedFiles = [...files].sort((left, right) => left.localeCompare(right));
  const dirName = path.posix.basename(dir);
  const sameNameFile = sortedFiles.find((file) => path.posix.basename(file) === `${dirName}.go`);

  if (sameNameFile !== undefined) {
    return sameNameFile;
  }

  return sortedFiles.find((file) => !file.endsWith('_test.go')) ?? sortedFiles[0]!;
}

function extractGoImportEdges(
  content: string,
  fromFile: string,
  modulePath: string,
  packageRepresentatives: Map<string, string>,
): ImportEdge[] {
  const imports = extractGoImportSpecifiers(content);
  const edges: ImportEdge[] = [];
  const seen = new Set<string>();

  for (const importPath of imports) {
    if (!importPath.startsWith(`${modulePath}/`)) {
      continue;
    }

    const packagePath = importPath.slice(modulePath.length + 1);
    const target = packageRepresentatives.get(packagePath);
    if (target === undefined || target === fromFile || seen.has(target)) {
      continue;
    }

    seen.add(target);
    edges.push({ from: fromFile, to: target, specifiers: [importPath] });
  }

  return edges;
}

function extractGoImportSpecifiers(content: string): string[] {
  const imports: string[] = [];

  for (const match of content.matchAll(/import\s+"([^"]+)"/g)) {
    imports.push(match[1]!);
  }

  for (const block of content.matchAll(/import\s*\(([\s\S]*?)\)/g)) {
    for (const match of block[1]!.matchAll(/"([^"]+)"/g)) {
      imports.push(match[1]!);
    }
  }

  return [...new Set(imports)];
}
