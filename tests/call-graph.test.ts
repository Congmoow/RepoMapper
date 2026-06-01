import { describe, expect, test } from 'vitest';

import { buildCallGraph, symbolKey } from '../src/core/call-graph.js';
import { buildImportGraph } from '../src/core/import-graph.js';
import { extractSymbols } from '../src/core/symbols.js';
import type { ScanResult } from '../src/types/index.js';

describe('buildCallGraph', () => {
  test('解析 TS/JS 导出函数对已导入符号的调用边', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/mcp-project',
      files: [
        'package.json',
        'src/components/Button.ts',
        'src/leaf.ts',
        'src/main.ts',
        'src/mid.ts',
        'src/top.ts',
        'src/utils.ts',
      ],
      directories: ['src', 'src/components'],
      keyFiles: [],
    };
    const graph = await buildImportGraph('tests/fixtures/mcp-project', scan);
    const symbols = await extractSymbols('tests/fixtures/mcp-project', scan);

    const callGraph = await buildCallGraph('tests/fixtures/mcp-project', scan, graph, symbols);

    expect(callGraph.calledBy.get(symbolKey({ file: 'src/utils.ts', symbol: 'helper' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: { file: 'src/main.ts', symbol: 'main' },
          to: { file: 'src/utils.ts', symbol: 'helper' },
          line: 5,
        }),
        expect.objectContaining({
          from: { file: 'src/components/Button.ts', symbol: 'Button' },
          to: { file: 'src/utils.ts', symbol: 'helper' },
          line: 3,
        }),
      ]),
    );
    expect(
      callGraph.calledBy.get(symbolKey({ file: 'src/components/Button.ts', symbol: 'Button' })),
    ).toEqual([
      {
        from: { file: 'src/main.ts', symbol: 'main' },
        to: { file: 'src/components/Button.ts', symbol: 'Button' },
        line: 5,
      },
    ]);
  });

  test('解析 aliased import 和对象方法调用边', async () => {
    const scan: ScanResult = {
      rootPath: 'tests/fixtures/callgraph-project',
      files: ['src/api.ts', 'src/consumer.ts'],
      directories: ['src'],
      keyFiles: [],
    };
    const graph = await buildImportGraph('tests/fixtures/callgraph-project', scan);
    const symbols = await extractSymbols('tests/fixtures/callgraph-project', scan);

    const callGraph = await buildCallGraph(
      'tests/fixtures/callgraph-project',
      scan,
      graph,
      symbols,
    );

    expect(callGraph.calls.get(symbolKey({ file: 'src/consumer.ts', symbol: 'load' }))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: { file: 'src/consumer.ts', symbol: 'load' },
          to: { file: 'src/api.ts', symbol: 'request' },
          line: 4,
        }),
        expect.objectContaining({
          from: { file: 'src/consumer.ts', symbol: 'load' },
          to: { file: 'src/api.ts', symbol: 'client' },
          line: 4,
        }),
      ]),
    );
  });
});
