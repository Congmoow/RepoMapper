import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);

describe('serve CLI', () => {
  test('help 输出包含 serve --mcp 命令', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['./node_modules/tsx/dist/cli.mjs', 'src/cli.ts', 'serve', '--help'],
      { cwd: process.cwd() },
    );

    expect(stdout).toContain('通过 MCP stdio 提供仓库上下文工具');
    expect(stdout).toContain('--mcp');
  });
});
