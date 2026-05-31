import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

describe('affected CLI', () => {
  test('help 输出包含 affected 命令和常用选项', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['./node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'affected', '--help'],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain('分析变更影响范围');
    expect(stdout).toContain('--files');
    expect(stdout).toContain('--depth');
    expect(stdout).toContain('--json');
  });
});
