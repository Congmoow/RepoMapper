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

  test('stdio server 注册 12 个 RepoMapper tools 并可调用 context', async () => {
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
    expect(instructions).toContain('repomapper_grep');
    expect(instructions).toContain('repomapper_path_between');
    expect(instructions).toContain('repomapper_refresh');
    expect(instructions).toContain('在代码内容里找某个字符串');
    expect(instructions).toContain('status.nextAction === "call_refresh"');

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'repomapper_context',
      'repomapper_dependents',
      'repomapper_file_info',
      'repomapper_grep',
      'repomapper_hubs',
      'repomapper_impact',
      'repomapper_imports',
      'repomapper_path_between',
      'repomapper_refresh',
      'repomapper_search',
      'repomapper_status',
      'repomapper_tree',
    ]);

    const context = await client.callTool({ name: 'repomapper_context', arguments: {} });

    expect(context.structuredContent).toMatchObject({
      projectName: 'mcp-project',
    });

    const grep = await client.callTool({
      name: 'repomapper_grep',
      arguments: { pattern: 'helper', glob: 'src/**/*.ts', limit: 1 },
    });
    expect(grep.structuredContent).toMatchObject({
      pattern: 'helper',
      count: 1,
      truncated: true,
    });

    const pathBetween = await client.callTool({
      name: 'repomapper_path_between',
      arguments: { from: 'src/leaf.ts', to: 'src/top.ts' },
    });
    expect(pathBetween.structuredContent).toMatchObject({
      connected: true,
      shortestLength: 2,
      paths: [['src/leaf.ts', 'src/mid.ts', 'src/top.ts']],
    });

    const impact = await client.callTool({
      name: 'repomapper_impact',
      arguments: { paths: ['src/utils.ts'], depth: 2, limit: 1 },
    });
    expect(impact.structuredContent).toMatchObject({
      totalImpacted: 2,
      truncated: true,
    });

    const fileInfo = await client.callTool({
      name: 'repomapper_file_info',
      arguments: { path: 'src/utils.ts' },
    });
    const fileInfoContent = fileInfo.structuredContent as {
      callsByExport?: Record<string, { calledBy?: Array<{ file: string; line?: number }> }>;
    };
    expect(fileInfoContent.callsByExport?.helper?.calledBy).toEqual(
      expect.arrayContaining([expect.objectContaining({ file: 'src/main.ts', line: 5 })]),
    );

    const status = await client.callTool({ name: 'repomapper_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({
      nextAction: 'none',
      nextActionMessage: null,
    });
  });
});
