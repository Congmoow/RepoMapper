import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const cliArgs = ['./node_modules/tsx/dist/cli.mjs', 'src/cli.ts'];

describe('agent-friendly CLI output', () => {
  test('scan --json 输出可解析 JSON', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [...cliArgs, 'scan', 'tests/fixtures/mcp-project', '--json'],
      { cwd: process.cwd() },
    );

    const parsed = JSON.parse(stdout) as {
      projectName: string;
      detectedTechStack: string[];
      keyFiles: string[];
      entryPoints: string[];
    };

    expect(parsed.projectName).toBe('mcp-project');
    expect(parsed.detectedTechStack).toContain('TypeScript');
    expect(parsed.keyFiles).toContain('package.json');
    expect(parsed.entryPoints).toContain('src/main.ts');
  });

  test('doctor --json 输出 checks 和 summary', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [...cliArgs, 'doctor', 'tests/fixtures/mcp-project', '--json'],
      { cwd: process.cwd() },
    );

    const parsed = JSON.parse(stdout) as {
      summary: { pass: number; warning: number; fail: number };
      checks: Array<{ label: string; status: string; message: string }>;
    };

    expect(parsed.summary.pass).toBeGreaterThan(0);
    expect(parsed.summary.fail).toBe(0);
    expect(parsed.checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'package.json', status: 'pass' })]),
    );
  });

  test('help 不再暴露静态 CODEMAP 生成命令', async () => {
    const { stdout } = await execFileAsync(process.execPath, [...cliArgs, '--help'], {
      cwd: process.cwd(),
    });

    expect(stdout).not.toContain('generate');
    expect(stdout).not.toContain('watch');
    expect(stdout).not.toContain('CODEMAP');
  });

  test('generate 命令已被彻底移除', async () => {
    await expect(
      execFileAsync(process.execPath, [...cliArgs, 'generate', 'tests/fixtures/mcp-project'], {
        cwd: process.cwd(),
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("unknown command 'generate'"),
    });
  });

  test('affected --json 对扩展名缺失路径返回建议', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [...cliArgs, 'affected', 'tests/fixtures/affected-project', '--files', 'src/utils', '--json'],
      { cwd: process.cwd() },
    );

    const parsed = JSON.parse(stdout) as {
      changed: string[];
      missing: string[];
      suggestions: Record<string, string[]>;
      impacted: string[];
    };

    expect(parsed.changed).toEqual(['src/utils']);
    expect(parsed.missing).toEqual([]);
    expect(parsed.suggestions['src/utils']).toEqual(['src/utils.ts']);
    expect(parsed.impacted).toEqual(expect.arrayContaining(['src/service.ts']));
  });

  test('mcp call 可一次性调用本地 MCP 工具并输出结构化 JSON', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        ...cliArgs,
        'mcp',
        'call',
        'tests/fixtures/mcp-project',
        'repomapper_file_info',
        '--args',
        '{"path":"src/utils.ts","fields":["exports"]}',
      ],
      { cwd: process.cwd() },
    );

    const parsed = JSON.parse(stdout) as {
      path: string;
      exports?: Array<{ name: string }>;
      imports?: string[];
    };

    expect(parsed.path).toBe('src/utils.ts');
    expect(parsed.exports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'helper' })]),
    );
    expect(parsed.imports).toBeUndefined();
  });
});
