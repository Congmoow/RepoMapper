import path from 'node:path';

import { readTextFile } from '../utils/fs.js';

export interface ContentMatch {
  path: string;
  line: number;
  /** The matching line, trimmed to a reasonable length. */
  text: string;
}

export interface ContentSearchOptions {
  /** Treat `pattern` as a regular expression instead of a literal substring. */
  regex?: boolean;
  /** Case-insensitive matching. Default true for literal, honored for regex. */
  ignoreCase?: boolean;
  /** Max matches to return. */
  limit?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LINE_LENGTH = 240;
/** Skip files larger than this (bytes) to avoid pathological memory/time. */
const MAX_FILE_BYTES = 2_000_000;

/** Extensions we never treat as searchable text. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac', '.ogg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class',
  '.lock', // lockfiles: huge and rarely useful to grep
]);

export function isProbablyTextFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}

/** Contains a NUL byte in the first chunk → almost certainly binary. */
function looksBinary(content: string): boolean {
  const sampleLength = Math.min(content.length, 8000);
  for (let i = 0; i < sampleLength; i += 1) {
    if (content.charCodeAt(i) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * In-memory line index for repository files, built lazily and invalidated per
 * file. Holds file contents split into lines so repeated greps are cheap.
 */
export class ContentIndex {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly rootPath: string) {}

  /** Drop a single file's cached lines (e.g. on 'change'). */
  invalidate(file: string): void {
    this.cache.delete(file);
  }

  /** Drop everything (e.g. on full rescan). */
  clear(): void {
    this.cache.clear();
  }

  private async linesFor(file: string): Promise<string[] | null> {
    if (this.cache.has(file)) {
      return this.cache.get(file) ?? null;
    }

    if (!isProbablyTextFile(file)) {
      this.cache.set(file, null);
      return null;
    }

    const content = await readTextFile(path.join(this.rootPath, file));
    if (content === undefined || content.length > MAX_FILE_BYTES || looksBinary(content)) {
      this.cache.set(file, null);
      return null;
    }

    const lines = content.split(/\r?\n/);
    this.cache.set(file, lines);
    return lines;
  }

  async search(
    files: string[],
    pattern: string,
    options: ContentSearchOptions = {},
  ): Promise<{ matches: ContentMatch[]; truncated: boolean; scannedFiles: number }> {
    const limit = normalizeLimit(options.limit);
    const matcher = buildMatcher(pattern, options);
    const matches: ContentMatch[] = [];
    let scannedFiles = 0;
    let truncated = false;

    for (const file of files) {
      const lines = await this.linesFor(file);
      if (lines === null) {
        continue;
      }
      scannedFiles += 1;

      for (let i = 0; i < lines.length; i += 1) {
        if (matcher(lines[i]!)) {
          matches.push({ path: file, line: i + 1, text: trimLine(lines[i]!) });
          if (matches.length >= limit) {
            truncated = true;
            return { matches, truncated, scannedFiles };
          }
        }
      }
    }

    return { matches, truncated, scannedFiles };
  }
}

export function buildMatcher(
  pattern: string,
  options: ContentSearchOptions,
): (line: string) => boolean {
  const ignoreCase = options.ignoreCase ?? !options.regex;

  if (options.regex) {
    const flags = ignoreCase ? 'i' : '';
    const re = new RegExp(pattern, flags);
    return (line) => re.test(line);
  }

  const needle = ignoreCase ? pattern.toLowerCase() : pattern;
  return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
}

function trimLine(line: string): string {
  const trimmed = line.trimEnd();
  return trimmed.length > MAX_LINE_LENGTH ? `${trimmed.slice(0, MAX_LINE_LENGTH)}…` : trimmed;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.floor(value);
}
