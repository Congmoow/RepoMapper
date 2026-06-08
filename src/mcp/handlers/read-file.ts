import type { ProjectCache } from '../cache.js';
import { resolveRepoPath } from '../../core/path-resolver.js';
import { MAX_TEXT_FILE_BYTES } from '../../core/content-index.js';

interface ReadFileArgs {
  path: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  maxBytes?: number | undefined;
}

export async function handleReadFile(
  cache: ProjectCache,
  args: ReadFileArgs,
): Promise<{
  path: string;
  exists: boolean;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  suggestions: string[];
  warnings: string[];
}> {
  await cache.refresh();
  const scan = cache.getScan();
  const resolution = resolveRepoPath(scan, args.path, 'file');
  const warnings = [...resolution.warnings];

  if (!resolution.exists) {
    return emptyReadResult(resolution.path, false, resolution.suggestions, warnings);
  }

  const fileLines = await cache.getContentIndex().readLines(resolution.path);
  if (!fileLines.readable) {
    warnings.push(readabilityWarning(resolution.path, fileLines.reason, fileLines.bytes));
    return emptyReadResult(resolution.path, true, resolution.suggestions, warnings);
  }

  const totalLines = fileLines.lines.length;
  const startLine = normalizeLine(args.startLine, 1, totalLines);
  const requestedEndLine = normalizeLine(args.endLine, totalLines, totalLines);
  const endLine = Math.max(startLine, requestedEndLine);
  const maxBytes = normalizeMaxBytes(args.maxBytes);
  const selectedLines = fileLines.lines.slice(startLine - 1, endLine);
  const { content, truncated } = applyMaxBytes(selectedLines.join('\n'), maxBytes);

  return {
    path: resolution.path,
    exists: true,
    content,
    startLine,
    endLine: startLine + content.split(/\n/).length - 1,
    totalLines,
    truncated,
    suggestions: resolution.suggestions,
    warnings,
  };
}

function emptyReadResult(
  filePath: string,
  exists: boolean,
  suggestions: string[],
  warnings: string[],
): {
  path: string;
  exists: boolean;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  suggestions: string[];
  warnings: string[];
} {
  return {
    path: filePath,
    exists,
    content: '',
    startLine: 0,
    endLine: 0,
    totalLines: 0,
    truncated: false,
    suggestions,
    warnings,
  };
}

function readabilityWarning(filePath: string, reason: string, bytes: number | undefined): string {
  if (reason === 'too-large') {
    return `${filePath} 过大，无法安全读取（${bytes ?? 'unknown'} bytes，限制 ${MAX_TEXT_FILE_BYTES} bytes）。`;
  }

  if (reason === 'missing') {
    return `${filePath} 已被索引，但当前无法从磁盘读取。`;
  }

  return `${filePath} 不是可读取的文本文件。`;
}

function normalizeLine(value: number | undefined, fallback: number, totalLines: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(value), 1), Math.max(totalLines, 1));
}

function normalizeMaxBytes(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return undefined;
  }

  return Math.floor(value);
}

function applyMaxBytes(content: string, maxBytes: number | undefined): {
  content: string;
  truncated: boolean;
} {
  if (maxBytes === undefined || Buffer.byteLength(content, 'utf8') <= maxBytes) {
    return { content, truncated: false };
  }

  let next = '';
  for (const char of content) {
    if (Buffer.byteLength(next + char, 'utf8') > maxBytes) {
      break;
    }
    next += char;
  }

  return { content: next, truncated: true };
}
