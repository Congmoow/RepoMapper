import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { ProjectCache } from '../src/mcp/cache.js';
import { handleContext } from '../src/mcp/handlers/context.js';
import { handleFileInfo } from '../src/mcp/handlers/file-info.js';
import { handleGrep } from '../src/mcp/handlers/grep.js';
import { handleImpact } from '../src/mcp/handlers/impact.js';
import { handlePathBetween } from '../src/mcp/handlers/path-between.js';

const sourceFixtureRoot = path.resolve('tests/fixtures/mcp-project');
const tempWorkspaces: TempWorkspace[] = [];

interface TempWorkspace {
  root: string;
  files: string[];
  directories: string[];
}

describe('MCP agent UX', () => {
  afterEach(async () => {
    while (tempWorkspaces.length > 0) {
      await cleanupWorkspace(tempWorkspaces.pop()!);
    }
  });

  test('repomapper_grep 支持字面量、正则、glob、limit 和非法正则提示', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const literal = await handleGrep(cache, {
      pattern: 'helper',
      glob: 'src/**/*.ts',
      limit: 2,
    });
    const regex = await handleGrep(cache, {
      pattern: 'Button\\(',
      regex: true,
      glob: 'src/main.ts',
    });
    const invalid = await handleGrep(cache, { pattern: '(', regex: true });

    expect(literal.count).toBe(2);
    expect(literal.truncated).toBe(true);
    expect(literal.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringMatching(/^src\//),
          line: expect.any(Number),
        }),
      ]),
    );
    expect(regex.matches).toEqual([expect.objectContaining({ path: 'src/main.ts', line: 5 })]);
    expect(invalid).toMatchObject({ count: 0, scannedFiles: 0, truncated: false });
    expect(invalid.warnings[0]).toContain('Invalid regular expression');
  });

  test('repomapper_grep 在 change 刷新后能读到新内容并移除旧内容', async () => {
    const workspace = await createBasicTsProject();
    const utilsPath = path.join(workspace.root, 'src/utils.ts');
    const originalUtils = await fs.readFile(utilsPath, 'utf8');
    const cache = new ProjectCache(workspace.root, { watch: false });

    const before = await handleGrep(cache, { pattern: 'dynamicNeedle' });
    await fs.writeFile(
      utilsPath,
      `${originalUtils}\nexport const dynamicNeedle = 'after-refresh';\n`,
      'utf8',
    );
    cache.markDirty('src/utils.ts', 'change');
    const afterAdd = await handleGrep(cache, { pattern: 'dynamicNeedle' });
    await fs.writeFile(utilsPath, originalUtils, 'utf8');
    cache.markDirty('src/utils.ts', 'change');
    const afterRemove = await handleGrep(cache, { pattern: 'dynamicNeedle' });

    expect(before.matches).toEqual([]);
    expect(afterAdd.matches).toEqual([
      expect.objectContaining({
        path: 'src/utils.ts',
        text: "export const dynamicNeedle = 'after-refresh';",
      }),
    ]);
    expect(afterRemove.matches).toEqual([]);
  });

  test('repomapper_grep 跳过 NUL 二进制内容和超大文件', async () => {
    const workspace = await makeWorkspace({
      'package.json': '{"name":"grep-skip","type":"module"}\n',
      'src/binary.txt': 'binary-needle\u0000still-hidden',
      'src/large.txt': `large-needle\n${'x'.repeat(2_000_001)}`,
    });
    const cache = new ProjectCache(workspace.root, { watch: false });

    const binary = await handleGrep(cache, { pattern: 'binary-needle', glob: 'src/binary.txt' });
    const large = await handleGrep(cache, { pattern: 'large-needle', glob: 'src/large.txt' });

    expect(binary.matches).toEqual([]);
    expect(binary.scannedFiles).toBe(0);
    expect(large.matches).toEqual([]);
    expect(large.scannedFiles).toBe(0);
  });

  test('repomapper_path_between 返回最短依赖链并处理边界', async () => {
    const workspace = await createPathProject();
    const cache = new ProjectCache(workspace.root, { watch: false });

    const shortest = await handlePathBetween(cache, {
      from: 'src/a.ts',
      to: 'src/target.ts',
      maxPaths: 5,
    });
    const same = await handlePathBetween(cache, { from: 'src/a.ts', to: 'src/a.ts' });
    const tooShallow = await handlePathBetween(cache, {
      from: 'src/a.ts',
      to: 'src/c.ts',
      maxDepth: 1,
    });
    const missing = await handlePathBetween(cache, { from: 'src/missing.ts', to: 'src/target.ts' });

    expect(shortest).toMatchObject({
      connected: true,
      shortestLength: 1,
      truncated: false,
      paths: [['src/a.ts', 'src/target.ts']],
    });
    expect(same).toMatchObject({
      connected: true,
      shortestLength: 0,
      paths: [['src/a.ts']],
    });
    expect(tooShallow.connected).toBe(false);
    expect(tooShallow.paths).toEqual([]);
    expect(missing.connected).toBe(false);
    expect(missing.missing).toEqual(['src/missing.ts']);
  });

  test('repomapper_impact 的 limit 只截断扁平 impacted，不影响 levels', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const result = await handleImpact(cache, { paths: ['src/utils.ts'], depth: 2, limit: 1 });

    expect(result.impacted).toHaveLength(1);
    expect(result.totalImpacted).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.levels[1]).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
    expect(result.levelTotals[1]).toBe(2);
  });

  test('repomapper_file_info 在增量刷新后更新 callsByExport 行号', async () => {
    const workspace = await createBasicTsProject();
    const mainPath = path.join(workspace.root, 'src/main.ts');
    const originalMain = await fs.readFile(mainPath, 'utf8');
    const cache = new ProjectCache(workspace.root, { watch: false });

    const before = await handleFileInfo(cache, { path: 'src/utils.ts' });
    await fs.writeFile(mainPath, `\n\n${originalMain}`, 'utf8');
    cache.markDirty('src/main.ts', 'change');
    const after = await handleFileInfo(cache, { path: 'src/utils.ts' });

    expect(before.callsByExport.helper?.calledBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'src/main.ts', line: 4 })]),
    );
    expect(after.callsByExport.helper?.calledBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'src/main.ts', line: 6 })]),
    );
  });

  test('repomapper_context 对裸目录返回 warnings', async () => {
    const workspace = await makeWorkspace({});
    const cache = new ProjectCache(workspace.root, { watch: false });

    const result = await handleContext(cache);

    expect(result.detectedTechStack).toEqual([]);
    expect(result.warnings?.[0]).toContain('No project manifest');
    expect(result.warnings?.[0]).toContain('请将 server 指向仓库根目录');
  });
});

async function createBasicTsProject(): Promise<TempWorkspace> {
  return makeWorkspace({
    'package.json': '{"name":"basic-ts","type":"module"}\n',
    'src/main.ts': [
      "import { helper } from './utils';",
      '',
      'export function main(): string {',
      '  return helper();',
      '}',
      '',
    ].join('\n'),
    'src/utils.ts': [
      "export function helper(): string {",
      "  return 'help';",
      '}',
      '',
    ].join('\n'),
  });
}

async function createPathProject(): Promise<TempWorkspace> {
  return makeWorkspace({
    'package.json': '{"name":"path-project","type":"module"}\n',
    'src/a.ts': "export const a = 'a';\n",
    'src/b.ts': "import { a } from './a';\nexport const b = a;\n",
    'src/c.ts': "import { b } from './b';\nexport const c = b;\n",
    'src/target.ts': [
      "import { a } from './a';",
      "import { b } from './b';",
      'export const target = a + b;',
      '',
    ].join('\n'),
  });
}

async function makeWorkspace(files: Record<string, string>): Promise<TempWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repomapper-agent-ux-'));
  const workspace: TempWorkspace = { root, files: [], directories: [] };
  const directories = new Set<string>();

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    const directory = path.dirname(absolutePath);
    await fs.mkdir(directory, { recursive: true });
    collectDirectories(root, directory, directories);
    await fs.writeFile(absolutePath, content, 'utf8');
    workspace.files.push(absolutePath);
  }

  workspace.directories = [...directories].sort((left, right) => right.length - left.length);
  tempWorkspaces.push(workspace);
  return workspace;
}

function collectDirectories(root: string, directory: string, directories: Set<string>): void {
  let current = directory;
  while (current.startsWith(root) && current !== root) {
    directories.add(current);
    current = path.dirname(current);
  }
}

async function cleanupWorkspace(workspace: TempWorkspace): Promise<void> {
  for (const file of workspace.files) {
    await fs.unlink(file).catch(() => undefined);
  }
  for (const directory of workspace.directories) {
    await fs.rmdir(directory).catch(() => undefined);
  }
  await fs.rmdir(workspace.root).catch(() => undefined);
}
