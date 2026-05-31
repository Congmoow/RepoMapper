import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

describe('install CLI', () => {
  test('help 输出包含 install 命令和常用选项', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['./node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'install', '--help'],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain('安装 RepoMapper MCP 配置');
    expect(stdout).toContain('--target');
    expect(stdout).toContain('--print-config');
    expect(stdout).toContain('--yes');
  });
});
