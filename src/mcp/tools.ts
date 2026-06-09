import * as z from 'zod/v4';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ProjectCache } from './cache.js';
import { handleContext } from './handlers/context.js';
import { handleFileInfo, handleFileInfoBatch } from './handlers/file-info.js';
import { handleGrep } from './handlers/grep.js';
import { handleHubs } from './handlers/hubs.js';
import { handleImpact } from './handlers/impact.js';
import { handleDependents, handleImports } from './handlers/imports.js';
import { handlePathBetween } from './handlers/path-between.js';
import { handleReadFile } from './handlers/read-file.js';
import { handleRefresh } from './handlers/refresh.js';
import { handleSearch } from './handlers/search.js';
import { handleStatus } from './handlers/status.js';
import { handleTree } from './handlers/tree.js';

const fileInfoFieldSchema = z.enum([
  'exports',
  'symbols',
  'imports',
  'importedBy',
  'callsByExport',
]);
const treeFieldSchema = z.enum(['tree', 'entries']);

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
      description:
        'Return a bounded directory tree plus structured entries. 返回仓库或指定子目录的目录树和结构化条目。',
      inputSchema: {
        path: z.string().optional().describe('Optional subdirectory path; defaults to repo root. 可选子目录路径，默认仓库根目录。'),
        depth: z.number().int().positive().optional().describe('Max relative depth, default 3. 最大相对深度，默认 3。'),
        fields: z
          .array(treeFieldSchema)
          .optional()
          .describe('Optional return fields: tree and/or entries. 可选返回字段：tree 和/或 entries。'),
      },
    },
    async (args) => toolResult(await handleTree(cache, args)),
  );

  server.registerTool(
    'repomapper_search',
    {
      title: 'RepoMapper search / 结构搜索',
      description:
        'Search files, directories or exported symbols by picomatch glob or keyword. For symbol results, set contextLines to include definition snippets. For file CONTENT, use repomapper_grep. 按 glob 或关键词搜索文件、目录或符号；符号结果可用 contextLines 返回定义片段；搜代码内容请用 repomapper_grep。',
      inputSchema: {
        pattern: z.string().min(1).describe('Glob-like pattern or keyword. 类 glob 模式或关键词。'),
        kind: z
          .enum(['file', 'dir', 'symbol', 'all'])
          .optional()
          .describe('Target type, default file; all mixes files, dirs and symbols. 搜索目标类型，默认 file；all 混合返回。'),
        limit: z.number().int().positive().optional().describe('Max results, default 100. 最多返回结果数量，默认 100。'),
        offset: z.number().int().min(0).optional().describe('Skip first N results for paging, default 0. 分页时跳过前 N 条，默认 0。'),
        contextLines: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('For symbol matches, include up to 20 lines before and after the definition. 符号命中返回定义前后最多 20 行。'),
      },
    },
    async (args) => toolResult(await handleSearch(cache, args)),
  );

  server.registerTool(
    'repomapper_grep',
    {
      title: 'RepoMapper content search / 内容搜索',
      description:
        'Search file CONTENT by literal or regex; returns path + line + matching line, optionally with context lines. 在文件内容中搜索字面量或正则，返回 path+line+匹配行，可选返回上下文行。',
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
        offset: z.number().int().min(0).optional().describe('Skip first N matches for paging, default 0. 分页时跳过前 N 个匹配，默认 0。'),
        contextLines: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Include up to 20 lines before and after each match. 返回每个匹配项前后最多 20 行上下文。'),
      },
    },
    async (args) => toolResult(await handleGrep(cache, args)),
  );

  server.registerTool(
    'repomapper_read_file',
    {
      title: 'RepoMapper read indexed text file / 读取已索引文本文件',
      description:
        'Read an indexed repo-relative text file, optionally by line range. Does not read arbitrary absolute paths. 读取已索引的仓库相对文本文件，可指定行范围；不会读取任意绝对路径。',
      inputSchema: {
        path: z.string().min(1).describe('Repo-relative file path. 仓库相对文件路径。'),
        startLine: z.number().int().positive().optional().describe('First 1-based line to return. 起始行号，从 1 开始。'),
        endLine: z.number().int().positive().optional().describe('Last 1-based line to return. 结束行号，从 1 开始。'),
        maxBytes: z.number().int().positive().optional().describe('Maximum returned UTF-8 bytes. 最多返回的 UTF-8 字节数。'),
      },
    },
    async (args) => toolResult(await handleReadFile(cache, args)),
  );

  server.registerTool(
    'repomapper_file_info',
    {
      title: 'RepoMapper file detail / 文件详情',
      description:
        'Return file symbols and dependencies. By default omits bulky callsByExport; pass fields to select payload, or fields: [] for the legacy full result. callsByExport also includes best-effort importCallSites for imported usages. 返回文件符号和依赖关系；默认省略较大的 callsByExport；可用 fields 裁剪返回体积，或传 fields: [] 获取旧版全量结果；importCallSites 是 callsByExport 的子字段。',
      inputSchema: {
        path: z.string().min(1).describe('Repo-relative file path. 仓库相对文件路径。'),
        fields: z
          .array(fileInfoFieldSchema)
          .optional()
          .describe('Optional fields to return; omit for lightweight defaults, [] for all fields. 可选返回字段；不传为轻量默认，[] 为全部字段。'),
      },
    },
    async (args) => toolResult(await handleFileInfo(cache, args)),
  );

  server.registerTool(
    'repomapper_file_info_batch',
    {
      title: 'RepoMapper batch file details / 批量文件详情',
      description:
        'Return file info for multiple repo-relative paths with one refresh, optionally field-selected. Omit fields for lightweight defaults, [] for all fields. 一次刷新后批量返回多个文件详情；不传 fields 为轻量默认，[] 为全部字段。',
      inputSchema: {
        paths: z.array(z.string().min(1)).min(1).describe('Repo-relative file paths. 仓库相对文件路径列表。'),
        fields: z
          .array(fileInfoFieldSchema)
          .optional()
          .describe('Optional fields to return for each file; omit for lightweight defaults, [] for all fields. 每个文件可选返回字段；不传为轻量默认，[] 为全部字段。'),
      },
    },
    async (args) => toolResult(await handleFileInfoBatch(cache, args)),
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
        includePaths: z
          .boolean()
          .optional()
          .describe('Include one shortest reverse-dependency path for each impacted file. 为每个受影响文件返回一条最短反向依赖路径。'),
      },
    },
    async (args) => toolResult(await handleImpact(cache, args)),
  );

  server.registerTool(
    'repomapper_path_between',
    {
      title: 'RepoMapper dependency chain / 依赖链',
      description:
        'Find how a change in `from` propagates to `to`, returning shortest reverse-dependency chains (along importedBy). If you want forward imports, use repomapper_imports. 查找 from 的变更如何传导到 to，返回最短反向依赖传播链；若要看正向 import，请用 repomapper_imports。',
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
        'Explicitly apply pending watcher changes and return refreshed status. Query tools already refresh automatically; use this when you want to wait before another step. 显式刷新 watcher 待处理变更并返回状态；普通查询工具会自动刷新，此工具用于主动等待。',
    },
    async () => toolResult(await handleRefresh(cache)),
  );

  server.registerTool(
    'repomapper_status',
    {
      title: 'RepoMapper index status / 索引状态',
      description:
        'Return index counts, timestamps and pending changes. Query tools auto-refresh; nextAction only signals whether an explicit wait via repomapper_refresh is useful. 返回索引规模、时间戳和待处理变更；普通查询自动刷新，nextAction 仅提示是否值得显式等待 refresh。',
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
