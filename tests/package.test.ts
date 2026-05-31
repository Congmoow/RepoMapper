import packageJson from '../package.json' with { type: 'json' };

import { describe, expect, test } from 'vitest';

describe('npm 发布配置', () => {
  test('发布定位只强调本地 MCP server', () => {
    expect(packageJson.description).toBe(
      'Local MCP server that gives AI coding agents on-demand, always-fresh structural queries over your codebase.',
    );
    expect(packageJson.keywords).toEqual(
      expect.arrayContaining([
        'mcp',
        'model-context-protocol',
        'code-intelligence',
        'claude-code',
        'cursor',
        'codex',
      ]),
    );
    expect(packageJson.keywords).not.toContain('codemap');
  });

  test('只发布运行时产物并在直接发布前执行完整检查', () => {
    expect(packageJson.files).toEqual(['dist']);
    expect(packageJson.scripts.prepublishOnly).toBe('pnpm check');
  });

  test('包含 npm 页面需要的仓库元数据', () => {
    expect(packageJson.author).toBe('WangZhongWu');
    expect(packageJson.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/Congmoow/RepoMapper.git',
    });
    expect(packageJson.homepage).toBe('https://github.com/Congmoow/RepoMapper#readme');
    expect(packageJson.bugs).toEqual({
      url: 'https://github.com/Congmoow/RepoMapper/issues',
    });
  });
});
