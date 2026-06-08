import path from 'node:path';

import { readTextFile } from '../utils/fs.js';

export interface ContentMatch {
  path: string;
  line: number;
  /** 匹配行，裁剪到适合 MCP 返回的长度。 */
  text: string;
  before?: ContentLine[];
  after?: ContentLine[];
}

export interface ContentLine {
  line: number;
  text: string;
}

export interface ContentSearchOptions {
  /** 将 `pattern` 当作正则，而不是字面量子串。 */
  regex?: boolean;
  /** 大小写不敏感；字面量默认 true，正则按传入值处理。 */
  ignoreCase?: boolean;
  /** 最多返回的匹配数。 */
  limit?: number;
  /** 每个匹配项前后要附带的上下文行数。 */
  contextLines?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_CONTEXT_LINES = 20;
const MAX_LINE_LENGTH = 240;
/** 跳过超过该大小的文件，避免极端内存或耗时开销。 */
export const MAX_TEXT_FILE_BYTES = 2_000_000;

export type TextFileSkipReason = 'missing' | 'binary-extension' | 'too-large' | 'binary-content';

export type TextFileLines =
  | { readable: true; lines: string[]; bytes: number }
  | { readable: false; reason: TextFileSkipReason; bytes?: number };

/** 永远不当作可搜索文本处理的扩展名。 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.tgz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.flac', '.ogg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class',
  '.lock', // 锁文件通常很大，grep 价值也低。
]);

export function isProbablyTextFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return !BINARY_EXTENSIONS.has(ext);
}

/** 文件开头包含 NUL 字节时，几乎可以判定为二进制。 */
function looksBinary(content: string): boolean {
  const sampleLength = Math.min(content.length, 8000);
  for (let i = 0; i < sampleLength; i += 1) {
    if (content.charCodeAt(i) === 0) {
      return true;
    }
  }
  return false;
}

/** 仓库文件的惰性行缓存；按文件失效，让重复 grep 更便宜。 */
export class ContentIndex {
  private readonly cache = new Map<string, TextFileLines>();

  constructor(private readonly rootPath: string) {}

  /** 丢弃单个文件的缓存行，例如文件 change 事件后。 */
  invalidate(file: string): void {
    this.cache.delete(file);
  }

  /** 丢弃全部缓存，例如全量重扫后。 */
  clear(): void {
    this.cache.clear();
  }

  async readLines(file: string): Promise<TextFileLines> {
    if (this.cache.has(file)) {
      return this.cache.get(file)!;
    }

    if (!isProbablyTextFile(file)) {
      const result: TextFileLines = { readable: false, reason: 'binary-extension' };
      this.cache.set(file, result);
      return result;
    }

    const content = await readTextFile(path.join(this.rootPath, file));
    if (content === undefined) {
      const result: TextFileLines = { readable: false, reason: 'missing' };
      this.cache.set(file, result);
      return result;
    }

    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_TEXT_FILE_BYTES) {
      const result: TextFileLines = { readable: false, reason: 'too-large', bytes };
      this.cache.set(file, result);
      return result;
    }

    if (looksBinary(content)) {
      const result: TextFileLines = { readable: false, reason: 'binary-content', bytes };
      this.cache.set(file, result);
      return result;
    }

    const lines = content.split(/\r?\n/);
    const result: TextFileLines = { readable: true, lines, bytes };
    this.cache.set(file, result);
    return result;
  }

  async search(
    files: string[],
    pattern: string,
    options: ContentSearchOptions = {},
  ): Promise<{ matches: ContentMatch[]; truncated: boolean; scannedFiles: number }> {
    const limit = normalizeLimit(options.limit);
    const matcher = buildMatcher(pattern, options);
    const contextLines = normalizeContextLines(options.contextLines);
    const matches: ContentMatch[] = [];
    let scannedFiles = 0;
    let truncated = false;

    for (const file of files) {
      const fileLines = await this.readLines(file);
      if (!fileLines.readable) {
        continue;
      }
      const { lines } = fileLines;
      scannedFiles += 1;

      for (let i = 0; i < lines.length; i += 1) {
        if (matcher(lines[i]!)) {
          matches.push({
            path: file,
            line: i + 1,
            text: trimLine(lines[i]!),
            ...(contextLines > 0 ? buildContext(lines, i, contextLines) : {}),
          });
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

function buildContext(
  lines: string[],
  matchIndex: number,
  contextLines: number,
): Pick<ContentMatch, 'before' | 'after'> {
  const beforeStart = Math.max(0, matchIndex - contextLines);
  const afterEnd = Math.min(lines.length - 1, matchIndex + contextLines);

  return {
    before: toContentLines(lines, beforeStart, matchIndex - 1),
    after: toContentLines(lines, matchIndex + 1, afterEnd),
  };
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

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.floor(value);
}

function normalizeContextLines(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return 0;
  }

  return Math.min(Math.floor(value), MAX_CONTEXT_LINES);
}
