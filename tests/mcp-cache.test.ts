import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { ProjectCache } from '../src/mcp/cache.js';

const sourceFixtureRoot = path.resolve('tests/fixtures/mcp-project');
let fixtureRoot = '';
let tempFile = '';
let tempPythonFile = '';
let originalUtilsPath = '';
let pythonUtilsPath = '';
let originalUtils = '';

describe('ProjectCache', () => {
  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'repomapper-mcp-cache-'));
    await fs.cp(sourceFixtureRoot, fixtureRoot, { recursive: true });
    tempFile = path.join(fixtureRoot, 'src/temp.ts');
    tempPythonFile = path.join(fixtureRoot, 'src/temp.py');
    originalUtilsPath = path.join(fixtureRoot, 'src/utils.ts');
    pythonUtilsPath = path.join(fixtureRoot, 'src/py_utils.py');
    originalUtils = await fs.readFile(originalUtilsPath, 'utf8');
  });

  afterEach(async () => {
    if (fixtureRoot.length > 0) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  test('首次查询时 lazy 初始化完整索引', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });

    await cache.ensureReady();

    expect(cache.getScan().files).toContain('src/main.ts');
    expect(cache.getDetection().projectName).toBe('mcp-project');
    expect(cache.getImportGraph().edges.length).toBeGreaterThan(0);
    expect(cache.getSymbols().some((file) => file.file === 'src/utils.ts')).toBe(true);
  });

  test('文件修改时只刷新该文件的 symbols 和 graph edges', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(
      originalUtilsPath,
      `${originalUtils}\nexport const changedValue = 1;\n`,
      'utf8',
    );
    cache.markDirty('src/utils.ts', 'change');

    await cache.refresh();

    expect(cache.getSymbols().find((file) => file.file === 'src/utils.ts')?.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'changedValue', kind: 'const', isDefault: false }),
      ]),
    );
    expect(cache.getPendingChanges()).toEqual([]);
  });

  test('新增文件时重新扫描并重建索引', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(
      tempFile,
      "import { helper } from './utils';\nexport const temp = helper();\n",
      'utf8',
    );
    cache.markDirty('src/temp.ts', 'add');

    await cache.refresh();

    expect(cache.getScan().files).toContain('src/temp.ts');
    expect(cache.getImportGraph().dependsOn.get('src/temp.ts')).toEqual(['src/utils.ts']);
  });

  test('新增文件随后收到 change 事件时仍然重新扫描', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(
      tempFile,
      "import { helper } from './utils';\nexport const temp = helper();\n",
      'utf8',
    );
    cache.markDirty('src/temp.ts', 'add');
    cache.markDirty('src/temp.ts', 'change');

    await cache.refresh();

    expect(cache.getScan().files).toContain('src/temp.ts');
  });

  test('Python 文件修改时刷新该文件的 import edges', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(tempPythonFile, 'from .py_utils import helper\nvalue = helper()\n', 'utf8');
    cache.markDirty('src/temp.py', 'add');
    await cache.refresh();

    expect(cache.getImportGraph().dependsOn.get('src/temp.py')).toEqual(['src/py_utils.py']);
  });

  test('Python 文件 change 事件会增量刷新 import edges', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(pythonUtilsPath, 'from . import py_main\nvalue = py_main.value\n', 'utf8');
    cache.markDirty('src/py_utils.py', 'change');
    await cache.refresh();

    expect(cache.getImportGraph().dependsOn.get('src/py_utils.py')).toEqual(['src/py_main.py']);
  });

  test('并发 refresh 会串行处理 pending 变更', async () => {
    const cache = new ProjectCache(fixtureRoot, { watch: false });
    await cache.ensureReady();

    await fs.writeFile(tempPythonFile, 'from .py_utils import helper\nvalue = helper()\n', 'utf8');
    cache.markDirty('src/temp.py', 'add');

    await Promise.all([cache.refresh(), cache.refresh()]);

    expect(cache.getScan().files).toContain('src/temp.py');
    expect(cache.getImportGraph().dependsOn.get('src/temp.py')).toEqual(['src/py_utils.py']);
    expect(cache.getPendingChanges()).toEqual([]);
  });
});
