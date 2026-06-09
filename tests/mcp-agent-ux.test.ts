import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { ProjectCache } from '../src/mcp/cache.js';
import { handleContext } from '../src/mcp/handlers/context.js';
import { handleFileInfo, handleFileInfoBatch } from '../src/mcp/handlers/file-info.js';
import { handleGrep } from '../src/mcp/handlers/grep.js';
import { handleImpact } from '../src/mcp/handlers/impact.js';
import { handlePathBetween } from '../src/mcp/handlers/path-between.js';
import { handleReadFile } from '../src/mcp/handlers/read-file.js';
import { handleSearch } from '../src/mcp/handlers/search.js';

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

  test('repomapper_read_file 读取已索引文本行范围并拒绝不安全或非文本路径', async () => {
    const workspace = await makeWorkspace({
      'package.json': '{"name":"read-file-project","type":"module"}\n',
      'src/main.ts': [
        "import { helper } from './utils';",
        '',
        'export function main(): string {',
        '  return helper();',
        '}',
        '',
      ].join('\n'),
      'src/utils.ts': "export function helper(): string {\n  return 'ok';\n}\n",
      'src/binary.txt': 'needle\u0000hidden',
      'src/large.txt': `needle\n${'x'.repeat(2_000_001)}`,
    });
    const cache = new ProjectCache(workspace.root, { watch: false });

    const range = await handleReadFile(cache, {
      path: 'src/main',
      startLine: 2,
      endLine: 4,
    });
    const missing = await handleReadFile(cache, { path: 'src/mian.ts' });
    const outside = await handleReadFile(cache, { path: '../package.json' });
    const absolute = await handleReadFile(cache, { path: path.join(workspace.root, 'src/main.ts') });
    const truncated = await handleReadFile(cache, {
      path: 'src/main.ts',
      startLine: 1,
      endLine: 3,
      maxBytes: 20,
    });
    const binary = await handleReadFile(cache, { path: 'src/binary.txt' });
    const large = await handleReadFile(cache, { path: 'src/large.txt' });

    expect(range).toMatchObject({
      path: 'src/main.ts',
      exists: true,
      startLine: 2,
      endLine: 4,
      truncated: false,
      suggestions: ['src/main.ts'],
    });
    expect(range.content).toBe("\nexport function main(): string {\n  return helper();");
    expect(range.totalLines).toBeGreaterThanOrEqual(5);
    expect(missing).toMatchObject({
      exists: false,
      content: '',
      suggestions: expect.arrayContaining(['src/main.ts']),
    });
    expect(outside).toMatchObject({ exists: false, content: '' });
    expect(absolute).toMatchObject({ exists: false, content: '' });
    expect(truncated).toMatchObject({
      path: 'src/main.ts',
      exists: true,
      startLine: 1,
      endLine: 1,
      truncated: true,
    });
    expect(truncated.content.length).toBeLessThan("import { helper } from './utils';".length);
    expect(binary).toMatchObject({ exists: true, content: '' });
    expect(binary.warnings[0]).toContain('不是可读取的文本文件');
    expect(large).toMatchObject({ exists: true, content: '' });
    expect(large.warnings[0]).toContain('过大');
  });

  test('repomapper_grep 可返回上下文行且默认结果保持精简', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const defaultResult = await handleGrep(cache, {
      pattern: 'helper',
      glob: 'src/main.ts',
      limit: 1,
    });
    const withContext = await handleGrep(cache, {
      pattern: 'helper',
      glob: 'src/main.ts',
      limit: 1,
      contextLines: 1,
    });

    expect(defaultResult.matches[0]).not.toHaveProperty('before');
    expect(defaultResult.matches[0]).not.toHaveProperty('after');
    expect(withContext.matches[0]).toMatchObject({
      path: 'src/main.ts',
      line: 2,
      text: "import { helper } from './utils';",
      before: [{ line: 1, text: "import { Button } from './components/Button';" }],
      after: [{ line: 3, text: '' }],
    });
  });

  test('repomapper_grep 限制上下文行数避免过大返回', async () => {
    const workspace = await makeWorkspace({
      'package.json': '{"name":"grep-context-cap","type":"module"}\n',
      'src/main.ts': [
        ...Array.from({ length: 25 }, (_, index) => `const before${index + 1} = ${index + 1};`),
        'const needle = true;',
        ...Array.from({ length: 25 }, (_, index) => `const after${index + 1} = ${index + 1};`),
        '',
      ].join('\n'),
    });
    const cache = new ProjectCache(workspace.root, { watch: false });

    const result = await handleGrep(cache, {
      pattern: 'needle',
      glob: 'src/main.ts',
      contextLines: 200,
    });

    expect(result.matches[0]?.before).toHaveLength(20);
    expect(result.matches[0]?.after).toHaveLength(20);
    expect(result.matches[0]?.before?.[0]).toMatchObject({ line: 6 });
    expect(result.matches[0]?.after?.at(-1)).toMatchObject({ line: 46 });
  });

  test('repomapper_grep 返回分页元数据并支持 offset 续页', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const firstPage = await handleGrep(cache, {
      pattern: 'helper',
      glob: 'src/**/*.ts',
      limit: 1,
    });
    const secondPage = await handleGrep(cache, {
      pattern: 'helper',
      glob: 'src/**/*.ts',
      limit: 1,
      offset: firstPage.nextOffset ?? 0,
    });

    expect(firstPage).toMatchObject({
      count: 1,
      offset: 0,
      total: expect.any(Number),
      truncated: true,
      nextOffset: 1,
    });
    expect(firstPage.total).toBeGreaterThan(1);
    expect(secondPage.offset).toBe(1);
    expect(secondPage.matches[0]).not.toEqual(firstPage.matches[0]);
  });

  test('repomapper_search 可返回定义片段、总数和截断信息，并优先排序精确命中', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const result = await handleSearch(cache, {
      pattern: 'src',
      kind: 'symbol',
      limit: 1,
      contextLines: 1,
    });

    expect(result.total).toBeGreaterThan(1);
    expect(result.truncated).toBe(true);
    expect(result.nextOffset).toBe(1);
    expect(result.matches[0]).toMatchObject({
      kind: 'symbol',
      text: expect.any(String),
      before: expect.any(Array),
      after: expect.any(Array),
    });
  });

  test('repomapper_search 零结果时提示改用 grep，泛搜时函数优先于类型', async () => {
    const cache = new ProjectCache('.', { watch: false });

    const noMatch = await handleSearch(cache, {
      pattern: 'repomapper_grep',
      kind: 'all',
    });
    const symbolSearch = await handleSearch(cache, {
      pattern: 'search',
      kind: 'symbol',
      limit: 3,
    });

    expect(noMatch.matches).toEqual([]);
    expect(noMatch.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('repomapper_grep')]),
    );
    expect(symbolSearch.matches[0]).toMatchObject({
      name: 'handleSearch',
      symbolKind: 'function',
    });
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

  test('repomapper_path_between 未连通时提示方向语义和正向依赖链', async () => {
    const workspace = await createPathProject();
    const cache = new ProjectCache(workspace.root, { watch: false });

    const result = await handlePathBetween(cache, {
      from: 'src/target.ts',
      to: 'src/a.ts',
    });

    expect(result.connected).toBe(false);
    expect(result.direction).toBe('reverse-dependency');
    expect(result.queryInterpretedAs).toBe('change-propagation');
    expect(result.reason).toBe('forward-path-only');
    expect(result.directionHint).toContain('变更传播');
    expect(result.forwardDependencyPath).toEqual(['src/target.ts', 'src/a.ts']);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('正向依赖路径')]),
    );
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

  test('repomapper_impact 可返回每个受影响文件的最短解释路径', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const result = await handleImpact(cache, {
      paths: ['src/leaf.ts'],
      depth: 2,
      limit: 1,
      includePaths: true,
    });

    expect(result.impacted).toHaveLength(1);
    expect(result.levels[2]).toEqual(['src/top.ts']);
    expect(Object.keys(result.pathsByFile ?? {})).toEqual(result.impacted);
    expect(result.pathsByFile?.['src/mid.ts']).toEqual(['src/leaf.ts', 'src/mid.ts']);
    expect(result.pathsByFile).not.toHaveProperty('src/top.ts');
  });

  test('repomapper_file_info 在增量刷新后更新 callsByExport 行号', async () => {
    const workspace = await createBasicTsProject();
    const mainPath = path.join(workspace.root, 'src/main.ts');
    const originalMain = await fs.readFile(mainPath, 'utf8');
    const cache = new ProjectCache(workspace.root, { watch: false });

    const before = await handleFileInfo(cache, {
      path: 'src/utils.ts',
      fields: ['callsByExport'],
    });
    await fs.writeFile(mainPath, `\n\n${originalMain}`, 'utf8');
    cache.markDirty('src/main.ts', 'change');
    const after = await handleFileInfo(cache, {
      path: 'src/utils.ts',
      fields: ['callsByExport'],
    });

    expect(before.callsByExport?.helper?.calledBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'src/main.ts', line: 4 })]),
    );
    expect(after.callsByExport?.helper?.calledBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'src/main.ts', line: 6 })]),
    );
  });

  test('repomapper_file_info 支持字段裁剪和批量查询', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const explicitDefault = await handleFileInfo(cache, {
      path: 'src/utils.ts',
      fields: [],
    });
    const implicitDefault = await handleFileInfo(cache, {
      path: 'src/utils.ts',
    });
    const trimmed = await handleFileInfo(cache, {
      path: 'src/utils.ts',
      fields: ['importedBy'],
    });
    const batch = await handleFileInfoBatch(cache, {
      paths: ['src/utils.ts', 'src/utlis.ts'],
      fields: ['exports'],
    });

    expect(explicitDefault).toMatchObject({
      exports: expect.any(Array),
      symbols: expect.any(Array),
      imports: expect.any(Array),
      importedBy: expect.any(Array),
      callsByExport: expect.any(Object),
    });
    expect(implicitDefault).toMatchObject({
      exports: expect.any(Array),
      symbols: expect.any(Array),
      imports: expect.any(Array),
      importedBy: expect.any(Array),
    });
    expect(implicitDefault).not.toHaveProperty('callsByExport');
    expect(trimmed).toMatchObject({
      path: 'src/utils.ts',
      exists: true,
      importedBy: expect.arrayContaining(['src/main.ts']),
    });
    expect(trimmed).not.toHaveProperty('exports');
    expect(trimmed).not.toHaveProperty('callsByExport');
    expect(batch.files).toHaveLength(2);
    expect(batch.files[0]).toMatchObject({
      path: 'src/utils.ts',
      exports: expect.arrayContaining([expect.objectContaining({ name: 'helper' })]),
    });
    expect(batch.files[0]).not.toHaveProperty('imports');
    expect(batch.files[1]).toMatchObject({
      path: 'src/utlis.ts',
      exists: false,
      suggestions: expect.arrayContaining(['src/utils.ts']),
    });
    expect(batch.files[1]).not.toHaveProperty('limitation');
  });

  test('repomapper_file_info 为导出符号返回 best-effort 导入调用点', async () => {
    const cache = new ProjectCache(sourceFixtureRoot, { watch: false });

    const result = await handleFileInfo(cache, {
      path: 'src/utils.ts',
      fields: ['callsByExport'],
    });

    expect(result.callsByExport?.helper?.importCallSites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'src/main.ts',
          line: 5,
          text: '  return Button(helper());',
        }),
        expect.objectContaining({
          file: 'src/components/Button.ts',
          line: 3,
          text: 'export function Button(label: string = helper()): string {',
        }),
      ]),
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

  test('repomapper_context 返回面向 Agent 的推荐阅读顺序', async () => {
    const cache = new ProjectCache('.', { watch: false });

    const result = await handleContext(cache);

    expect(result.recommendedNextReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/cli.ts', reason: expect.stringContaining('CLI') }),
        expect.objectContaining({
          path: 'src/mcp/tools.ts',
          reason: expect.stringContaining('MCP'),
        }),
      ]),
    );
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
