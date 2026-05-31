import { describe, expect, test } from 'vitest';

import { DEFAULT_CONFIG, configSchema } from '../src/schema/config.js';

describe('configSchema', () => {
  test('默认配置不再包含静态 CODEMAP 输出选项', () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty('output');
    expect(DEFAULT_CONFIG).not.toHaveProperty('mode');
    expect(DEFAULT_CONFIG).not.toHaveProperty('tokenBudget');
  });

  test('旧的静态输出配置会被忽略', () => {
    const parsed = configSchema.parse({
      output: 'CODEMAP.md',
      mode: 'detailed',
      tokenBudget: 1000,
    });

    expect(parsed).not.toHaveProperty('output');
    expect(parsed).not.toHaveProperty('mode');
    expect(parsed).not.toHaveProperty('tokenBudget');
  });
});
