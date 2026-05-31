import path from 'node:path';

import type { ScanResult } from '../../types/index.js';
import { readTextFile } from '../../utils/fs.js';
import type { ImportEdge } from '../import-graph.js';

export async function parsePythonImports(
  rootPath: string,
  scan: ScanResult,
): Promise<ImportEdge[]> {
  const pyFiles = scan.files.filter((file) => file.endsWith('.py'));
  const fileEdges = await Promise.all(
    pyFiles.map((file) => extractPythonImportEdgesForFile(rootPath, file, scan)),
  );

  return fileEdges.flat();
}

export async function extractPythonImportEdgesForFile(
  rootPath: string,
  file: string,
  scan: ScanResult,
): Promise<ImportEdge[]> {
  if (!file.endsWith('.py')) {
    return [];
  }

  const content = await readTextFile(path.join(rootPath, file));
  if (content === undefined) {
    return [];
  }

  return extractPythonImportEdges(
    normalizePythonImportStatements(content),
    file,
    new Set(scan.files),
  );
}

function normalizePythonImportStatements(content: string): string {
  return content.replace(
    /^(from\s+[A-Za-z_.][\w.]*\s+import\s*)\(([\s\S]*?)\)/gm,
    (_match, prefix: string, imports: string) =>
      `${prefix}${imports
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')}`,
  );
}

function extractPythonImportEdges(
  content: string,
  fromFile: string,
  fileSet: Set<string>,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(/^import\s+(.+)$/gm)) {
    for (const moduleName of parseImportModules(match[1]!)) {
      addPythonEdge(edges, seen, fromFile, resolveAbsoluteModule(moduleName, fileSet), [
        moduleName,
      ]);
    }
  }

  for (const match of content.matchAll(/^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/gm)) {
    const moduleName = match[1]!;
    const importedNames = parseImportedNames(match[2]!);
    addPythonEdge(
      edges,
      seen,
      fromFile,
      resolveFromImport(moduleName, importedNames, fileSet),
      importedNames,
    );
  }

  for (const match of content.matchAll(/^from\s+(\.+[\w.]*)\s+import\s+(.+)$/gm)) {
    const moduleName = match[1]!;
    const importedNames = parseImportedNames(match[2]!);
    addPythonEdge(
      edges,
      seen,
      fromFile,
      resolveRelativeFromImport(fromFile, moduleName, importedNames, fileSet),
      importedNames,
    );
  }

  return edges;
}

function addPythonEdge(
  edges: ImportEdge[],
  seen: Set<string>,
  fromFile: string,
  to: string | undefined,
  specifiers: string[],
): void {
  if (to === undefined || to === fromFile || seen.has(to)) {
    return;
  }

  seen.add(to);
  edges.push({ from: fromFile, to, specifiers });
}

function resolveAbsoluteModule(moduleName: string, fileSet: Set<string>): string | undefined {
  return resolvePythonModule(moduleName.split('.'), fileSet);
}

function resolveFromImport(
  moduleName: string,
  importedNames: string[],
  fileSet: Set<string>,
): string | undefined {
  const moduleParts = moduleName.split('.');
  for (const name of importedNames) {
    const importedModule = resolvePythonModule([...moduleParts, name], fileSet);
    if (importedModule !== undefined) {
      return importedModule;
    }
  }

  const directModule = resolvePythonModule(moduleParts, fileSet);
  if (directModule !== undefined) {
    return directModule;
  }

  return undefined;
}

function resolveRelativeFromImport(
  fromFile: string,
  moduleName: string,
  importedNames: string[],
  fileSet: Set<string>,
): string | undefined {
  const dotCount = moduleName.match(/^\.+/)?.[0].length ?? 0;
  const suffix = moduleName.slice(dotCount);
  const fromDirParts = path.posix.dirname(fromFile).split('/').filter(Boolean);
  const packageParts = fromDirParts.slice(0, Math.max(0, fromDirParts.length - dotCount + 1));
  const suffixParts = suffix.length > 0 ? suffix.split('.') : [];
  const baseParts = [...packageParts, ...suffixParts];

  if (suffixParts.length > 0) {
    const directModule = resolvePythonModule(baseParts, fileSet);
    if (directModule !== undefined) {
      return directModule;
    }
  }

  for (const name of importedNames) {
    const importedModule = resolvePythonModule([...baseParts, name], fileSet);
    if (importedModule !== undefined) {
      return importedModule;
    }
  }

  return resolvePythonModule(baseParts, fileSet);
}

function resolvePythonModule(parts: string[], fileSet: Set<string>): string | undefined {
  if (parts.length === 0) {
    return undefined;
  }

  const modulePath = parts.join('/');
  const filePath = `${modulePath}.py`;
  if (fileSet.has(filePath)) {
    return filePath;
  }

  const packagePath = `${modulePath}/__init__.py`;
  if (fileSet.has(packagePath)) {
    return packagePath;
  }

  return undefined;
}

function parseImportedNames(raw: string): string[] {
  return raw
    .replace(/[()]/g, '')
    .split(',')
    .map((part) => part.trim().replace(/\s+as\s+\w+$/, ''))
    .filter((part) => /^[A-Za-z_]\w*$/.test(part));
}

function parseImportModules(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim().replace(/\s+as\s+\w+$/, ''))
    .filter((part) => /^[A-Za-z_][\w.]*$/.test(part));
}
