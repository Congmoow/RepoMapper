import type { ProjectCache } from '../cache.js';
import { symbolKey, type CallGraph } from '../../core/call-graph.js';
import type { ContentIndex } from '../../core/content-index.js';
import type { ImportGraph } from '../../core/import-graph.js';
import { resolveRepoPath } from '../../core/path-resolver.js';
import type { SymbolInfo } from '../../core/symbols.js';

const FILE_INFO_FIELDS = ['exports', 'symbols', 'imports', 'importedBy', 'callsByExport'] as const;

type FileInfoField = (typeof FILE_INFO_FIELDS)[number];

interface FileInfoArgs {
  path: string;
  fields?: FileInfoField[] | undefined;
}

interface CallSiteRef {
  file: string;
  symbol: string;
  /** 调用点在调用方文件中的 1-based 行号。 */
  line?: number;
  /** 调用点所在源码行。 */
  text?: string;
}

type FileInfoResult = {
  path: string;
  exists: boolean;
  exports?: Array<{ name: string; kind: string; isDefault: boolean }>;
  symbols?: Array<{
    name: string;
    kind: string;
    isDefault: boolean;
    line?: number;
    container?: string;
    exported?: boolean;
  }>;
  imports?: string[];
  importedBy?: string[];
  callsByExport?: Record<
    string,
    { calls: CallSiteRef[]; calledBy: CallSiteRef[]; importCallSites?: CallSiteRef[] }
  >;
  suggestions: string[];
  warnings: string[];
  limitation?: string;
};

export async function handleFileInfo(
  cache: ProjectCache,
  args: FileInfoArgs,
): Promise<FileInfoResult> {
  await cache.refresh();
  return buildFileInfo(cache, args.path, normalizeFields(args.fields));
}

export async function handleFileInfoBatch(
  cache: ProjectCache,
  args: { paths: string[]; fields?: FileInfoField[] | undefined },
): Promise<{ files: FileInfoResult[] }> {
  await cache.refresh();
  const fields = normalizeFields(args.fields);

  return {
    files: await Promise.all(args.paths.map((filePath) => buildFileInfo(cache, filePath, fields))),
  };
}

async function buildFileInfo(
  cache: ProjectCache,
  inputPath: string,
  fields: Set<FileInfoField>,
): Promise<FileInfoResult> {
  const scan = cache.getScan();
  const resolution = resolveRepoPath(scan, inputPath, 'file');
  const filePath = resolution.path;
  const graph = cache.getImportGraph();
  const callGraph = cache.getCallGraph();
  const symbols = cache.getSymbols().find((entry) => entry.file === filePath);

  return {
    path: filePath,
    exists: resolution.exists,
    ...(fields.has('exports') ? { exports: buildExports(symbols?.exports ?? []) } : {}),
    ...(fields.has('symbols')
      ? { symbols: buildSymbols(symbols?.symbols ?? symbols?.exports ?? []) }
      : {}),
    ...(fields.has('imports')
      ? { imports: resolution.exists ? (graph.dependsOn.get(filePath) ?? []) : [] }
      : {}),
    ...(fields.has('importedBy')
      ? { importedBy: resolution.exists ? (graph.importedBy.get(filePath) ?? []) : [] }
      : {}),
    ...(fields.has('callsByExport')
      ? {
          callsByExport: buildCallsByExport(
            filePath,
            resolution.exists ? (symbols?.exports ?? []) : [],
            callGraph,
            await buildImportCallSites(
              filePath,
              symbols?.exports ?? [],
              graph,
              cache.getContentIndex(),
            ),
          ),
        }
      : {}),
    suggestions: resolution.suggestions,
    warnings: resolution.warnings,
    ...(isTsJsFile(filePath)
      ? {}
      : {
          limitation:
            'imports/importedBy 支持 TS/JS、Python 和 Go；exports 与 callsByExport 目前仅支持 TS/JS。',
        }),
  };
}

function normalizeFields(fields: FileInfoField[] | undefined): Set<FileInfoField> {
  if (fields === undefined || fields.length === 0) {
    return new Set(FILE_INFO_FIELDS);
  }

  return new Set(
    fields.filter((field): field is FileInfoField => FILE_INFO_FIELDS.includes(field)),
  );
}

function buildExports(symbols: SymbolInfo[]): Array<{
  name: string;
  kind: string;
  isDefault: boolean;
}> {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    isDefault: symbol.isDefault,
  }));
}

function buildSymbols(symbols: SymbolInfo[]): Array<{
  name: string;
  kind: string;
  isDefault: boolean;
  line?: number;
  container?: string;
  exported?: boolean;
}> {
  return symbols.map((symbol) => ({
    name: symbol.name,
    kind: symbol.kind,
    isDefault: symbol.isDefault,
    ...(symbol.line === undefined ? {} : { line: symbol.line }),
    ...(symbol.container === undefined ? {} : { container: symbol.container }),
    ...(symbol.exported === undefined ? {} : { exported: symbol.exported }),
  }));
}

function buildCallsByExport(
  filePath: string,
  symbols: Array<{ name: string }>,
  callGraph: CallGraph,
  importCallSitesBySymbol: Map<string, CallSiteRef[]>,
): Record<string, { calls: CallSiteRef[]; calledBy: CallSiteRef[]; importCallSites?: CallSiteRef[] }> {
  return Object.fromEntries(
    symbols.map((symbol) => {
      const key = symbolKey({ file: filePath, symbol: symbol.name });
      const calledBy = sortCallSites(
        (callGraph.calledBy.get(key) ?? []).map((edge) => ({
          file: edge.from.file,
          symbol: edge.from.symbol,
          ...(edge.line === undefined ? {} : { line: edge.line }),
        })),
      );
      return [
        symbol.name,
        {
          // 当前导出函数调用了哪些外部符号；行号属于当前文件。
          calls: sortCallSites(
            (callGraph.calls.get(key) ?? []).map((edge) => ({
              file: edge.to.file,
              symbol: edge.to.symbol,
              ...(edge.line === undefined ? {} : { line: edge.line }),
            })),
          ),
          // 哪些外部函数调用了当前导出；行号属于调用方文件。
          calledBy,
          importCallSites: sortCallSites(importCallSitesBySymbol.get(symbol.name) ?? []),
        },
      ];
    }),
  );
}

async function buildImportCallSites(
  targetFile: string,
  symbols: Array<{ name: string }>,
  importGraph: ImportGraph,
  contentIndex: ContentIndex,
): Promise<Map<string, CallSiteRef[]>> {
  const exportNames = new Set(symbols.map((symbol) => symbol.name));
  const sitesBySymbol = new Map<string, CallSiteRef[]>();
  const incomingEdges = importGraph.edges.filter((edge) => edge.to === targetFile);

  for (const edge of incomingEdges) {
    const localNamesByExport = buildLocalNamesByExport(edge.specifiers, exportNames);
    if (localNamesByExport.size === 0) {
      continue;
    }

    const fileLines = await contentIndex.readLines(edge.from);
    if (!fileLines.readable) {
      continue;
    }

    for (const [exportName, localNames] of localNamesByExport.entries()) {
      const refs = sitesBySymbol.get(exportName) ?? [];
      refs.push(...findCallSites(edge.from, exportName, localNames, fileLines.lines));
      sitesBySymbol.set(exportName, refs);
    }
  }

  return sitesBySymbol;
}

function buildLocalNamesByExport(
  specifiers: string[],
  exportNames: Set<string>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const specifier of specifiers) {
    const exportedName = specifier.split(/\s+as\s+/)[0]?.trim() ?? specifier;
    const localName =
      specifier
        .split(/\s+as\s+/)
        .at(-1)
        ?.trim() ?? specifier;

    if (!exportNames.has(exportedName)) {
      continue;
    }

    const names = result.get(exportedName) ?? [];
    names.push(localName);
    result.set(exportedName, names);
  }

  return result;
}

function findCallSites(
  filePath: string,
  exportName: string,
  localNames: string[],
  lines: string[],
): CallSiteRef[] {
  const sites: CallSiteRef[] = [];

  for (const localName of localNames) {
    const pattern = new RegExp(`\\b${escapeRegex(localName)}(?:\\s*\\(|\\s*\\.\\s*\\w+\\s*\\()`);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!;
      if (!pattern.test(line) || isImportLine(line)) {
        continue;
      }

      sites.push({
        file: filePath,
        symbol: exportName,
        line: index + 1,
        text: trimLine(line),
      });
    }
  }

  return sites;
}

function isTsJsFile(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

function sortCallSites(refs: CallSiteRef[]): CallSiteRef[] {
  return [...refs]
    .map((ref) => ({
      file: ref.file,
      symbol: ref.symbol,
      ...(ref.line === undefined ? {} : { line: ref.line }),
      ...(ref.text === undefined ? {} : { text: ref.text }),
    }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.symbol.localeCompare(right.symbol) ||
        (left.line ?? 0) - (right.line ?? 0),
    );
}

function isImportLine(line: string): boolean {
  return /^\s*import\b/.test(line);
}

function trimLine(line: string): string {
  const trimmed = line.trimEnd();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
