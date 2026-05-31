import { afterEach, describe, expect, test, vi } from 'vitest';

import { loadConfig } from '../src/core/config.js';
import { createProjectContext } from '../src/core/context.js';
import { detectRepository } from '../src/core/detector.js';
import {
  clearGoModulePathCacheForTesting,
  extractGoImportEdgesForFile,
} from '../src/core/import-parsers/go.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import { scanRepository } from '../src/core/scanner.js';
import { readTextFile } from '../src/utils/fs.js';
import type { ScanResult } from '../src/types/index.js';
import type * as FsUtils from '../src/utils/fs.js';

vi.mock('../src/utils/fs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof FsUtils>();
  return {
    ...actual,
    readTextFile: vi.fn(actual.readTextFile),
  };
});

afterEach(() => {
  vi.mocked(readTextFile).mockClear();
  clearGoModulePathCacheForTesting();
});

describe('buildImportGraph', () => {
  test('解析 NodeNext 源码中的 .js specifier 到 .ts 文件', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/node-next-imports',
      files: ['src/main.ts', 'src/utils.ts'],
      directories: ['src'],
      keyFiles: [],
    };

    const graph = await buildImportGraph('tests/fixtures/node-next-imports', scan);

    expect(graph.dependsOn.get('src/main.ts')).toEqual(['src/utils.ts']);
    expect(graph.importedBy.get('src/utils.ts')).toEqual(['src/main.ts']);
  });

  test('解析 Python 项目内绝对导入和相对导入', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/python-project',
      files: [
        'main.py',
        'myapp/__init__.py',
        'myapp/models.py',
        'myapp/multiline.py',
        'myapp/services.py',
        'myapp/utils.py',
        'myapp/views.py',
      ],
      directories: ['myapp'],
      keyFiles: [],
    };

    const graph = await buildImportGraph('tests/fixtures/python-project', scan);

    expect(graph.dependsOn.get('main.py')).toEqual([
      'myapp/models.py',
      'myapp/utils.py',
      'myapp/views.py',
    ]);
    expect(graph.dependsOn.get('myapp/models.py')).toEqual(['myapp/utils.py']);
    expect(graph.dependsOn.get('myapp/multiline.py')).toEqual(['myapp/utils.py']);
    expect(graph.dependsOn.get('myapp/services.py')).toEqual(['myapp/models.py', 'myapp/utils.py']);
    expect(graph.dependsOn.get('myapp/views.py')).toEqual(['myapp/models.py']);
    expect(graph.importedBy.get('myapp/models.py')).toEqual([
      'main.py',
      'myapp/services.py',
      'myapp/views.py',
    ]);
    expect(graph.hubs).toEqual(expect.arrayContaining(['myapp/models.py', 'myapp/utils.py']));
  });

  test('解析 Go module path 导入到 package 代表文件', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/go-project',
      files: ['go.mod', 'main.go', 'pkg/auth/auth.go', 'pkg/utils/extra.go', 'pkg/utils/utils.go'],
      directories: ['pkg', 'pkg/auth', 'pkg/utils'],
      keyFiles: [],
    };

    const graph = await buildImportGraph('tests/fixtures/go-project', scan);

    expect(graph.dependsOn.get('main.go')).toEqual(['pkg/auth/auth.go', 'pkg/utils/utils.go']);
    expect(graph.dependsOn.get('pkg/auth/auth.go')).toEqual(['pkg/utils/utils.go']);
    expect(graph.importedBy.get('pkg/utils/utils.go')).toEqual(['main.go', 'pkg/auth/auth.go']);
    expect(graph.hubs[0]).toBe('pkg/utils/utils.go');
  });

  test('解析 Go import graph 时只读取一次 go.mod', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/go-project',
      files: ['go.mod', 'main.go', 'pkg/auth/auth.go', 'pkg/utils/extra.go', 'pkg/utils/utils.go'],
      directories: ['pkg', 'pkg/auth', 'pkg/utils'],
      keyFiles: [],
    };

    await buildImportGraph('tests/fixtures/go-project', scan);

    expect(
      vi
        .mocked(readTextFile)
        .mock.calls.filter((call) => call[0].replaceAll('\\', '/').endsWith('/go.mod')),
    ).toHaveLength(1);
  });

  test('重复解析 Go 单文件 import edges 时复用 go.mod module path', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/go-project',
      files: ['go.mod', 'main.go', 'pkg/auth/auth.go', 'pkg/utils/extra.go', 'pkg/utils/utils.go'],
      directories: ['pkg', 'pkg/auth', 'pkg/utils'],
      keyFiles: [],
    };

    await extractGoImportEdgesForFile('tests/fixtures/go-project', 'main.go', scan);
    await extractGoImportEdgesForFile('tests/fixtures/go-project', 'pkg/auth/auth.go', scan);

    expect(
      vi
        .mocked(readTextFile)
        .mock.calls.filter((call) => call[0].replaceAll('\\', '/').endsWith('/go.mod')),
    ).toHaveLength(1);
  });

  test('Python-only 项目报告包含 import graph summary', async () => {
    const rootPath = 'tests/fixtures/python-project';
    const config = await loadConfig(rootPath);
    const scan = await scanRepository(rootPath, config);
    const detection = await detectRepository(rootPath, scan);

    const context = await createProjectContext(rootPath, config, scan, detection);

    expect(context.importGraph?.edgeCount).toBeGreaterThan(0);
    expect(context.importGraph?.hubs).toContain('myapp/models.py');
    expect(context.symbols).toBeUndefined();
  });
});
