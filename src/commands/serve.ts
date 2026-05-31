import path from 'node:path';

import { runMcpServer } from '../mcp/server.js';
import { RepoMapperError } from '../utils/errors.js';

interface ServeOptions {
  mcp?: boolean;
}

export async function runServe(rootPath = '.', options: ServeOptions = {}): Promise<void> {
  if (options.mcp === false) {
    throw new RepoMapperError('当前仅支持 --mcp stdio 模式。');
  }

  await runMcpServer(path.resolve(rootPath), { mcp: options.mcp ?? true });
}
