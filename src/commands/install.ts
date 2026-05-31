import os from 'node:os';
import path from 'node:path';

import pc from 'picocolors';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { RepoMapperError } from '../utils/errors.js';
import { readJsoncFile, readTextFile, writeTextFile } from '../utils/fs.js';

const dotName = (name: string): string => `.${name}`;
const DEFAULT_TARGET = 'auto';
const DEFAULT_COMMAND = 'repomapper';
const SERVER_NAME = 'repomapper';

export type InstallTarget = 'auto' | 'claude' | 'cursor' | 'codex';

export interface InstallOptions {
  yes?: boolean;
  target?: string;
  printConfig?: string;
  homeDir?: string;
  command?: string;
}

export interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: readonly ['serve', '--mcp'];
}

export type JsonObject = Record<string, unknown>;

interface InstallTargetDefinition {
  target: Exclude<InstallTarget, 'auto'>;
  label: string;
  kind: 'json' | 'toml';
}

interface InstalledTarget {
  label: string;
  location: string;
}

const INSTALL_TARGETS: InstallTargetDefinition[] = [
  { target: 'claude', label: 'Claude Code', kind: 'json' },
  { target: 'cursor', label: 'Cursor', kind: 'json' },
  { target: 'codex', label: 'Codex', kind: 'toml' },
];

export function buildMcpServerEntry(command = DEFAULT_COMMAND): McpServerEntry {
  return {
    type: 'stdio',
    command,
    args: ['serve', '--mcp'],
  };
}

export function mergeMcpServerConfig(existingConfig: unknown, command = DEFAULT_COMMAND): JsonObject {
  const baseConfig = isPlainRecord(existingConfig) ? { ...existingConfig } : {};
  const existingServers = isPlainRecord(baseConfig.mcpServers) ? baseConfig.mcpServers : {};

  return {
    ...baseConfig,
    mcpServers: {
      ...existingServers,
      [SERVER_NAME]: buildMcpServerEntry(command),
    },
  };
}

export async function runInstall(options: InstallOptions = {}): Promise<string> {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const command = options.command ?? DEFAULT_COMMAND;

  if (options.printConfig !== undefined) {
    const target = getTargetDefinition(options.printConfig);
    return renderConfig(target, command);
  }

  const targets = await resolveInstallTargets(options.target ?? DEFAULT_TARGET, homeDir);

  if (targets.length === 0) {
    throw new RepoMapperError(
      '未检测到 Claude Code、Cursor 或 Codex 配置位置。请使用 --target claude,cursor,codex 指定安装目标。',
    );
  }

  if (options.yes !== true) {
    const labels = targets.map((target) => target.label).join('、');
    throw new RepoMapperError(`即将写入 ${labels} 的 MCP 配置。请加 --yes 确认写入。`);
  }

  const installed: InstalledTarget[] = [];

  for (const target of targets) {
    const location = targetLocation(target.target, homeDir);
    await writeTarget(target, location, command);
    installed.push({ label: target.label, location });
  }

  return renderInstallResult(installed);
}

function getTargetDefinition(targetName: string): InstallTargetDefinition {
  const normalizedTarget = normalizeTarget(targetName);

  if (normalizedTarget === 'auto') {
    throw new RepoMapperError('--print-config 需要指定明确目标：claude、cursor 或 codex。');
  }

  const definition = INSTALL_TARGETS.find((target) => target.target === normalizedTarget);

  if (definition === undefined) {
    throw new RepoMapperError(`不支持的安装目标：${targetName}`);
  }

  return definition;
}

async function resolveInstallTargets(
  targetInput: string,
  homeDir: string,
): Promise<InstallTargetDefinition[]> {
  const targets = parseTargetList(targetInput);

  if (!targets.includes('auto')) {
    return targets.map((target) => getTargetDefinition(target));
  }

  if (targets.length > 1) {
    throw new RepoMapperError('--target auto 不能和其它目标混用。');
  }

  const detectedTargets: InstallTargetDefinition[] = [];

  for (const target of INSTALL_TARGETS) {
    if (await hasDetectedTarget(target.target, homeDir)) {
      detectedTargets.push(target);
    }
  }

  return detectedTargets;
}

function parseTargetList(targetInput: string): InstallTarget[] {
  const targets = targetInput
    .split(',')
    .map((target) => normalizeTarget(target))
    .filter((target, index, allTargets) => allTargets.indexOf(target) === index);

  if (targets.length === 0) {
    throw new RepoMapperError('请至少指定一个安装目标。');
  }

  return targets;
}

function normalizeTarget(target: string): InstallTarget {
  const normalizedTarget = target.trim().toLowerCase();

  if (
    normalizedTarget === 'auto' ||
    normalizedTarget === 'claude' ||
    normalizedTarget === 'cursor' ||
    normalizedTarget === 'codex'
  ) {
    return normalizedTarget;
  }

  throw new RepoMapperError(`不支持的安装目标：${target}`);
}

async function writeTarget(
  target: InstallTargetDefinition,
  location: string,
  command: string,
): Promise<void> {
  if (target.kind === 'toml') {
    await writeTomlTarget(location, command);
    return;
  }

  const existingConfig = await readJsoncFile(location);
  await writeTextFile(
    location,
    `${JSON.stringify(mergeMcpServerConfig(existingConfig, command), null, 2)}\n`,
  );
}

async function writeTomlTarget(location: string, command: string): Promise<void> {
  const existingConfig = await readTomlTarget(location);
  const baseConfig = isPlainRecord(existingConfig) ? { ...existingConfig } : {};
  const existingServers = isPlainRecord(baseConfig.mcp_servers) ? baseConfig.mcp_servers : {};

  baseConfig.mcp_servers = {
    ...existingServers,
    [SERVER_NAME]: {
      command,
      args: ['serve', '--mcp'],
    },
  };

  await writeTextFile(location, `${stringifyToml(baseConfig)}\n`);
}

async function readTomlTarget(location: string): Promise<unknown | undefined> {
  const content = await readTextFile(location);

  if (content === undefined) {
    return undefined;
  }

  try {
    return parseToml(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoMapperError(`无法解析 TOML 配置文件 ${location}: ${message}`);
  }
}

function renderConfig(target: InstallTargetDefinition, command: string): string {
  if (target.kind === 'toml') {
    return `${stringifyToml({
      mcp_servers: {
        [SERVER_NAME]: {
          command,
          args: ['serve', '--mcp'],
        },
      },
    })}\n`;
  }

  return `${JSON.stringify(mergeMcpServerConfig({}, command), null, 2)}\n`;
}

function renderInstallResult(installed: InstalledTarget[]): string {
  const lines = ['已写入 RepoMapper MCP 配置：'];

  for (const target of installed) {
    lines.push(`- ${target.label}: ${target.location}`);
  }

  lines.push(
    '',
    '重启 agent 后即可使用 RepoMapper MCP。',
    `也可以通过 ${pc.cyan('repomapper serve . --mcp')} 手动启动 stdio MCP server。`,
  );

  return lines.join('\n');
}

async function hasDetectedTarget(
  target: Exclude<InstallTarget, 'auto'>,
  homeDir: string,
): Promise<boolean> {
  for (const candidate of targetProbeLocations(target, homeDir)) {
    if (await exists(candidate)) {
      return true;
    }
  }

  return false;
}

function targetLocation(target: Exclude<InstallTarget, 'auto'>, homeDir: string): string {
  switch (target) {
    case 'claude':
      return path.join(homeDir, `${dotName('claude')}.json`);
    case 'cursor':
      return path.join(homeDir, dotName('cursor'), 'mcp.json');
    case 'codex':
      return path.join(homeDir, dotName('codex'), 'config.toml');
  }
}

function targetProbeLocations(target: Exclude<InstallTarget, 'auto'>, homeDir: string): string[] {
  switch (target) {
    case 'claude':
      return [targetLocation(target, homeDir), path.join(homeDir, dotName('claude'))];
    case 'cursor':
      return [path.join(homeDir, dotName('cursor'))];
    case 'codex':
      return [path.join(homeDir, dotName('codex')), targetLocation(target, homeDir)];
  }
}

async function exists(location: string): Promise<boolean> {
  try {
    await fsAccess(location);
    return true;
  } catch {
    return false;
  }
}

async function fsAccess(location: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.access(location);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
