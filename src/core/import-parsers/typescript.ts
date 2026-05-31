import path from 'node:path';

import type { ScanResult } from '../../types/index.js';
import { readTextFile } from '../../utils/fs.js';
import type { ImportEdge, ParsedImport } from '../import-graph.js';

const RESOLVABLE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', '.cts', '.cjs'];
const SOURCE_EXTENSION_FALLBACKS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx', '.ts'],
  '.mjs': ['.mts', '.ts', '.tsx'],
  '.cjs': ['.cts', '.ts', '.tsx'],
};

export async function parseTypeScriptImports(
  rootPath: string,
  scan: ScanResult,
): Promise<ImportEdge[]> {
  const tsJsFiles = scan.files.filter(isTypeScriptImportFile);
  const fileEdges = await Promise.all(
    tsJsFiles.map((file) => extractTypeScriptImportEdgesForFile(rootPath, file, scan)),
  );

  return fileEdges.flat();
}

export async function extractTypeScriptImportEdgesForFile(
  rootPath: string,
  file: string,
  scan: ScanResult,
): Promise<ImportEdge[]> {
  if (!isTypeScriptImportFile(file)) {
    return [];
  }

  const content = await readTextFile(path.join(rootPath, file));
  if (content === undefined) {
    return [];
  }

  const fileSet = new Set(scan.files);
  return extractTypeScriptImportsFromContent(content, file, fileSet).map((imp) => ({
    from: file,
    to: imp.resolved,
    specifiers: imp.specifiers,
  }));
}

export function isTypeScriptImportFile(file: string): boolean {
  return RESOLVABLE_EXTENSIONS.some((ext) => file.endsWith(ext));
}

export function extractTypeScriptImportsFromContent(
  content: string,
  fromFile: string,
  fileSet: Set<string>,
): ParsedImport[] {
  const results: ParsedImport[] = [];
  const dir = path.dirname(fromFile);

  const importPatterns = [
    /import\s+(?:type\s+)?(\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+([\w]+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+\*\s+as\s+([\w]+)\s+from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?(\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,
  ];

  const seen = new Set<string>();

  for (const pattern of importPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const groups = match.slice(1).filter(Boolean);
      const specifier = groups[groups.length - 1]!;

      if (!specifier.startsWith('.')) continue;

      const resolved = resolveRelativeTypeScriptImport(dir, specifier, fileSet);
      if (resolved === undefined || seen.has(resolved)) continue;
      seen.add(resolved);

      const specifierGroup = groups.length > 1 ? groups[0]! : '';
      const specifiers = parseSpecifiers(specifierGroup);

      results.push({ resolved, specifiers });
    }
  }

  return results;
}

function resolveRelativeTypeScriptImport(
  dir: string,
  specifier: string,
  fileSet: Set<string>,
): string | undefined {
  const joined = path.posix.join(dir, specifier);

  if (fileSet.has(joined)) return joined;

  const parsed = path.posix.parse(joined);
  const sourceFallbacks = SOURCE_EXTENSION_FALLBACKS[parsed.ext] ?? [];
  for (const ext of sourceFallbacks) {
    const candidate = path.posix.join(parsed.dir, `${parsed.name}${ext}`);
    if (fileSet.has(candidate)) return candidate;
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    if (fileSet.has(joined + ext)) return joined + ext;
  }

  for (const ext of RESOLVABLE_EXTENSIONS) {
    const indexPath = `${joined}/index${ext}`;
    if (fileSet.has(indexPath)) return indexPath;
  }

  return undefined;
}

function parseSpecifiers(raw: string): string[] {
  if (!raw.startsWith('{')) return raw ? [raw] : [];

  return raw
    .replace(/[{}]/g, '')
    .split(',')
    .map((s) => s.trim().replace(/^type\s+/, ''))
    .filter((s) => s.length > 0);
}
