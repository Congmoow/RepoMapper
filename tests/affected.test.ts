import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { analyzeAffected } from '../src/commands/affected.js';

describe('repomapper affected', () => {
  test('根据显式文件列表返回受影响文件和测试文件候选', async () => {
    const result = await analyzeAffected('tests/fixtures/affected-project', {
      files: 'src/utils.ts',
      depth: '3',
    });

    expect(result.changed).toEqual(['src/utils.ts']);
    expect(result.impacted).toEqual(
      expect.arrayContaining(['src/service.ts', 'tests/service.test.ts']),
    );
    expect(result.affectedTests).toEqual(['tests/service.test.ts']);
  });

  test('没有变更文件时返回空结果', async () => {
    const result = await analyzeAffected('tests/fixtures/affected-project', {
      files: '',
    });

    expect(result.changed).toEqual([]);
    expect(result.impacted).toEqual([]);
    expect(result.affectedTests).toEqual([]);
  });

  test('缺扩展名路径会解析影响并返回建议', async () => {
    const result = await analyzeAffected('tests/fixtures/affected-project', {
      files: 'src/utils',
      depth: '2',
    });

    expect(result.changed).toEqual(['src/utils']);
    expect(result.missing).toEqual([]);
    expect(result.suggestions['src/utils']).toEqual(['src/utils.ts']);
    expect(result.impacted).toEqual(
      expect.arrayContaining(['src/service.ts', 'tests/service.test.ts']),
    );
  });

  test('不存在路径会返回 missing 和 suggestions', async () => {
    const result = await analyzeAffected('tests/fixtures/affected-project', {
      files: 'src/util',
      depth: '2',
    });

    expect(result.changed).toEqual(['src/util']);
    expect(result.missing).toEqual(['src/util']);
    expect(result.suggestions['src/util']).toEqual(['src/utils.ts']);
    expect(result.impacted).toEqual([]);
  });

  test('未显式传入 files 且 git diff 失败时抛出错误', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'repomapper-affected-'));

    try {
      await expect(analyzeAffected(tempRoot)).rejects.toThrow('无法读取 git diff');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
