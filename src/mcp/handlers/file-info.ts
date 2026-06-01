import type { ProjectCache } from '../cache.js';
import { symbolKey } from '../../core/call-graph.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface FileInfoArgs {
  path: string;
}

interface CallSiteRef {
  file: string;
  symbol: string;
  /** 1-based line of the call site in the calling function's file, if known. */
  line?: number;
}

export async function handleFileInfo(
  cache: ProjectCache,
  args: FileInfoArgs,
): Promise<{
  path: string;
  exists: boolean;
  exports: Array<{ name: string; kind: string; isDefault: boolean }>;
  symbols: Array<{
    name: string;
    kind: string;
    isDefault: boolean;
    line?: number;
    container?: string;
    exported?: boolean;
  }>;
  imports: string[];
  importedBy: string[];
  callsByExport: Record<string, { calls: CallSiteRef[]; calledBy: CallSiteRef[] }>;
  suggestions: string[];
  warnings: string[];
  limitation?: string;
}> {
  await cache.refresh();
  const scan = cache.getScan();
  const resolution = resolveRepoPath(scan, args.path, 'file');
  const filePath = resolution.path;
  const graph = cache.getImportGraph();
  const callGraph = cache.getCallGraph();
  const symbols = cache.getSymbols().find((entry) => entry.file === filePath);

  return {
    path: filePath,
    exists: resolution.exists,
    exports: (symbols?.exports ?? []).map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      isDefault: symbol.isDefault,
    })),
    symbols: (symbols?.symbols ?? symbols?.exports ?? []).map((symbol) => ({
      name: symbol.name,
      kind: symbol.kind,
      isDefault: symbol.isDefault,
      ...(symbol.line === undefined ? {} : { line: symbol.line }),
      ...(symbol.container === undefined ? {} : { container: symbol.container }),
      ...(symbol.exported === undefined ? {} : { exported: symbol.exported }),
    })),
    imports: resolution.exists ? (graph.dependsOn.get(filePath) ?? []) : [],
    importedBy: resolution.exists ? (graph.importedBy.get(filePath) ?? []) : [],
    callsByExport: Object.fromEntries(
      (resolution.exists ? (symbols?.exports ?? []) : []).map((symbol) => {
        const key = symbolKey({ file: filePath, symbol: symbol.name });
        return [
          symbol.name,
          {
            // Where this export calls into other files (line is in THIS file).
            calls: sortCallSites(
              (callGraph.calls.get(key) ?? []).map((edge) => ({
                file: edge.to.file,
                symbol: edge.to.symbol,
                ...(edge.line === undefined ? {} : { line: edge.line }),
              })),
            ),
            // Where other functions call this export (line is in the CALLER's file).
            calledBy: sortCallSites(
              (callGraph.calledBy.get(key) ?? []).map((edge) => ({
                file: edge.from.file,
                symbol: edge.from.symbol,
                ...(edge.line === undefined ? {} : { line: edge.line }),
              })),
            ),
          },
        ];
      }),
    ),
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

function isTsJsFile(filePath: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(filePath);
}

function sortCallSites(refs: CallSiteRef[]): CallSiteRef[] {
  return [...refs]
    .map((ref) => ({
      file: ref.file,
      symbol: ref.symbol,
      ...(ref.line === undefined ? {} : { line: ref.line }),
    }))
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.symbol.localeCompare(right.symbol) ||
        (left.line ?? 0) - (right.line ?? 0),
    );
}
