import { describe, expect, test } from 'vitest';

import { extractSymbolsFromContent } from '../src/core/symbols.js';

describe('extractSymbolsFromContent', () => {
  test('提取导出符号、内部函数和类方法位置', () => {
    const symbols = extractSymbolsFromContent(
      [
        'export class ProjectCache {',
        '  private async fullScan(): Promise<void> {',
        '    await Promise.resolve();',
        '  }',
        '',
        '  refresh(): void {}',
        '}',
        '',
        'function localHelper() {',
        '  return true;',
        '}',
        '',
        'export const publicValue = 1;',
      ].join('\n'),
    );

    expect(symbols.exports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'ProjectCache',
          kind: 'class',
          line: 1,
          exported: true,
        }),
        expect.objectContaining({
          name: 'publicValue',
          kind: 'const',
          line: 13,
          exported: true,
        }),
      ]),
    );
    expect(symbols.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'fullScan',
          kind: 'method',
          container: 'ProjectCache',
          line: 2,
          exported: false,
        }),
        expect.objectContaining({
          name: 'refresh',
          kind: 'method',
          container: 'ProjectCache',
          line: 6,
          exported: false,
        }),
        expect.objectContaining({
          name: 'localHelper',
          kind: 'function',
          line: 9,
          exported: false,
        }),
      ]),
    );
  });
});
