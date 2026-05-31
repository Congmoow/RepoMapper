import { describe, expect, test } from 'vitest';

import { detectRepository } from '../src/core/detector.js';
import { scanRepository } from '../src/core/scanner.js';
import { DEFAULT_CONFIG } from '../src/schema/config.js';

describe('detectRepository', () => {
  test('识别 React、Vite 和 TypeScript', async () => {
    const scan = await scanRepository('tests/fixtures/react-vite', DEFAULT_CONFIG);
    const result = await detectRepository('tests/fixtures/react-vite', scan);

    expect(result.detectedTechStack).toEqual(
      expect.arrayContaining(['TypeScript', 'React', 'Vite']),
    );
  });

  test('识别 Express 和 Prisma', async () => {
    const scan = await scanRepository('tests/fixtures/express-prisma', DEFAULT_CONFIG);
    const result = await detectRepository('tests/fixtures/express-prisma', scan);

    expect(result.detectedTechStack).toEqual(expect.arrayContaining(['Express', 'Prisma']));
  });

  test('识别 monorepo 子包中的前后端技术栈', async () => {
    const scan = await scanRepository('tests/fixtures/monorepo-fullstack', DEFAULT_CONFIG);
    const result = await detectRepository('tests/fixtures/monorepo-fullstack', scan);

    expect(result.detectedTechStack).toEqual(
      expect.arrayContaining(['Monorepo', 'TypeScript', 'React', 'Vite', 'Express', 'Prisma']),
    );
  });

  test('不会把非 workspace 测试夹具中的 Prisma schema 当成项目技术栈', async () => {
    const scan = await scanRepository('tests/fixtures/root-with-nested-fixture', DEFAULT_CONFIG);
    const result = await detectRepository('tests/fixtures/root-with-nested-fixture', scan);

    expect(result.detectedTechStack).not.toContain('Prisma');
    expect(result.detectedTechStack).not.toContain('PostgreSQL');
  });

  test('monorepo 检测到 workspace 子包及内部依赖关系', async () => {
    const scan = await scanRepository('tests/fixtures/monorepo-fullstack', DEFAULT_CONFIG);
    const result = await detectRepository('tests/fixtures/monorepo-fullstack', scan);

    expect(result.workspacePackages).toBeDefined();
    expect(result.workspacePackages!.length).toBeGreaterThanOrEqual(3);

    const names = result.workspacePackages!.map((pkg) => pkg.name);
    expect(names).toContain('frontend');
    expect(names).toContain('backend');
    expect(names).toContain('@fixture/shared');
  });
});
