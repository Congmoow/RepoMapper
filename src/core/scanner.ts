import fg from 'fast-glob';
import ignore from 'ignore';

import type { RepoMapperConfig, ScanResult } from '../types/index.js';
import { resolveRootPath, toPosixPath } from '../utils/path.js';

const KEY_FILE_PATTERNS = [
  'package.json',
  'README.md',
  'readme.md',
  'src',
  'frontend',
  'backend',
  'packages',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Dockerfile',
  '.github/workflows',
  'prisma/schema.prisma',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
];

export async function scanRepository(rootPath: string, config: RepoMapperConfig): Promise<ScanResult> {
  const resolvedRoot = resolveRootPath(rootPath);
  const matcher = ignore().add(buildIgnoreRules(config));
  const entries = await fg('**/*', {
    cwd: resolvedRoot,
    dot: true,
    onlyFiles: false,
    markDirectories: true,
    followSymbolicLinks: false,
    unique: true,
  });

  const directoryEntries = new Set(
    entries.filter((entry) => entry.endsWith('/')).map((entry) => toPosixPath(entry).replace(/\/$/, '')),
  );

  const filteredEntries = entries
    .map((entry) => toPosixPath(entry).replace(/\/$/, ''))
    .filter((entry) => entry.length > 0)
    .filter((entry) => !matcher.ignores(entry));

  const files = filteredEntries.filter((entry) => !directoryEntries.has(entry)).sort();
  const directories = filteredEntries
    .filter((entry) => directoryEntries.has(entry))
    .sort((left, right) => left.localeCompare(right));
  const keyFiles = collectKeyFiles(files, directories);

  return {
    rootPath: resolvedRoot,
    files,
    directories,
    keyFiles,
  };
}

function buildIgnoreRules(config: RepoMapperConfig): string[] {
  const rules = [...config.ignore];

  if (!config.includeTests) {
    rules.push('tests', '**/*.test.*', '**/*.spec.*');
  }

  if (!config.includeCi) {
    rules.push('.github/workflows');
  }

  if (!config.includeDocker) {
    rules.push('Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml');
  }

  return rules;
}

function collectKeyFiles(files: string[], directories: string[]): string[] {
  const keyFiles = new Set<string>();
  const allEntries = new Set([...files, ...directories]);

  for (const pattern of KEY_FILE_PATTERNS) {
    if (allEntries.has(pattern)) {
      keyFiles.add(pattern);
      continue;
    }

    if (pattern === '.github/workflows') {
      const hasWorkflow = files.some((file) => file.startsWith('.github/workflows/'));
      if (hasWorkflow) {
        keyFiles.add(pattern);
      }
    }
  }

  return [...keyFiles].sort();
}
