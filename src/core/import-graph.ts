import type { ScanResult } from '../types/index.js';
import {
  extractTypeScriptImportEdgesForFile,
  extractTypeScriptImportsFromContent,
  isTypeScriptImportFile,
  parseTypeScriptImports,
} from './import-parsers/typescript.js';
import { extractGoImportEdgesForFile, parseGoImports } from './import-parsers/go.js';
import { extractPythonImportEdgesForFile, parsePythonImports } from './import-parsers/python.js';

export interface ImportEdge {
  from: string;
  to: string;
  specifiers: string[];
}

export interface ImportGraph {
  edges: ImportEdge[];
  /** Files sorted by how many other files import them (most depended-on first) */
  hubs: string[];
  /** Files that import many others (high fan-out) */
  entryLike: string[];
  /** Adjacency: file → files it imports */
  dependsOn: Map<string, string[]>;
  /** Reverse adjacency: file → files that import it */
  importedBy: Map<string, string[]>;
}

export interface ParsedImport {
  resolved: string;
  specifiers: string[];
}

/**
 * Build a file-level import graph for supported languages in the scan.
 */
export async function buildImportGraph(rootPath: string, scan: ScanResult): Promise<ImportGraph> {
  const [tsEdges, pythonEdges, goEdges] = await Promise.all([
    parseTypeScriptImports(rootPath, scan),
    parsePythonImports(rootPath, scan),
    parseGoImports(rootPath, scan),
  ]);

  return buildImportGraphFromEdges([...tsEdges, ...pythonEdges, ...goEdges]);
}

export async function extractImportEdgesForFile(
  rootPath: string,
  file: string,
  scan: ScanResult,
): Promise<ImportEdge[]> {
  if (isTypeScriptImportFile(file)) {
    return extractTypeScriptImportEdgesForFile(rootPath, file, scan);
  }

  if (file.endsWith('.py')) {
    return extractPythonImportEdgesForFile(rootPath, file, scan);
  }

  if (file.endsWith('.go')) {
    return extractGoImportEdgesForFile(rootPath, file, scan);
  }

  return [];
}

export function buildImportGraphFromEdges(edges: ImportEdge[]): ImportGraph {
  const dependsOn = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();

  for (const edge of edges) {
    const deps = dependsOn.get(edge.from) ?? [];
    if (!deps.includes(edge.to)) {
      deps.push(edge.to);
      dependsOn.set(edge.from, deps);
    }

    const dependents = importedBy.get(edge.to) ?? [];
    if (!dependents.includes(edge.from)) {
      dependents.push(edge.from);
      importedBy.set(edge.to, dependents);
    }
  }

  for (const deps of dependsOn.values()) {
    deps.sort((left, right) => left.localeCompare(right));
  }

  for (const dependents of importedBy.values()) {
    dependents.sort((left, right) => left.localeCompare(right));
  }

  // Hubs: files imported by the most other files
  const hubs = [...importedBy.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)
    .map(([file]) => file);

  // Entry-like: files that import many others but are imported by few
  const entryLike = [...dependsOn.entries()]
    .filter(([file]) => (importedBy.get(file)?.length ?? 0) <= 1)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([file]) => file);

  return { edges, hubs, entryLike, dependsOn, importedBy };
}

export function isImportGraphFile(file: string): boolean {
  return isTypeScriptImportFile(file) || file.endsWith('.py') || file.endsWith('.go');
}

export function extractImportsFromContent(
  content: string,
  fromFile: string,
  fileSet: Set<string>,
): ParsedImport[] {
  return extractTypeScriptImportsFromContent(content, fromFile, fileSet);
}
