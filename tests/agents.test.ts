import { describe, expect, test } from 'vitest';

import { renderAgents } from '../src/renderers/agents.js';
import type { ProjectContext } from '../src/types/index.js';

describe('renderAgents', () => {
  const context: ProjectContext = {
    projectName: 'demo',
    rootPath: '/demo',
    generatedAt: '2026-05-27T00:00:00.000Z',
    config: {
      maxDepth: 4,
      ignore: ['node_modules', 'dist', 'build'],
      includeTests: true,
      includeScripts: true,
      includeCi: true,
      includeDocker: true,
    },
    scan: {
      rootPath: '/demo',
      files: [
        'README.md',
        'AGENTS.md',
        'package.json',
        'src/cli.ts',
        'src/core/detector.ts',
        'src/mcp/server.ts',
        'src/schema/config.ts',
        'tests/main.test.ts',
      ],
      directories: ['src', 'src/core', 'src/mcp', 'src/schema', 'tests'],
      keyFiles: ['README.md', 'package.json'],
    },
    detection: {
      projectName: 'demo',
      detectedTechStack: ['TypeScript', 'Vitest'],
      detectedFeatures: [],
      entryPoints: [{ path: 'src/cli.ts', label: 'CLI entry' }],
      importantFiles: [{ path: 'package.json', reason: 'Project metadata' }],
      scripts: [],
    },
    directoryMap: [],
    suggestedReadingOrder: [],
  };

  test('输出包含 Purpose 且不再宣称自己是 CODEMAP 生成器', () => {
    const output = renderAgents(context);
    expect(output).toContain('## Purpose');
    expect(output).toContain('local MCP server');
    expect(output).not.toContain('CODEMAP');
  });

  test('输出包含 First Reading Order', () => {
    const output = renderAgents(context);
    expect(output).toContain('## First Reading Order');
    expect(output).toContain('README.md');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('package.json');
    expect(output).not.toContain('CODEMAP.md');
  });

  test('输出包含 Task Routing', () => {
    const output = renderAgents(context);
    expect(output).toContain('## Task Routing');
    expect(output).toContain('Avoid');
  });

  test('输出包含 High-Signal Files', () => {
    const output = renderAgents(context);
    expect(output).toContain('## High-Signal Files');
    expect(output).toContain('src/cli.ts');
  });

  test('输出包含 Rules for Agents', () => {
    const output = renderAgents(context);
    expect(output).toContain('## Rules for Agents');
    expect(output).toContain('RepoMapper MCP');
    expect(output).toContain('pnpm check');
    expect(output).toContain('fixtures and tests');
  });

  test('输出包含 Usually Avoid', () => {
    const output = renderAgents(context);
    expect(output).toContain('## Usually Avoid');
    expect(output).toContain('node_modules');
    expect(output).toContain('.turbo');
    expect(output).toContain('.vite');
  });

  test('输出包含 Out of Scope', () => {
    const output = renderAgents(context);
    const outOfScope = output.slice(output.indexOf('## Out of Scope'));

    expect(output).toContain('## Out of Scope');
    expect(outOfScope).toContain('Vector database');
    expect(outOfScope).toContain('AST-level semantic code graph');
    expect(outOfScope).not.toContain('MCP server');
  });

  test('没有 tests 时 Rules 不包含 fixtures 提示', () => {
    const noTests: ProjectContext = {
      ...context,
      scan: {
        ...context.scan,
        files: context.scan.files.filter((file) => !file.includes('test')),
        directories: context.scan.directories.filter((dir) => dir !== 'tests'),
      },
    };

    const output = renderAgents(noTests);
    expect(output).not.toContain('fixtures and tests');
  });
});
