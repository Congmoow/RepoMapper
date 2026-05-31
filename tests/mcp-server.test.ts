import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, test } from 'vitest';

let client: Client | null = null;
let transport: StdioClientTransport | null = null;

describe('MCP server', () => {
  afterEach(async () => {
    await client?.close();
    await transport?.close();
    client = null;
    transport = null;
  });

  test('stdio server 注册 10 个 RepoMapper tools 并可调用 context', async () => {
    client = new Client({ name: 'repomapper-test-client', version: '0.1.0' });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        './node_modules/tsx/dist/cli.mjs',
        'src/cli.ts',
        'serve',
        'tests/fixtures/mcp-project',
        '--mcp',
      ],
      cwd: process.cwd(),
      stderr: 'pipe',
    });

    await client.connect(transport);

    const instructions = client.getInstructions();
    expect(instructions).toContain('repomapper_context');
    expect(instructions).toContain('repomapper_impact');
    expect(instructions).toContain('repomapper_refresh');
    expect(instructions).toContain('不要 grep');
    expect(instructions).toContain('反向追溯');

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'repomapper_context',
      'repomapper_dependents',
      'repomapper_file_info',
      'repomapper_hubs',
      'repomapper_impact',
      'repomapper_imports',
      'repomapper_refresh',
      'repomapper_search',
      'repomapper_status',
      'repomapper_tree',
    ]);

    const context = await client.callTool({ name: 'repomapper_context', arguments: {} });

    expect(context.structuredContent).toMatchObject({
      projectName: 'mcp-project',
    });
  });
});
