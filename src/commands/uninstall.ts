import os from 'node:os';
import path from 'node:path';

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { RepoMapperError } from '../utils/errors.js';
import { readJsoncFile, readTextFile, writeTextFile } from '../utils/fs.js';

const dotName = (name: string): string => `.${name}`;
const DEFAULT_TARGET = 'auto';
const SERVER_NAME = 'repomapper';

type UninstallTarget = 'auto' | 'claude' | 'cursor' | 'codex';

export interface UninstallOptions {
  yes?: boolean;
  target?: string;
  homeDir?: string;
}

interface UninstallTargetDefinition {
  target: Exclude<UninstallTarget, 'auto'>;
  label: string;
  kind: 'json' | 'toml';
}

interface UninstallTargetResult {
  label: string;
  location: string;
  removed: boolean;
}

const UNINSTALL_TARGETS: UninstallTargetDefinition[] = [
  { target: 'claude', label: 'Claude Code', kind: 'json' },
  { target: 'cursor', label: 'Cursor', kind: 'json' },
  { target: 'codex', label: 'Codex', kind: 'toml' },
];

export async function runUninstall(options: UninstallOptions = {}): Promise<string> {
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const targets = await resolveUninstallTargets(options.target ?? DEFAULT_TARGET, homeDir);

  if (options.yes !== true) {
    const labels =
      targets.length > 0
        ? targets.map((target) => target.label).join('、')
        : 'Claude Code、Cursor 或 Codex';
    throw new RepoMapperError(`即将移除 ${labels} 的 RepoMapper MCP 配置。请加 --yes 确认移除。`);
  }

  const results: UninstallTargetResult[] = [];

  for (const target of targets) {
    const location = targetLocation(target.target, homeDir);
    const removed = await removeTarget(target, location);
    results.push({ label: target.label, location, removed });
  }

  return renderUninstallResult(results);
}

async function resolveUninstallTargets(
  targetInput: string,
  homeDir: string,
): Promise<UninstallTargetDefinition[]> {
  const targets = parseTargetList(targetInput);

  if (!targets.includes('auto')) {
    return targets.map((target) => getTargetDefinition(target));
  }

  if (targets.length > 1) {
    throw new RepoMapperError('--target auto 不能和其他目标混用。');
  }

  const detectedTargets: UninstallTargetDefinition[] = [];

  for (const target of UNINSTALL_TARGETS) {
    if (await exists(targetLocation(target.target, homeDir))) {
      detectedTargets.push(target);
    }
  }

  return detectedTargets;
}

function parseTargetList(targetInput: string): UninstallTarget[] {
  const targets = targetInput
    .split(',')
    .map((target) => normalizeTarget(target))
    .filter((target, index, allTargets) => allTargets.indexOf(target) === index);

  if (targets.length === 0) {
    throw new RepoMapperError('请至少指定一个移除目标。');
  }

  return targets;
}

function normalizeTarget(target: string): UninstallTarget {
  const normalizedTarget = target.trim().toLowerCase();

  if (
    normalizedTarget === 'auto' ||
    normalizedTarget === 'claude' ||
    normalizedTarget === 'cursor' ||
    normalizedTarget === 'codex'
  ) {
    return normalizedTarget;
  }

  throw new RepoMapperError(`不支持的移除目标：${target}`);
}

function getTargetDefinition(targetName: UninstallTarget): UninstallTargetDefinition {
  if (targetName === 'auto') {
    throw new RepoMapperError('--target auto 不能在这里作为明确目标使用。');
  }

  const definition = UNINSTALL_TARGETS.find((target) => target.target === targetName);

  if (definition === undefined) {
    throw new RepoMapperError(`不支持的移除目标：${targetName}`);
  }

  return definition;
}

async function removeTarget(target: UninstallTargetDefinition, location: string): Promise<boolean> {
  if (target.kind === 'toml') {
    return removeTomlTarget(location);
  }

  return removeJsonTarget(location);
}

async function removeJsonTarget(location: string): Promise<boolean> {
  const existingConfig = await readJsoncFile(location);

  if (!isPlainRecord(existingConfig) || !isPlainRecord(existingConfig.mcpServers)) {
    return false;
  }

  const existingServers = existingConfig.mcpServers;

  if (!Object.hasOwn(existingServers, SERVER_NAME)) {
    return false;
  }

  const nextServers = { ...existingServers };
  delete nextServers[SERVER_NAME];

  await writeTextFile(
    location,
    `${JSON.stringify({ ...existingConfig, mcpServers: nextServers }, null, 2)}\n`,
  );

  return true;
}

async function removeTomlTarget(location: string): Promise<boolean> {
  const existingConfig = await readTomlTarget(location);

  if (!isPlainRecord(existingConfig) || !isPlainRecord(existingConfig.mcp_servers)) {
    return false;
  }

  const existingServers = existingConfig.mcp_servers;

  if (!Object.hasOwn(existingServers, SERVER_NAME)) {
    return false;
  }

  const nextServers = { ...existingServers };
  delete nextServers[SERVER_NAME];

  await writeTextFile(
    location,
    `${stringifyToml({ ...existingConfig, mcp_servers: nextServers })}\n`,
  );

  return true;
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

function renderUninstallResult(results: UninstallTargetResult[]): string {
  const removed = results.filter((result) => result.removed);
  const skipped = results.filter((result) => !result.removed);

  if (removed.length === 0) {
    return '未找到可移除的 RepoMapper MCP 配置。';
  }

  const lines = ['已移除 RepoMapper MCP 配置：'];

  for (const target of removed) {
    lines.push(`- ${target.label}: ${target.location}`);
  }

  if (skipped.length > 0) {
    lines.push('', '以下目标未找到可移除的 RepoMapper MCP 配置：');

    for (const target of skipped) {
      lines.push(`- ${target.label}: ${target.location}`);
    }
  }

  return lines.join('\n');
}

function targetLocation(target: Exclude<UninstallTarget, 'auto'>, homeDir: string): string {
  switch (target) {
    case 'claude':
      return path.join(homeDir, `${dotName('claude')}.json`);
    case 'cursor':
      return path.join(homeDir, dotName('cursor'), 'mcp.json');
    case 'codex':
      return path.join(homeDir, dotName('codex'), 'config.toml');
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
