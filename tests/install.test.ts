import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { buildMcpServerEntry, mergeMcpServerConfig, runInstall } from '../src/commands/install.js';

const tempRoot = path.resolve('tests/.tmp-install');

describe('repomapper install', () => {
  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  test('merge MCP 配置时保留已有 server 并写入 repomapper', () => {
    const result = mergeMcpServerConfig({
      mcpServers: {
        existing: {
          command: 'other',
        },
      },
    });

    expect(result).toEqual({
      mcpServers: {
        existing: {
          command: 'other',
        },
        repomapper: buildMcpServerEntry('repomapper'),
      },
    });
  });

  test('print-config 只输出配置片段，不写文件', async () => {
    const output = await runInstall({
      target: 'claude',
      printConfig: 'claude',
      homeDir: tempRoot,
      command: 'repomapper',
    });

    expect(output).toContain('"repomapper"');
    await expect(fs.stat(path.join(tempRoot, '.claude.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('非交互模式按 target 写入 Claude 和 Cursor 配置', async () => {
    await fs.writeFile(
      path.join(tempRoot, '.claude.json'),
      '{\n  // keep comment\n  "mcpServers": {"existing": {"command": "other"}}\n}\n',
      'utf8',
    );

    const output = await runInstall({
      yes: true,
      target: 'claude,cursor',
      homeDir: tempRoot,
      command: 'repomapper',
    });

    const claudeConfig = JSON.parse(await fs.readFile(path.join(tempRoot, '.claude.json'), 'utf8'));
    const cursorConfig = JSON.parse(
      await fs.readFile(path.join(tempRoot, '.cursor/mcp.json'), 'utf8'),
    );

    expect(claudeConfig.mcpServers.existing.command).toBe('other');
    expect(claudeConfig.mcpServers.repomapper).toEqual(buildMcpServerEntry('repomapper'));
    expect(cursorConfig.mcpServers.repomapper).toEqual(buildMcpServerEntry('repomapper'));
    expect(output).toContain('Claude Code');
    expect(output).toContain('Cursor');
  });

  test('写入 Codex TOML 配置时保留已有配置', async () => {
    await fs.mkdir(path.join(tempRoot, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.codex/config.toml'),
      'approval_policy = "on-request"\n',
      'utf8',
    );

    const output = await runInstall({
      yes: true,
      target: 'codex',
      homeDir: tempRoot,
      command: 'repomapper',
    });

    const content = await fs.readFile(path.join(tempRoot, '.codex/config.toml'), 'utf8');
    const codexConfig = parseToml(content) as {
      approval_policy?: string;
      mcp_servers?: Record<string, { command?: string; args?: string[] }>;
    };

    expect(codexConfig.approval_policy).toBe('on-request');
    expect(codexConfig.mcp_servers?.repomapper).toEqual({
      command: 'repomapper',
      args: ['serve', '--mcp'],
    });
    expect(output).toContain('Codex');
  });

  test('auto 模式只写入检测到配置目录的目标', async () => {
    await fs.mkdir(path.join(tempRoot, '.cursor'), { recursive: true });

    await runInstall({
      yes: true,
      target: 'auto',
      homeDir: tempRoot,
      command: 'repomapper',
    });

    const cursorConfig = JSON.parse(
      await fs.readFile(path.join(tempRoot, '.cursor/mcp.json'), 'utf8'),
    );

    expect(cursorConfig.mcpServers.repomapper).toEqual(buildMcpServerEntry('repomapper'));
    await expect(fs.stat(path.join(tempRoot, '.claude.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
