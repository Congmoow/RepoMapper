import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { loadConfig } from '../core/config.js';
import { buildImportGraph } from '../core/import-graph.js';
import { resolveRepoPath } from '../core/path-resolver.js';
import { scanRepository } from '../core/scanner.js';
import { RepoMapperError } from '../utils/errors.js';
import { toPosixPath } from '../utils/path.js';

const execFileAsync = promisify(execFile);

export interface AffectedOptions {
  files?: string;
  depth?: string;
  json?: boolean;
}

export interface AffectedResult {
  changed: string[];
  depth: number;
  impacted: string[];
  affectedTests: string[];
  missing: string[];
  suggestions: Record<string, string[]>;
  warnings: string[];
}

export async function analyzeAffected(
  rootPath = '.',
  options: AffectedOptions = {},
): Promise<AffectedResult> {
  const resolvedRoot = path.resolve(rootPath);
  const depth = normalizeDepth(options.depth);
  const changed = normalizeFileList(
    options.files === undefined ? await readGitDiffFiles(resolvedRoot) : options.files,
  );

  if (changed.length === 0) {
    return {
      changed: [],
      depth,
      impacted: [],
      affectedTests: [],
      missing: [],
      suggestions: {},
      warnings: [],
    };
  }

  const config = await loadConfig(resolvedRoot);
  const scan = await scanRepository(resolvedRoot, config);
  const graph = await buildImportGraph(resolvedRoot, scan);
  const resolutions = changed.map((filePath) => resolveRepoPath(scan, filePath, 'file'));
  const traversalRoots = resolutions
    .filter((resolution) => resolution.exists)
    .map((resolution) => resolution.path);
  const missing = resolutions
    .filter((resolution) => !resolution.exists)
    .map((resolution) => resolution.path);
  const suggestions = Object.fromEntries(
    resolutions
      .filter((resolution) => resolution.suggestions.length > 0)
      .map((resolution) => [resolution.input, resolution.suggestions]),
  );
  const warnings = resolutions.flatMap((resolution) => resolution.warnings);
  const impacted = collectImpactedFiles(traversalRoots, depth, graph.importedBy);
  const affectedTests = impacted.filter(isTestFileOrDirectoryPath);

  return {
    changed,
    depth,
    impacted,
    affectedTests,
    missing,
    suggestions,
    warnings,
  };
}

export async function runAffected(rootPath = '.', options: AffectedOptions = {}): Promise<void> {
  const result = await analyzeAffected(rootPath, options);

  if (options.json === true) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(renderAffected(result));
}

function collectImpactedFiles(
  roots: string[],
  depth: number,
  importedBy: Map<string, string[]>,
): string[] {
  const seen = new Set(roots);
  const impacted = new Set<string>();
  let frontier = roots;

  for (let level = 1; level <= depth; level += 1) {
    const next = new Set<string>();

    for (const filePath of frontier) {
      for (const dependent of importedBy.get(filePath) ?? []) {
        if (!seen.has(dependent)) {
          seen.add(dependent);
          next.add(dependent);
        }
      }
    }

    const values = [...next].sort((left, right) => left.localeCompare(right));
    for (const value of values) {
      impacted.add(value);
    }
    frontier = values;

    if (frontier.length === 0) {
      break;
    }
  }

  return [...impacted].sort((left, right) => left.localeCompare(right));
}

function renderAffected(result: AffectedResult): string {
  return [
    `变更文件：${result.changed.length}`,
    ...result.changed.map((file) => `- ${file}`),
    ...result.warnings.map((warning) => `警告：${warning}`),
    '',
    `受影响文件（depth=${result.depth}）：${result.impacted.length}`,
    ...result.impacted.map((file) => `- ${file}`),
    '',
    `受影响测试：${result.affectedTests.length}`,
    ...result.affectedTests.map((file) => `- ${file}`),
  ].join('\n');
}

function normalizeDepth(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '2', 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return 2;
  }

  return parsed;
}

function normalizeFileList(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(normalizeFilePath).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function normalizeFilePath(value: string): string {
  return toPosixPath(value.trim()).replace(/^\.\//, '');
}

function isTestFileOrDirectoryPath(filePath: string): boolean {
  return (
    /(^|\/)(tests?|__tests__)\/.+/.test(filePath) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath) ||
    /^test_.+\.py$/.test(path.posix.basename(filePath))
  );
}

async function readGitDiffFiles(rootPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD'], {
      cwd: rootPath,
      windowsHide: true,
    });
    return stdout;
  } catch {
    throw new RepoMapperError('无法读取 git diff，请使用 --files 显式传入变更文件列表。');
  }
}
