import path from 'node:path';

import type { ScanResult } from '../types/index.js';
import { readTextFile } from '../utils/fs.js';
import type { ImportGraph } from './import-graph.js';
import { isSymbolFile, type FileSymbols } from './symbols.js';

export interface SymbolRef {
  file: string;
  symbol: string;
}

export interface CallEdge {
  from: SymbolRef;
  to: SymbolRef;
  /** 1-based line of the call site inside the `from` function body, if known. */
  line?: number | undefined;
}

export interface CallGraph {
  edges: CallEdge[];
  calls: Map<string, CallEdge[]>;
  calledBy: Map<string, CallEdge[]>;
}

export async function buildCallGraph(
  rootPath: string,
  scan: ScanResult,
  importGraph: ImportGraph,
  symbols: FileSymbols[],
): Promise<CallGraph> {
  const symbolByFile = new Map(
    symbols.map((fileSymbols) => [fileSymbols.file, fileSymbols.exports]),
  );
  const edges = (
    await Promise.all(
      scan.files
        .filter(isSymbolFile)
        .map((file) => extractCallEdgesForFile(rootPath, file, importGraph, symbolByFile)),
    )
  ).flat();

  return buildCallGraphFromEdges(edges);
}

export async function extractCallEdgesForFile(
  rootPath: string,
  file: string,
  importGraph: ImportGraph,
  symbolByFile: Map<string, FileSymbols['exports']>,
): Promise<CallEdge[]> {
  if (!isSymbolFile(file)) {
    return [];
  }

  const content = await readTextFile(path.join(rootPath, file));
  if (content === undefined) {
    return [];
  }

  return extractCallEdgesFromContent(content, file, importGraph, symbolByFile);
}

export function extractCallEdgesFromContent(
  content: string,
  file: string,
  importGraph: ImportGraph,
  symbolByFile: Map<string, FileSymbols['exports']>,
): CallEdge[] {
  const exportedFunctions = extractExportedFunctionBodies(content);
  const importedSymbols = buildImportedSymbolMap(file, importGraph, symbolByFile);
  const edges: CallEdge[] = [];
  const seen = new Set<string>();

  for (const exportedFunction of exportedFunctions) {
    for (const [localName, target] of importedSymbols.entries()) {
      const pattern = new RegExp(`\\b${escapeRegex(localName)}(?:\\s*\\(|\\s*\\.\\s*\\w+\\s*\\()`);
      const matchInBody = pattern.exec(exportedFunction.body);

      if (matchInBody === null) {
        continue;
      }

      const line = lineNumberAt(content, exportedFunction.start + matchInBody.index);
      const edge: CallEdge = {
        from: { file, symbol: exportedFunction.name },
        to: target,
        line,
      };
      const key = `${symbolKey(edge.from)}->${symbolKey(edge.to)}`;

      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }

  return edges;
}

export function buildCallGraphFromEdges(edges: CallEdge[]): CallGraph {
  const calls = new Map<string, CallEdge[]>();
  const calledBy = new Map<string, CallEdge[]>();

  for (const edge of edges) {
    pushEdge(calls, symbolKey(edge.from), edge);
    pushEdge(calledBy, symbolKey(edge.to), edge);
  }

  for (const value of calls.values()) {
    sortEdges(value);
  }

  for (const value of calledBy.values()) {
    sortEdges(value);
  }

  return { edges, calls, calledBy };
}

export function symbolKey(ref: SymbolRef): string {
  return `${ref.file}#${ref.symbol}`;
}

interface ExportedFunctionBody {
  name: string;
  body: string;
  /** Absolute offset in the file where `body` begins. */
  start: number;
}

function extractExportedFunctionBodies(content: string): ExportedFunctionBody[] {
  return [...extractExportedDeclarations(content), ...extractExportedConstFunctions(content)];
}

function extractExportedDeclarations(content: string): ExportedFunctionBody[] {
  const results: ExportedFunctionBody[] = [];
  const declarationPattern = /export\s+(?:async\s+)?function\s+(\w+)[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = declarationPattern.exec(content)) !== null) {
    const openBraceIndex = declarationPattern.lastIndex - 1;
    const body = readBalancedBlock(content, openBraceIndex);

    if (body !== undefined) {
      results.push({
        name: match[1]!,
        body: content.slice(match.index, openBraceIndex) + body.body,
        start: match.index,
      });
      declarationPattern.lastIndex = body.endIndex;
    }
  }

  return results;
}

function extractExportedConstFunctions(content: string): ExportedFunctionBody[] {
  const results: ExportedFunctionBody[] = [];
  const constPattern =
    /export\s+(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\{|export\s+(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\b[^{]*\{/g;
  let match: RegExpExecArray | null;

  while ((match = constPattern.exec(content)) !== null) {
    const openBraceIndex = constPattern.lastIndex - 1;
    const body = readBalancedBlock(content, openBraceIndex);

    if (body !== undefined) {
      results.push({
        name: (match[1] ?? match[2])!,
        body: content.slice(match.index, openBraceIndex) + body.body,
        start: match.index,
      });
      constPattern.lastIndex = body.endIndex;
    }
  }

  return results;
}

function buildImportedSymbolMap(
  file: string,
  importGraph: ImportGraph,
  symbolByFile: Map<string, FileSymbols['exports']>,
): Map<string, SymbolRef> {
  const importedSymbols = new Map<string, SymbolRef>();
  const edges = importGraph.edges.filter((edge) => edge.from === file);

  for (const edge of edges) {
    const targetExports = symbolByFile.get(edge.to) ?? [];
    const exportedNames = new Set(targetExports.map((symbol) => symbol.name));

    for (const specifier of edge.specifiers) {
      const localName =
        specifier
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim() ?? specifier;
      const exportedName = specifier.split(/\s+as\s+/)[0]?.trim() ?? specifier;

      if (exportedNames.has(exportedName)) {
        importedSymbols.set(localName, { file: edge.to, symbol: exportedName });
      }
    }
  }

  return importedSymbols;
}

function readBalancedBlock(
  content: string,
  openBraceIndex: number,
): { body: string; endIndex: number } | undefined {
  let depth = 0;

  for (let index = openBraceIndex; index < content.length; index += 1) {
    const char = content[index];

    if (char === '{') {
      depth += 1;
    }

    if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return {
          body: content.slice(openBraceIndex + 1, index),
          endIndex: index + 1,
        };
      }
    }
  }

  return undefined;
}

function pushEdge(map: Map<string, CallEdge[]>, key: string, edge: CallEdge): void {
  const edges = map.get(key) ?? [];
  edges.push(edge);
  map.set(key, edges);
}

function sortEdges(edges: CallEdge[]): void {
  edges.sort(
    (left, right) =>
      symbolKey(left.from).localeCompare(symbolKey(right.from)) ||
      symbolKey(left.to).localeCompare(symbolKey(right.to)),
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}
