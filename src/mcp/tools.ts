import * as z from 'zod/v4';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ProjectCache } from './cache.js';
import { handleContext } from './handlers/context.js';
import { handleFileInfo } from './handlers/file-info.js';
import { handleGrep } from './handlers/grep.js';
import { handleHubs } from './handlers/hubs.js';
import { handleImpact } from './handlers/impact.js';
import { handleDependents, handleImports } from './handlers/imports.js';
import { handlePathBetween } from './handlers/path-between.js';
import { handleRefresh } from './handlers/refresh.js';
import { handleSearch } from './handlers/search.js';
import { handleStatus } from './handlers/status.js';
import { handleTree } from './handlers/tree.js';

export function registerRepoMapperTools(server: McpServer, cache: ProjectCache): void {
  server.registerTool(
    'repomapper_context',
    {
      title: 'RepoMapper project overview / 项目概览',
      description:
        'Return project name, tech stack, features, entry points, important files and scripts. 返回项目名称、技术栈、功能、入口文件、重要文件和脚本。',
    },
    async () => toolResult(await handleContext(cache)),
  );

  server.registerTool(
    'repomapper_tree',
    {
      title: 'RepoMapper directory tree / 目录树',
      description: 'Return the directory tree of the repo or a subdirectory. 返回仓库或指定子目录的目录树。',
      inputSchema: {
        path: z.string().optional().describe('Optional subdirectory path; defaults to repo root. 可选子目录路径，默认仓库根目录。'),
        depth: z.number().int().positive().optional().describe('Max relative depth, default 3. 最大相对深度，默认 3。'),
      },
    },
    async (args) => toolResult(await handleTree(cache, args)),
  );

  server.registerTool(
    'repomapper_search',
    {
      title: 'RepoMapper search / 结构搜索',
      description:
        'Search files, directories or exported symbols by picomatch glob or keyword. For searching file CONTENT, use repomapper_grep instead. 按 glob 或关键词搜索文件、目录或符号；搜代码内容请用 repomapper_grep。',
      inputSchema: {
        pattern: z.string().min(1).describe('Glob-like pattern or keyword. 类 glob 模式或关键词。'),
        kind: z
          .enum(['file', 'dir', 'symbol', 'all'])
          .optional()
          .describe('Target type, default file; all mixes files, dirs and symbols. 搜索目标类型，默认 file；all 混合返回。'),
        limit: z.number().int().positive().optional().describe('Max results, default 100. 最多返回结果数量，默认 100。'),
      },
    },
    async (args) => toolResult(await handleSearch(cache, args)),
  );

  server.registerTool(
    'repomapper_grep',
    {
      title: 'RepoMapper content search / 内容搜索',
      description:
        'Search file CONTENT by literal or regex; returns path + line + matching line. Use for strings, constants, env vars, routes, TODOs — anything not locatable by filename or symbol. 在文件内容中搜索字面量或正则，返回 path+line+匹配行。',
      inputSchema: {
        pattern: z.string().min(1).describe('Literal substring or regular expression to search. 要搜索的字面量子串或正则。'),
        regex: z.boolean().optional().describe('Treat pattern as regex; default literal substring. 为 true 时按正则匹配，默认字面量。'),
        ignoreCase: z
          .boolean()
          .optional()
          .describe('Case-insensitive; default true for literal, false for regex. 大小写不敏感；字面量默认 true，正则默认 false。'),
        glob: z
          .string()
          .optional()
          .describe('Optional picomatch glob to restrict files, e.g. src/**/*.ts. 可选 glob，仅在匹配文件中搜索。'),
        limit: z.number().int().positive().optional().describe('Max matches, default 100. 最多返回匹配数，默认 100。'),
      },
    },
    async (args) => toolResult(await handleGrep(cache, args)),
  );

  server.registerTool(
    'repomapper_file_info',
    {
      title: 'RepoMapper file detail / 文件详情',
      description:
        'Return a file\'s exported symbols, internal symbols (with line numbers), file-level dependencies/dependents, and calls/calledBy for TS/JS exported functions with call-site line numbers. 返回文件的导出/内部符号（含行号）、文件级依赖/反向依赖，以及 TS/JS 导出函数 calls/calledBy（含调用点行号）。',
      inputSchema: {
        path: z.string().min(1).describe('Repo-relative file path. 仓库相对文件路径。'),
      },
    },
    async (args) => toolResult(await handleFileInfo(cache, args)),
  );

  server.registerTool(
    'repomapper_imports',
    {
      title: 'RepoMapper dependencies / 正向依赖',
      description: 'Return files imported by a file (fan-out). 返回某个文件 import 的文件（fan-out）。',
      inputSchema: {
        path: z.string().min(1).describe('Repo-relative file path. 仓库相对文件路径。'),
        limit: z.number().int().positive().optional().describe('Max results; default no truncation. 最多返回数量，默认不截断。'),
        offset: z.number().int().positive().optional().describe('Skip first N for paging, default 0. 跳过前 N 条，默认 0。'),
      },
    },
    async (args) => toolResult(await handleImports(cache, args)),
  );

  server.registerTool(
    'repomapper_dependents',
    {
      title: 'RepoMapper dependents / 反向依赖',
      description: 'Return files that import a file (fan-in). 返回 import 某个文件的文件（fan-in）。',
      inputSchema: {
        path: z.string().min(1).describe('Repo-relative file path. 仓库相对文件路径。'),
        limit: z.number().int().positive().optional().describe('Max results; default no truncation. 最多返回数量，默认不截断。'),
        offset: z.number().int().positive().optional().describe('Skip first N for paging, default 0. 跳过前 N 条，默认 0。'),
      },
    },
    async (args) => toolResult(await handleDependents(cache, args)),
  );

  server.registerTool(
    'repomapper_hubs',
    {
      title: 'RepoMapper core modules / 核心模块',
      description: 'Return the most depended-on modules. 返回被最多文件依赖的模块。',
      inputSchema: {
        limit: z.number().int().positive().optional().describe('Max hubs, default 10. 最多返回的核心模块数量，默认 10。'),
      },
    },
    async (args) => toolResult(await handleHubs(cache, args)),
  );

  server.registerTool(
    'repomapper_impact',
    {
      title: 'RepoMapper impact analysis / 影响分析',
      description:
        'Return direct and transitive dependents of changed files. Reports totalImpacted/levelTotals; use limit/minDepth for large results. 返回变更文件的直接和传递反向依赖，带 totalImpacted/levelTotals。',
      inputSchema: {
        paths: z.array(z.string().min(1)).min(1).describe('Repo-relative changed file paths. 仓库相对变更文件路径。'),
        depth: z.number().int().positive().optional().describe('Traversal depth, default 2. 反向依赖遍历深度，默认 2。'),
        minDepth: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Min returned depth, default 1; hides the direct-impact layer. 最小返回深度，默认 1。'),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Max items in flat impacted list; default no truncation, levels/levelTotals unaffected. 扁平 impacted 列表上限，默认不截断。'),
      },
    },
    async (args) => toolResult(await handleImpact(cache, args)),
  );

  server.registerTool(
    'repomapper_path_between',
    {
      title: 'RepoMapper dependency chain / 依赖链',
      description:
        'Find how a change in `from` propagates to `to`, returning shortest dependency chains (along importedBy). Answers "why does changing A affect B, and through what path". 查找 from 的变更如何传导到 to，返回最短依赖链。',
      inputSchema: {
        from: z.string().min(1).describe('Repo-relative path of the change origin. 变更起点的仓库相对文件路径。'),
        to: z.string().min(1).describe('Repo-relative path of the affected target. 受影响终点的仓库相对文件路径。'),
        maxPaths: z.number().int().positive().optional().describe('Max chains to return, default 5. 最多返回的链路数量，默认 5。'),
        maxDepth: z.number().int().positive().optional().describe('Max hops per chain, default 12. 链路最大跳数，默认 12。'),
      },
    },
    async (args) => toolResult(await handlePathBetween(cache, args)),
  );

  server.registerTool(
    'repomapper_refresh',
    {
      title: 'RepoMapper refresh index / 刷新索引',
      description:
        'Explicitly apply pending watcher changes and return the refreshed index status. 显式刷新 watcher 待处理变更，并返回刷新后的索引状态。',
    },
    async () => toolResult(await handleRefresh(cache)),
  );

  server.registerTool(
    'repomapper_status',
    {
      title: 'RepoMapper index status / 索引状态',
      description:
        'Return indexed file/symbol/edge counts, timestamps, pending changes and a machine-readable nextAction (none | call_refresh). 返回索引规模、时间戳、待处理变更，以及可程序化判断的 nextAction（none | call_refresh）。',
    },
    async () => toolResult(await handleStatus(cache)),
  );
}

function toolResult<T extends object>(
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
