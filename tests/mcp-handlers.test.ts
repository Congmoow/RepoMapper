import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { ProjectCache } from '../src/mcp/cache.js';
import { handleContext } from '../src/mcp/handlers/context.js';
import { handleFileInfo } from '../src/mcp/handlers/file-info.js';
import { handleHubs } from '../src/mcp/handlers/hubs.js';
import { handleImpact } from '../src/mcp/handlers/impact.js';
import { handleDependents, handleImports } from '../src/mcp/handlers/imports.js';
import { handleRefresh } from '../src/mcp/handlers/refresh.js';
import { handleSearch } from '../src/mcp/handlers/search.js';
import { handleStatus } from '../src/mcp/handlers/status.js';
import { handleTree } from '../src/mcp/handlers/tree.js';

const fixtureRoot = 'tests/fixtures/mcp-project';

describe('MCP handlers', () => {
  test('repomapper_context 返回项目概览', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleContext(cache);

    expect(result.projectName).toBe('mcp-project');
    expect(result.detectedTechStack).toEqual(expect.arrayContaining(['TypeScript']));
    expect(result.entryPoints).toEqual(
      expect.arrayContaining([{ path: 'src/main.ts', label: expect.any(String) }]),
    );
    expect(result.scripts).toEqual(
      expect.arrayContaining([{ name: 'test', command: 'vitest run' }]),
    );
  });

  test('repomapper_tree 按子目录和深度返回目录树', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleTree(cache, { path: 'src', depth: 2 });

    expect(result.root).toBe('src');
    expect(result.tree).toContain('src');
    expect(result.tree).toContain('components/');
    expect(result.tree).toContain('main.ts');
    expect(result.tree).not.toContain('package.json');
  });

  test('repomapper_search 支持文件、目录和 symbol 搜索', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const files = await handleSearch(cache, { pattern: '*.ts', kind: 'file' });
    const globFiles = await handleSearch(cache, {
      pattern: 'src/{main,utils}.ts',
      kind: 'file',
      limit: 1,
    });
    const dirs = await handleSearch(cache, { pattern: 'components', kind: 'dir' });
    const symbols = await handleSearch(cache, { pattern: 'helper', kind: 'symbol' });

    expect(files.matches.map((match) => match.path)).toEqual(
      expect.arrayContaining(['src/main.ts']),
    );
    expect(globFiles.matches).toHaveLength(1);
    expect(globFiles.matches[0]?.path).toBe('src/main.ts');
    expect(dirs.matches).toEqual(expect.arrayContaining([{ path: 'src/components', kind: 'dir' }]));
    expect(symbols.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/utils.ts',
          kind: 'symbol',
          name: 'helper',
          symbolKind: 'function',
        }),
      ]),
    );
  });

  test('repomapper_file_info 返回 exports、imports 和 dependents', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleFileInfo(cache, { path: 'src/utils.ts' });

    expect(result.path).toBe('src/utils.ts');
    expect(result.exports).toEqual(
      expect.arrayContaining([{ name: 'helper', kind: 'function', isDefault: false }]),
    );
    expect(result.imports).toEqual([]);
    expect(result.importedBy).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
    expect(result.callsByExport.helper).toBeDefined();
    expect(result.callsByExport.helper?.calledBy).toEqual(
      expect.arrayContaining([
        { file: 'src/main.ts', symbol: 'main' },
        { file: 'src/components/Button.ts', symbol: 'Button' },
      ]),
    );
  });

  test('repomapper_file_info 对 Python 文件仅标注 symbols 限制', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleFileInfo(cache, { path: 'src/py_utils.py' });

    expect(result.exists).toBe(true);
    expect(result.limitation).toBe(
      'imports/importedBy 支持 TS/JS、Python 和 Go；exports 与 callsByExport 目前仅支持 TS/JS。',
    );
  });

  test('repomapper_imports 和 repomapper_dependents 查询 fan-out/fan-in', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const imports = await handleImports(cache, { path: 'src/main.ts' });
    const dependents = await handleDependents(cache, { path: 'src/utils.ts' });

    expect(imports.imports).toEqual(
      expect.arrayContaining(['src/utils.ts', 'src/components/Button.ts']),
    );
    expect(dependents.dependents).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
  });

  test('repomapper_hubs 返回依赖最多的模块', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleHubs(cache, { limit: 3 });

    expect(result.hubs[0]).toMatchObject({ path: 'src/utils.ts', dependentCount: 2 });
  });

  test('repomapper_impact 返回指定深度的反向依赖闭包', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleImpact(cache, { paths: ['src/utils.ts'], depth: 2 });

    expect(result.impacted).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
    expect(result.levels[1]).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
  });

  test('repomapper_impact 支持 minDepth 过滤并按 hub 权重排序', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const result = await handleImpact(cache, { paths: ['src/leaf.ts'], depth: 2, minDepth: 2 });

    expect(result.minDepth).toBe(2);
    expect(result.levels[1]).toBeUndefined();
    expect(result.impacted).toEqual(['src/top.ts']);
    expect(result.levels[2]).toEqual(['src/top.ts']);
  });

  test('repomapper_status 返回索引状态和 pending 变更', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    cache.markDirty('src/utils.ts', 'change');
    const result = await handleStatus(cache);

    expect(result.indexedFiles).toBeGreaterThan(0);
    expect(result.symbols).toBeGreaterThan(0);
    expect(result.edges).toBeGreaterThan(0);
    expect(result.pendingChanges).toEqual([{ path: 'src/utils.ts', event: 'change' }]);
    expect(result.needsRefresh).toBe(true);
    expect(result.fresh).toBe(false);
    expect(result.nextAction).toContain('repomapper_refresh');
  });

  test('repomapper_search 支持 all 搜索和内部方法符号', async () => {
    const cache = new ProjectCache('.', { watch: false });

    const fullScan = await handleSearch(cache, { pattern: 'fullScan', kind: 'symbol', limit: 5 });
    const fuzzy = await handleSearch(cache, { pattern: 'mcp cache', kind: 'all', limit: 5 });

    expect(fullScan.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'src/mcp/cache.ts',
          kind: 'symbol',
          name: 'fullScan',
          symbolKind: 'method',
          container: 'ProjectCache',
          line: expect.any(Number),
          exported: false,
        }),
      ]),
    );
    expect(fuzzy.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'src/mcp/cache.ts', kind: 'file' })]),
    );
  });

  test('repomapper_file_info 对缺扩展名路径返回建议并解析唯一候选', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const resolved = await handleFileInfo(cache, { path: 'src/utils' });
    const missing = await handleFileInfo(cache, { path: 'src/utlis' });

    expect(resolved).toMatchObject({
      path: 'src/utils.ts',
      exists: true,
      suggestions: ['src/utils.ts'],
      warnings: expect.any(Array),
    });
    expect(missing).toMatchObject({
      path: 'src/utlis',
      exists: false,
      suggestions: expect.arrayContaining(['src/utils.ts']),
      imports: [],
      importedBy: [],
    });
  });

  test('repomapper_impact 对缺扩展名和缺失根返回解析信息', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    const resolved = await handleImpact(cache, { paths: ['src/utils'], depth: 1 });
    const missing = await handleImpact(cache, { paths: ['src/utlis'], depth: 1 });

    expect(resolved.roots).toEqual(['src/utils.ts']);
    expect(resolved.suggestions['src/utils']).toEqual(['src/utils.ts']);
    expect(resolved.impacted).toEqual(
      expect.arrayContaining(['src/main.ts', 'src/components/Button.ts']),
    );
    expect(missing.missingRoots).toEqual(['src/utlis']);
    expect(missing.suggestions['src/utlis']).toEqual(expect.arrayContaining(['src/utils.ts']));
    expect(missing.impacted).toEqual([]);
  });

  test('repomapper_refresh 显式刷新 pending 变更并返回 fresh 状态', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    cache.markDirty('src/utils.ts', 'change');
    const result = await handleRefresh(cache);

    expect(result.pendingChanges).toEqual([]);
    expect(result.needsRefresh).toBe(false);
    expect(result.fresh).toBe(true);
  });

  test('serve 子目录时 context 返回项目根提示和可用技术栈', async () => {
    const cache = new ProjectCache('src', { watch: false });

    const result = await handleContext(cache);

    expect(result.projectName).toBe('repo-mapper-cli');
    expect(result.projectRoot).toBe(path.resolve('.'));
    expect(result.rootWarning).toContain('项目根');
    expect(result.detectedTechStack).toEqual(expect.arrayContaining(['TypeScript']));
    expect(result.entryPoints).toEqual(
      expect.arrayContaining([{ path: 'cli.ts', label: expect.any(String) }]),
    );
    expect(result.workspaceFiles).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'package.json' })]),
    );
  });
});
