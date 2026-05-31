import * as z from 'zod/v4';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ProjectCache } from './cache.js';
import { handleContext } from './handlers/context.js';
import { handleFileInfo } from './handlers/file-info.js';
import { handleHubs } from './handlers/hubs.js';
import { handleImpact } from './handlers/impact.js';
import { handleDependents, handleImports } from './handlers/imports.js';
import { handleRefresh } from './handlers/refresh.js';
import { handleSearch } from './handlers/search.js';
import { handleStatus } from './handlers/status.js';
import { handleTree } from './handlers/tree.js';

export function registerRepoMapperTools(server: McpServer, cache: ProjectCache): void {
  server.registerTool(
    'repomapper_context',
    {
      title: 'RepoMapper 项目概览',
      description: '返回项目名称、技术栈、功能、入口文件、重要文件和脚本。',
    },
    async () => toolResult(await handleContext(cache)),
  );

  server.registerTool(
    'repomapper_tree',
    {
      title: 'RepoMapper 目录树',
      description: '返回仓库或指定子目录的目录树。',
      inputSchema: {
        path: z.string().optional().describe('可选子目录路径，默认仓库根目录。'),
        depth: z.number().int().positive().optional().describe('最大相对深度，默认 3。'),
      },
    },
    async (args) => toolResult(await handleTree(cache, args)),
  );

  server.registerTool(
    'repomapper_search',
    {
      title: 'RepoMapper 搜索',
      description: '按 picomatch glob 或关键词搜索文件、目录或符号，可用 limit 控制返回数量。',
      inputSchema: {
        pattern: z.string().min(1).describe('类 glob 模式或关键词。'),
        kind: z
          .enum(['file', 'dir', 'symbol', 'all'])
          .optional()
          .describe('搜索目标类型，默认 file；all 会混合返回文件、目录和符号。'),
        limit: z.number().int().positive().optional().describe('最多返回结果数量，默认 100。'),
      },
    },
    async (args) => toolResult(await handleSearch(cache, args)),
  );

  server.registerTool(
    'repomapper_file_info',
    {
      title: 'RepoMapper 文件详情',
      description:
        '返回单个文件的导出符号、内部符号、文件级依赖/反向依赖，以及 TS/JS 导出函数 calls/calledBy。',
      inputSchema: {
        path: z.string().min(1).describe('仓库相对文件路径。'),
      },
    },
    async (args) => toolResult(await handleFileInfo(cache, args)),
  );

  server.registerTool(
    'repomapper_imports',
    {
      title: 'RepoMapper 依赖查询',
      description: '返回某个文件 import 的文件（fan-out）。',
      inputSchema: {
        path: z.string().min(1).describe('仓库相对文件路径。'),
      },
    },
    async (args) => toolResult(await handleImports(cache, args)),
  );

  server.registerTool(
    'repomapper_dependents',
    {
      title: 'RepoMapper 反向依赖',
      description: '返回 import 某个文件的文件（fan-in）。',
      inputSchema: {
        path: z.string().min(1).describe('仓库相对文件路径。'),
      },
    },
    async (args) => toolResult(await handleDependents(cache, args)),
  );

  server.registerTool(
    'repomapper_hubs',
    {
      title: 'RepoMapper 核心模块',
      description: '返回被最多文件依赖的模块。',
      inputSchema: {
        limit: z.number().int().positive().optional().describe('最多返回的核心模块数量，默认 10。'),
      },
    },
    async (args) => toolResult(await handleHubs(cache, args)),
  );

  server.registerTool(
    'repomapper_impact',
    {
      title: 'RepoMapper 影响分析',
      description: '返回变更文件的直接和传递反向依赖。',
      inputSchema: {
        paths: z.array(z.string().min(1)).min(1).describe('仓库相对变更文件路径。'),
        depth: z.number().int().positive().optional().describe('反向依赖遍历深度，默认 2。'),
        minDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('最小返回深度，默认 1；可用于隐藏直接影响层。'),
      },
    },
    async (args) => toolResult(await handleImpact(cache, args)),
  );

  server.registerTool(
    'repomapper_refresh',
    {
      title: 'RepoMapper 刷新索引',
      description: '显式刷新 watcher 待处理变更，并返回刷新后的索引状态。',
    },
    async () => toolResult(await handleRefresh(cache)),
  );

  server.registerTool(
    'repomapper_status',
    {
      title: 'RepoMapper 索引状态',
      description:
        '返回索引文件数、符号数、文件依赖边数、调用边数、时间戳、watcher 待处理变更和刷新建议。',
    },
    async () => toolResult(await handleStatus(cache)),
  );
}

function toolResult<T extends Record<string, unknown> | unknown[]>(
  structuredContent: T,
): {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent: T;
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}
