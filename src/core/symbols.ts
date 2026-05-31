import path from 'node:path';

import type { ScanResult } from '../types/index.js';
import { readTextFile } from '../utils/fs.js';

export interface FileSymbols {
  file: string;
  exports: SymbolInfo[];
  symbols: SymbolInfo[];
}

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'variable' | 'method';
  isDefault: boolean;
  line?: number | undefined;
  container?: string | undefined;
  exported?: boolean | undefined;
}

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

export async function extractSymbols(rootPath: string, scan: ScanResult): Promise<FileSymbols[]> {
  const tsJsFiles = scan.files.filter(isSymbolFile);

  const results = await Promise.all(tsJsFiles.map((file) => extractSymbolsForFile(rootPath, file)));

  return results.filter((r): r is FileSymbols => r !== undefined);
}

export async function extractSymbolsForFile(
  rootPath: string,
  file: string,
): Promise<FileSymbols | undefined> {
  if (!isSymbolFile(file)) {
    return undefined;
  }

  const content = await readTextFile(path.join(rootPath, file));
  if (content === undefined) return undefined;

  const parsed = extractSymbolsFromContent(content);
  if (parsed.symbols.length === 0) return undefined;

  return { file, exports: parsed.exports, symbols: parsed.symbols };
}

export function extractExportsFromContent(content: string): SymbolInfo[] {
  return extractSymbolsFromContent(content).exports;
}

export function extractSymbolsFromContent(
  content: string,
): Pick<FileSymbols, 'exports' | 'symbols'> {
  const symbols: SymbolInfo[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'function', false, true);
  }

  for (const match of content.matchAll(/export\s+default\s+(?:async\s+)?function\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'function', true, true);
  }

  for (const match of content.matchAll(/export\s+class\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'class', false, true);
  }

  for (const match of content.matchAll(/export\s+default\s+class\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'class', true, true);
  }

  for (const match of content.matchAll(/export\s+(?:declare\s+)?interface\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'interface', false, true);
  }

  for (const match of content.matchAll(/export\s+(?:declare\s+)?type\s+(\w+)\s*[=<{]/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'type', false, true);
  }

  for (const match of content.matchAll(/export\s+(?:declare\s+)?(?:const|let|var)\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'const', false, true);
  }

  for (const match of content.matchAll(/export\s+(?:declare\s+)?enum\s+(\w+)/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'enum', false, true);
  }

  for (const match of content.matchAll(/export\s+\{([^}]+)\}(?!\s*from)/g)) {
    const names = match[1]!.split(',').map((s) => s.trim().replace(/\s+as\s+\w+$/, ''));
    for (const name of names) {
      if (name.length > 0 && /^\w+$/.test(name)) {
        addMatchedSymbol(symbols, seen, content, match, name, 'variable', false, true);
      }
    }
  }

  for (const match of content.matchAll(/(?<![\w.])(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'function', false, false);
  }

  for (const match of content.matchAll(
    /(?<![\w.])(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/g,
  )) {
    addMatchedSymbol(symbols, seen, content, match, match[1]!, 'const', false, false);
  }

  for (const classMatch of content.matchAll(/(?:export\s+(?:default\s+)?)?class\s+(\w+)[^{]*\{/g)) {
    const className = classMatch[1]!;
    const openBraceIndex = classMatch.index + classMatch[0].length - 1;
    const body = readBalancedBlock(content, openBraceIndex);

    if (body === undefined) {
      continue;
    }

    for (const method of extractClassMethods(content, body.body, openBraceIndex + 1, className)) {
      addSymbolAtLine(symbols, seen, method.name, 'method', false, false, method.line, className);
    }
  }

  const sortedSymbols = symbols.sort(
    (left, right) => (left.line ?? 0) - (right.line ?? 0) || left.name.localeCompare(right.name),
  );

  return {
    exports: sortedSymbols.filter((symbol) => symbol.exported === true),
    symbols: sortedSymbols,
  };
}

export function isSymbolFile(file: string): boolean {
  return RESOLVABLE_EXTENSIONS.some((ext) => file.endsWith(ext));
}

function addMatchedSymbol(
  symbols: SymbolInfo[],
  seen: Set<string>,
  content: string,
  match: RegExpMatchArray,
  name: string,
  kind: SymbolInfo['kind'],
  isDefault: boolean,
  exported: boolean,
): void {
  addSymbolAtLine(
    symbols,
    seen,
    name,
    kind,
    isDefault,
    exported,
    lineNumberAt(content, match.index ?? 0),
  );
}

function addSymbolAtLine(
  symbols: SymbolInfo[],
  seen: Set<string>,
  name: string,
  kind: SymbolInfo['kind'],
  isDefault: boolean,
  exported: boolean,
  line: number,
  container?: string,
): void {
  const key = `${container ?? ''}#${name}#${kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  symbols.push({
    name,
    kind,
    isDefault,
    line,
    exported,
    ...(container === undefined ? {} : { container }),
  });
}

function extractClassMethods(
  fullContent: string,
  classBody: string,
  bodyOffset: number,
  className: string,
): Array<{ name: string; line: number }> {
  const methods: Array<{ name: string; line: number }> = [];
  const methodPattern =
    /^[ \t]*(?:(?:public|private|protected|static|readonly|override|async)\s+)*(#?\w+)\s*(?:<[^>{}]+>)?\s*\([^;{}]*\)\s*(?::\s*[^{}]+)?\{/gm;

  for (const match of classBody.matchAll(methodPattern)) {
    const rawName = match[1];
    if (rawName === undefined || rawName === 'constructor' || rawName === className) {
      continue;
    }

    methods.push({
      name: rawName.replace(/^#/, ''),
      line: lineNumberAt(fullContent, bodyOffset + (match.index ?? 0)),
    });
  }

  return methods;
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

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

export function summarizeSymbols(allSymbols: FileSymbols[], limit = 20): FileSymbols[] {
  return [...allSymbols].sort((a, b) => b.exports.length - a.exports.length).slice(0, limit);
}
