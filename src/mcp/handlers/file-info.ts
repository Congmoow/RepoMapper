import type { ProjectCache } from '../cache.js';
import { symbolKey, type SymbolRef } from '../../core/call-graph.js';
import { resolveRepoPath } from '../../core/path-resolver.js';

interface FileInfoArgs {
  path: string;
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
  callsByExport: Record<string, { calls: SymbolRef[]; calledBy: SymbolRef[] }>;
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
            calls: sortSymbolRefs((callGraph.calls.get(key) ?? []).map((edge) => edge.to)),
            calledBy: sortSymbolRefs((callGraph.calledBy.get(key) ?? []).map((edge) => edge.from)),
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

function sortSymbolRefs(refs: SymbolRef[]): SymbolRef[] {
  return [...refs].sort(
    (left, right) => left.file.localeCompare(right.file) || left.symbol.localeCompare(right.symbol),
  );
}
