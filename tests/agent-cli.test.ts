import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

  test('mcp call 支持 args-file，避免 Windows shell JSON 引号问题', async () => {
    const argsFile = path.join(os.tmpdir(), `repomapper-args-${Date.now()}.json`);
    await fs.writeFile(argsFile, '{"path":"src/utils.ts","fields":["exports"]}', 'utf8');

    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [
          ...cliArgs,
          'mcp',
          'call',
          'tests/fixtures/mcp-project',
          'repomapper_file_info',
          '--args-file',
          argsFile,
        ],
        { cwd: process.cwd() },
      );
      const parsed = JSON.parse(stdout) as { path: string; exports?: Array<{ name: string }> };

      expect(parsed.path).toBe('src/utils.ts');
      expect(parsed.exports).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'helper' })]),
      );
    } finally {
      await fs.unlink(argsFile).catch(() => undefined);
    }
  });

  test('mcp call 支持 args-stdin，并在缺参数时给出示例提示', async () => {
    const { stdout } = await spawnCli(
      [
        ...cliArgs,
        'mcp',
        'call',
        'tests/fixtures/mcp-project',
        'repomapper_file_info',
        '--args-stdin',
      ],
      '{"path":"src/utils.ts","fields":["exports"]}',
    );
    const parsed = JSON.parse(stdout) as { path: string; exports?: Array<{ name: string }> };

    expect(parsed.path).toBe('src/utils.ts');

    await expect(
      execFileAsync(
        process.execPath,
        [...cliArgs, 'mcp', 'call', 'tests/fixtures/mcp-project', 'repomapper_file_info'],
        { cwd: process.cwd() },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        '示例：repomapper mcp call . repomapper_file_info --args-file args.json',
      ),
    });
  });
});

function spawnCli(args: string[], input: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`CLI exited with ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}
