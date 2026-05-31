import { describe, expect, test } from 'vitest';

import { DEFAULT_CONFIG } from '../src/schema/config.js';
import { scanRepository } from '../src/core/scanner.js';

describe('scanRepository', () => {
  test('扫描 React Vite fixture 的关键文件', async () => {
    const result = await scanRepository('tests/fixtures/react-vite', DEFAULT_CONFIG);

    expect(result.files).toContain('package.json');
    expect(result.files).toContain('src/main.tsx');
    expect(result.files).toContain('vite.config.ts');
    expect(result.keyFiles).toEqual(expect.arrayContaining(['package.json', 'vite.config.ts']));
  });
});
