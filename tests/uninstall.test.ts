import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { describe, expect, test } from 'vitest';

import { runUninstall } from '../src/commands/uninstall.js';

async function createHomeDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'repomapper-uninstall-'));
}

describe('repomapper uninstall', () => {
  test('从 Claude JSON 配置中移除 repomapper 并保留其它 server', async () => {
    const homeDir = await createHomeDir();

    await fs.writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify(
        {
          theme: 'dark',
          mcpServers: {
            existing: { command: 'other' },
            repomapper: { type: 'stdio', command: 'repomapper', args: ['serve', '--mcp'] },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const output = await runUninstall({
      yes: true,
      target: 'claude',
      homeDir,
    });

    const config = JSON.parse(await fs.readFile(path.join(homeDir, '.claude.json'), 'utf8'));

    expect(config.theme).toBe('dark');
    expect(config.mcpServers.existing).toEqual({ command: 'other' });
    expect(config.mcpServers).not.toHaveProperty('repomapper');
    expect(output).toContain('Claude Code');
  });

  test('从 Codex TOML 配置中移除 repomapper 并保留其它配置', async () => {
    const homeDir = await createHomeDir();
    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.codex/config.toml'),
      [
        'approval_policy = "on-request"',
        '',
        '[mcp_servers.existing]',
        'command = "other"',
        'args = ["serve"]',
        '',
        '[mcp_servers.repomapper]',
        'command = "repomapper"',
        'args = ["serve", "--mcp"]',
        '',
      ].join('\n'),
      'utf8',
    );

    const output = await runUninstall({
      yes: true,
      target: 'codex',
      homeDir,
    });

    const config = parseToml(
      await fs.readFile(path.join(homeDir, '.codex/config.toml'), 'utf8'),
    ) as {
      approval_policy?: string;
      mcp_servers?: Record<string, { command?: string; args?: string[] }>;
    };

    expect(config.approval_policy).toBe('on-request');
    expect(config.mcp_servers?.existing).toEqual({ command: 'other', args: ['serve'] });
    expect(config.mcp_servers).not.toHaveProperty('repomapper');
    expect(output).toContain('Codex');
  });

  test('显式 target 缺少配置文件时跳过且不创建新文件', async () => {
    const homeDir = await createHomeDir();

    const output = await runUninstall({
      yes: true,
      target: 'cursor',
      homeDir,
    });

    await expect(fs.stat(path.join(homeDir, '.cursor/mcp.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(output).toContain('未找到可移除的 RepoMapper MCP 配置');
  });

  test('auto 模式只处理已存在的配置文件', async () => {
    const homeDir = await createHomeDir();
    await fs.mkdir(path.join(homeDir, '.cursor'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.cursor/mcp.json'),
      JSON.stringify({
        mcpServers: {
          repomapper: { type: 'stdio', command: 'repomapper', args: ['serve', '--mcp'] },
        },
      }),
      'utf8',
    );

    await runUninstall({
      yes: true,
      target: 'auto',
      homeDir,
    });

    const cursorConfig = JSON.parse(
      await fs.readFile(path.join(homeDir, '.cursor/mcp.json'), 'utf8'),
    );

    expect(cursorConfig.mcpServers).not.toHaveProperty('repomapper');
    await expect(fs.stat(path.join(homeDir, '.claude.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('未加 yes 时拒绝修改配置文件', async () => {
    const homeDir = await createHomeDir();

    await fs.writeFile(
      path.join(homeDir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          repomapper: { type: 'stdio', command: 'repomapper', args: ['serve', '--mcp'] },
        },
      }),
      'utf8',
    );

    await expect(
      runUninstall({
        target: 'claude',
        homeDir,
      }),
    ).rejects.toThrow('请加 --yes 确认移除');
  });
});
