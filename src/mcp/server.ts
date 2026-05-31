import path from 'node:path';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { ProjectCache } from './cache.js';
import { REPOMAPPER_MCP_INSTRUCTIONS } from './instructions.js';
import { registerRepoMapperTools } from './tools.js';
import { debugLog } from '../utils/logger.js';

export interface ServeOptions {
  mcp?: boolean;
}

export async function runMcpServer(rootPath = '.', options: ServeOptions = {}): Promise<void> {
  if (options.mcp === false) {
    throw new Error('当前仅支持 MCP stdio 模式。');
  }

  const resolvedRoot = path.resolve(rootPath);
  const cache = new ProjectCache(resolvedRoot);
  const server = new McpServer(
    {
      name: 'repomapper',
      version: '0.1.0',
    },
    {
      instructions: REPOMAPPER_MCP_INSTRUCTIONS,
    },
  );

  registerRepoMapperTools(server, cache);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  void cache.ensureReady().catch(() => {
    // 预热失败不阻断启动；首次 tool 调用会通过 ProjectCache 的 initPromise 重试。
  });

  const shutdown = async (): Promise<void> => {
    debugLog(`关闭 RepoMapper MCP server: ${resolvedRoot}`);
    await cache.close();
    await server.close();
  };

  process.on('SIGINT', () => {
    shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });

  process.on('SIGTERM', () => {
    shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
