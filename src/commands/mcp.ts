import { ProjectCache } from '../mcp/cache.js';
import { handleContext } from '../mcp/handlers/context.js';
import { handleFileInfo, handleFileInfoBatch } from '../mcp/handlers/file-info.js';
import { handleGrep } from '../mcp/handlers/grep.js';
import { handleHubs } from '../mcp/handlers/hubs.js';
import { handleImpact } from '../mcp/handlers/impact.js';
import { handleDependents, handleImports } from '../mcp/handlers/imports.js';
import { handlePathBetween } from '../mcp/handlers/path-between.js';
import { handleReadFile } from '../mcp/handlers/read-file.js';
import { handleRefresh } from '../mcp/handlers/refresh.js';
import { handleSearch } from '../mcp/handlers/search.js';
import { handleStatus } from '../mcp/handlers/status.js';
import { handleTree } from '../mcp/handlers/tree.js';
import { RepoMapperError } from '../utils/errors.js';

interface McpCallOptions {
  args?: string | undefined;
}

type ToolHandler = (cache: ProjectCache, args: Record<string, unknown>) => Promise<object>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  repomapper_context: (cache) => handleContext(cache),
  repomapper_tree: (cache, args) => handleTree(cache, args),
  repomapper_search: (cache, args) =>
    handleSearch(cache, {
      pattern: stringArg(args, 'pattern'),
      kind: enumArg(args, 'kind', ['file', 'dir', 'symbol', 'all']),
      limit: numberArg(args, 'limit'),
      offset: numberArg(args, 'offset'),
      contextLines: numberArg(args, 'contextLines'),
    }),
  repomapper_grep: (cache, args) =>
    handleGrep(cache, {
      pattern: stringArg(args, 'pattern'),
      regex: booleanArg(args, 'regex'),
      ignoreCase: booleanArg(args, 'ignoreCase'),
      glob: optionalStringArg(args, 'glob'),
      limit: numberArg(args, 'limit'),
      contextLines: numberArg(args, 'contextLines'),
    }),
  repomapper_read_file: (cache, args) =>
    handleReadFile(cache, {
      path: stringArg(args, 'path'),
      startLine: numberArg(args, 'startLine'),
      endLine: numberArg(args, 'endLine'),
      maxBytes: numberArg(args, 'maxBytes'),
    }),
  repomapper_file_info: (cache, args) =>
    handleFileInfo(cache, {
      path: stringArg(args, 'path'),
      fields: stringArrayArg(args, 'fields') as Array<
        'exports' | 'symbols' | 'imports' | 'importedBy' | 'callsByExport'
      > | undefined,
    }),
  repomapper_file_info_batch: (cache, args) =>
    handleFileInfoBatch(cache, {
      paths: requiredStringArrayArg(args, 'paths'),
      fields: stringArrayArg(args, 'fields') as Array<
        'exports' | 'symbols' | 'imports' | 'importedBy' | 'callsByExport'
      > | undefined,
    }),
  repomapper_imports: (cache, args) =>
    handleImports(cache, {
      path: stringArg(args, 'path'),
      limit: numberArg(args, 'limit'),
      offset: numberArg(args, 'offset'),
    }),
  repomapper_dependents: (cache, args) =>
    handleDependents(cache, {
      path: stringArg(args, 'path'),
      limit: numberArg(args, 'limit'),
      offset: numberArg(args, 'offset'),
    }),
  repomapper_hubs: (cache, args) => handleHubs(cache, { limit: numberArg(args, 'limit') }),
  repomapper_impact: (cache, args) =>
    handleImpact(cache, {
      paths: requiredStringArrayArg(args, 'paths'),
      depth: numberArg(args, 'depth'),
      minDepth: numberArg(args, 'minDepth'),
      limit: numberArg(args, 'limit'),
      includePaths: booleanArg(args, 'includePaths'),
    }),
  repomapper_path_between: (cache, args) =>
    handlePathBetween(cache, {
      from: stringArg(args, 'from'),
      to: stringArg(args, 'to'),
      maxPaths: numberArg(args, 'maxPaths'),
      maxDepth: numberArg(args, 'maxDepth'),
    }),
  repomapper_refresh: (cache) => handleRefresh(cache),
  repomapper_status: (cache) => handleStatus(cache),
};

export async function runMcpCall(
  rootPath: string,
  toolName: string,
  options: McpCallOptions = {},
): Promise<void> {
  const handler = TOOL_HANDLERS[toolName];
  if (handler === undefined) {
    throw new RepoMapperError(
      `未知 MCP tool：${toolName}。可用工具：${Object.keys(TOOL_HANDLERS).join(', ')}`,
    );
  }

  const args = parseArgs(options.args);
  const cache = new ProjectCache(rootPath, { watch: false });

  try {
    const result = await handler(cache, args);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await cache.close();
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined || raw.trim().length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    throw new RepoMapperError(
      `--args 必须是 JSON object：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  throw new RepoMapperError('--args 必须是 JSON object。');
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw new RepoMapperError(`缺少必需参数：${key}`);
}

function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

function requiredStringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = stringArrayArg(args, key);
  if (value !== undefined && value.length > 0) {
    return value;
  }
  throw new RepoMapperError(`缺少必需参数：${key}`);
}

function enumArg<T extends string>(
  args: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = args[key];
  return typeof value === 'string' && values.includes(value as T) ? (value as T) : undefined;
}
