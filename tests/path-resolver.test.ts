import { describe, expect, test } from 'vitest';

import { resolveRepoPath } from '../src/core/path-resolver.js';
import type { ScanResult } from '../src/types/index.js';

const scan: ScanResult = {
  rootPath: '/repo',
  files: ['src/mcp/cache.ts', 'src/mcp/cache.test.ts', 'src/mcp/server.ts', 'src/utils.ts'],
  directories: ['src', 'src/mcp'],
  keyFiles: [],
};

describe('resolveRepoPath', () => {
  test('精确路径命中时返回原路径', () => {
    expect(resolveRepoPath(scan, 'src/mcp/cache.ts', 'file')).toMatchObject({
      path: 'src/mcp/cache.ts',
      exists: true,
      kind: 'file',
      suggestions: [],
      warnings: [],
    });
  });

  test('唯一扩展名候选会自动解析', () => {
    expect(resolveRepoPath(scan, 'src/utils', 'file')).toMatchObject({
      input: 'src/utils',
      path: 'src/utils.ts',
      exists: true,
      kind: 'file',
      resolvedFrom: 'src/utils',
      suggestions: ['src/utils.ts'],
    });
  });

  test('缺失路径返回建议而不是静默空结果', () => {
    expect(resolveRepoPath(scan, 'src/mcp/cach', 'file')).toMatchObject({
      path: 'src/mcp/cach',
      exists: false,
      suggestions: expect.arrayContaining(['src/mcp/cache.ts', 'src/mcp/cache.test.ts']),
    });
  });

  test('多候选路径不会自动选择', () => {
    const result = resolveRepoPath(scan, 'src/mcp/cache', 'file');

    expect(result.exists).toBe(false);
    expect(result.path).toBe('src/mcp/cache');
    expect(result.suggestions).toEqual(['src/mcp/cache.test.ts', 'src/mcp/cache.ts']);
    expect(result.warnings[0]).toContain('多个候选');
  });
});
