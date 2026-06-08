import type { ProjectCache } from '../cache.js';
import { createPathMatcher } from '../../core/path-matcher.js';
import type { ContentLine } from '../../core/content-index.js';

type SearchKind = 'file' | 'dir' | 'symbol' | 'all';

interface SearchArgs {
  pattern: string;
  kind?: SearchKind | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  contextLines?: number | undefined;
}

interface SearchMatch {
  path: string;
  kind: Exclude<SearchKind, 'all'>;
  name?: string;
  symbolKind?: string;
  line?: number;
  container?: string;
  exported?: boolean;
  text?: string;
  before?: ContentLine[];
  after?: ContentLine[];
}

export async function handleSearch(
  cache: ProjectCache,
  args: SearchArgs,
): Promise<{
  pattern: string;
  kind: SearchKind;
  matches: SearchMatch[];
  count: number;
  total: number;
  offset: number;
  truncated: boolean;
  nextOffset: number | null;
  warnings: string[];
}> {
  await cache.refresh();
  const kind = args.kind ?? 'file';
  const pattern = args.pattern;
  const limit = normalizeLimit(args.limit);
  const offset = normalizeOffset(args.offset);
  const contextLines = normalizeContextLines(args.contextLines);
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

  const enrichedMatches = await enrichMatches(cache, matches, contextLines);
  const sortedMatches = enrichedMatches.sort((left, right) =>
    compareMatches(left, right, pattern, kind),
  );
  const pagedMatches = sortedMatches.slice(offset, offset + limit);
  const nextOffset = offset + pagedMatches.length;
  const truncated = nextOffset < sortedMatches.length;
  const warnings =
    sortedMatches.length === 0
      ? ['未找到结构命中；如果要搜索代码内容、工具名或任意字符串，请使用 repomapper_grep。']
      : [];

  return {
    pattern,
    kind,
    matches: pagedMatches,
    count: pagedMatches.length,
    total: sortedMatches.length,
    offset,
    truncated,
    nextOffset: truncated ? nextOffset : null,
    warnings,
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 100;
  }

  return Math.floor(value);
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}

function normalizeContextLines(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }

  return Math.min(Math.floor(value), 20);
}

async function enrichMatches(
  cache: ProjectCache,
  matches: SearchMatch[],
  contextLines: number | undefined,
): Promise<SearchMatch[]> {
  if (contextLines === undefined) {
    return matches;
  }

  const contentIndex = cache.getContentIndex();

  return Promise.all(
    matches.map(async (match) => {
      if (match.kind !== 'symbol' || match.line === undefined) {
        return match;
      }

      const fileLines = await contentIndex.readLines(match.path);
      if (!fileLines.readable) {
        return match;
      }

      const lineIndex = match.line - 1;
      const line = fileLines.lines[lineIndex];
      if (line === undefined) {
        return match;
      }

      return {
        ...match,
        text: trimLine(line),
        before: toContentLines(
          fileLines.lines,
          Math.max(0, lineIndex - contextLines),
          lineIndex - 1,
        ),
        after: toContentLines(
          fileLines.lines,
          lineIndex + 1,
          Math.min(fileLines.lines.length - 1, lineIndex + contextLines),
        ),
      };
    }),
  );
}

function compareMatches(
  left: SearchMatch,
  right: SearchMatch,
  pattern: string,
  requestedKind: SearchKind,
): number {
  return (
    scoreMatch(right, pattern, requestedKind) - scoreMatch(left, pattern, requestedKind) ||
    left.path.localeCompare(right.path) ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    (left.line ?? 0) - (right.line ?? 0)
  );
}

function scoreMatch(match: SearchMatch, pattern: string, requestedKind: SearchKind): number {
  const normalizedPattern = pattern.toLowerCase();
  const subject = (match.name ?? basename(match.path)).toLowerCase();
  const pathValue = match.path.toLowerCase();
  let score = 0;

  if (match.kind === requestedKind) score += 8;
  if (match.kind === 'symbol') score += 4;
  if (match.symbolKind === 'function' || match.symbolKind === 'method') score += 10;
  if ((match.symbolKind === 'function' || match.symbolKind === 'method') && match.exported) {
    score += 4;
  }
  if (subject === normalizedPattern) score += 24;
  else if (subject.startsWith(normalizedPattern)) score += 16;
  else if (subject.includes(normalizedPattern)) score += 8;
  if (pathValue.includes(`/src/`) || pathValue.startsWith('src/')) score += 3;
  score -= Math.min(match.path.split('/').length, 8);

  return score;
}

function basename(filePath: string): string {
  return filePath.split('/').at(-1) ?? filePath;
}

function toContentLines(lines: string[], startIndex: number, endIndex: number): ContentLine[] {
  if (endIndex < startIndex) {
    return [];
  }

  return lines.slice(startIndex, endIndex + 1).map((line, index) => ({
    line: startIndex + index + 1,
    text: trimLine(line),
  }));
}

function trimLine(line: string): string {
  const trimmed = line.trimEnd();
  return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}
