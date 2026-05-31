import type { ScanResult } from '../types/index.js';
import { toPosixPath } from '../utils/path.js';

export type RepoPathKind = 'file' | 'dir' | 'any';

export interface RepoPathResolution {
  input: string;
  path: string;
  exists: boolean;
  kind?: Exclude<RepoPathKind, 'any'> | undefined;
  resolvedFrom?: string | undefined;
  suggestions: string[];
  warnings: string[];
}

const EXTENSION_CANDIDATE_LIMIT = 10;

export function resolveRepoPath(
  scan: ScanResult,
  value: string,
  expectedKind: RepoPathKind = 'any',
): RepoPathResolution {
  const input = normalizeRepoPath(value);
  const normalized = input.length === 0 ? '.' : input;
  const files = new Set(scan.files);
  const directories = new Set(scan.directories);

  if ((expectedKind === 'file' || expectedKind === 'any') && files.has(normalized)) {
    return exactResolution(input, normalized, 'file');
  }

  if ((expectedKind === 'dir' || expectedKind === 'any') && directories.has(normalized)) {
    return exactResolution(input, normalized, 'dir');
  }

  if (normalized === '.' && expectedKind !== 'file') {
    return exactResolution(input, normalized, 'dir');
  }

  const extensionCandidates =
    expectedKind === 'dir' ? [] : findExtensionCandidates(scan.files, normalized);

  if (extensionCandidates.length === 1) {
    return {
      input,
      path: extensionCandidates[0]!,
      exists: true,
      kind: 'file',
      resolvedFrom: normalized,
      suggestions: extensionCandidates,
      warnings: [`已将 ${normalized} 解析为 ${extensionCandidates[0]}`],
    };
  }

  const suggestions =
    extensionCandidates.length > 0
      ? extensionCandidates
      : suggestSimilarPaths(scan, normalized, expectedKind);

  return {
    input,
    path: normalized,
    exists: false,
    suggestions,
    warnings: buildMissingWarnings(normalized, suggestions, extensionCandidates.length > 1),
  };
}

export function normalizeRepoPath(value: string): string {
  return toPosixPath(value.trim())
    .replace(/^\.?\//, '')
    .replace(/\/$/, '');
}

function exactResolution(
  input: string,
  normalized: string,
  kind: Exclude<RepoPathKind, 'any'>,
): RepoPathResolution {
  return {
    input,
    path: normalized,
    exists: true,
    kind,
    suggestions: [],
    warnings: [],
  };
}

function findExtensionCandidates(files: string[], normalized: string): string[] {
  return files
    .filter((file) => file.startsWith(`${normalized}.`))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, EXTENSION_CANDIDATE_LIMIT);
}

function suggestSimilarPaths(
  scan: ScanResult,
  normalized: string,
  expectedKind: RepoPathKind,
): string[] {
  const entries = [
    ...(expectedKind === 'dir' ? [] : scan.files),
    ...(expectedKind === 'file' ? [] : scan.directories),
  ];
  const targetBase = basenameWithoutExtension(normalized).toLowerCase();
  const targetDirectory = dirname(normalized);

  return entries
    .filter((entry) => dirname(entry) === targetDirectory)
    .filter((entry) => {
      const candidateBase = basenameWithoutExtension(entry).toLowerCase();
      return (
        candidateBase.includes(targetBase) ||
        targetBase.includes(candidateBase) ||
        levenshteinDistance(candidateBase, targetBase) <= 2
      );
    })
    .sort((left, right) => left.localeCompare(right))
    .slice(0, EXTENSION_CANDIDATE_LIMIT);
}

function buildMissingWarnings(
  normalized: string,
  suggestions: string[],
  ambiguous: boolean,
): string[] {
  if (suggestions.length === 0) {
    return [`路径不存在或未被索引：${normalized}`];
  }

  if (ambiguous) {
    return [`路径 ${normalized} 存在多个候选，请使用完整文件名。`];
  }

  return [`路径不存在或未被索引：${normalized}；可尝试候选路径。`];
}

function dirname(value: string): string {
  const index = value.lastIndexOf('/');
  return index === -1 ? '' : value.slice(0, index);
}

function basenameWithoutExtension(value: string): string {
  const basename = value.slice(value.lastIndexOf('/') + 1);
  const extensionIndex = basename.indexOf('.');
  return extensionIndex === -1 ? basename : basename.slice(0, extensionIndex);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];

    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current[rightIndex + 1] =
        left[leftIndex] === right[rightIndex]
          ? previous[rightIndex]!
          : Math.min(previous[rightIndex]!, previous[rightIndex + 1]!, current[rightIndex]!) + 1;
    }

    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? 0;
}
