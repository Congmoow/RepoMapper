import type { ProjectCache } from '../cache.js';
import { createPathMatcher } from '../../core/path-matcher.js';

type SearchKind = 'file' | 'dir' | 'symbol' | 'all';

interface SearchArgs {
  pattern: string;
  kind?: SearchKind | undefined;
  limit?: number | undefined;
}

interface SearchMatch {
  path: string;
  kind: Exclude<SearchKind, 'all'>;
  name?: string;
  symbolKind?: string;
  line?: number;
  container?: string;
  exported?: boolean;
}

export async function handleSearch(
  cache: ProjectCache,
  args: SearchArgs,
): Promise<{ pattern: string; kind: SearchKind; matches: SearchMatch[] }> {
  await cache.refresh();
  const kind = args.kind ?? 'file';
  const pattern = args.pattern;
  const limit = normalizeLimit(args.limit);
  const matcher = createPathMatcher(pattern);
  const scan = cache.getScan();
  const matches: SearchMatch[] = [];

  if (kind === 'file' || kind === 'all') {
    matches.push(
      ...scan.files.filter(matcher).map((file) => ({ path: file, kind: 'file' as const })),
    );
  }

  if (kind === 'dir' || kind === 'all') {
    matches.push(
      ...scan.directories
        .filter(matcher)
        .map((directory) => ({ path: directory, kind: 'dir' as const })),
    );
  }

  if (kind === 'symbol' || kind === 'all') {
    for (const file of cache.getSymbols()) {
      for (const symbol of file.symbols ?? file.exports) {
        if (matcher(symbol.name) || matcher(file.file) || matcher(symbol.container ?? '')) {
          matches.push({
            path: file.file,
            kind: 'symbol',
            name: symbol.name,
            symbolKind: symbol.kind,
            ...(symbol.line === undefined ? {} : { line: symbol.line }),
            ...(symbol.container === undefined ? {} : { container: symbol.container }),
            ...(symbol.exported === undefined ? {} : { exported: symbol.exported }),
          });
        }
      }
    }
  }

  return {
    pattern,
    kind,
    matches: matches.slice(0, limit),
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 100;
  }

  return Math.floor(value);
}
