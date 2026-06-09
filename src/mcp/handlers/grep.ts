import type { ContentMatch } from '../../core/content-index.js';
import type { ProjectCache } from '../cache.js';
import { createPathMatcher } from '../../core/path-matcher.js';

interface GrepArgs {
  pattern: string;
  regex?: boolean | undefined;
  ignoreCase?: boolean | undefined;
  glob?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  contextLines?: number | undefined;
}

export async function handleGrep(
  cache: ProjectCache,
  args: GrepArgs,
): Promise<{
  pattern: string;
  regex: boolean;
  matches: ContentMatch[];
  count: number;
  total: number;
  offset: number;
  truncated: boolean;
  scannedFiles: number;
  nextOffset: number | null;
  warnings: string[];
}> {
  await cache.refresh();
  const scan = cache.getScan();
  const warnings: string[] = [];

  let files = scan.files;
  if (args.glob !== undefined && args.glob.length > 0) {
    const matchesGlob = createPathMatcher(args.glob);
    files = files.filter(matchesGlob);
    if (files.length === 0) {
      warnings.push(`No files matched glob: ${args.glob}`);
    }
  }

  const regex = args.regex ?? false;
  let invalidRegex = false;
  if (regex) {
    try {
      // Validate before scanning so we can return a clean warning.
      new RegExp(args.pattern);
    } catch (error) {
      invalidRegex = true;
      warnings.push(
        `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (invalidRegex) {
    return {
      pattern: args.pattern,
      regex,
      matches: [],
      count: 0,
      total: 0,
      offset: normalizeOffset(args.offset),
      truncated: false,
      scannedFiles: 0,
      nextOffset: null,
      warnings,
    };
  }

  const result = await cache.getContentIndex().search(files, args.pattern, {
    regex,
    ...(args.ignoreCase === undefined ? {} : { ignoreCase: args.ignoreCase }),
    ...(args.limit === undefined ? {} : { limit: args.limit }),
    ...(args.offset === undefined ? {} : { offset: args.offset }),
    ...(args.contextLines === undefined ? {} : { contextLines: args.contextLines }),
  });

  return {
    pattern: args.pattern,
    regex,
    matches: result.matches,
    count: result.matches.length,
    total: result.total,
    offset: result.offset,
    truncated: result.truncated,
    scannedFiles: result.scannedFiles,
    nextOffset: result.nextOffset,
    warnings,
  };
}

function normalizeOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
}
