import { describe, expect, test, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const config = {
    maxDepth: 4,
    ignore: [],
    includeTests: true,
    includeScripts: true,
    includeCi: true,
    includeDocker: true,
  };
  const oldScan = {
    rootPath: '/repo',
    files: ['src/old.ts'],
    directories: ['src'],
    keyFiles: [],
  };
  const newScan = {
    rootPath: '/repo',
    files: ['src/old.ts', 'src/new.ts'],
    directories: ['src'],
    keyFiles: [],
  };
  const oldDetection = {
    projectName: 'old-project',
    detectedTechStack: ['TypeScript'],
    detectedFeatures: [],
    entryPoints: [],
    importantFiles: [],
    scripts: [],
  };
  const newDetection = {
    projectName: 'new-project',
    detectedTechStack: ['TypeScript'],
    detectedFeatures: [],
    entryPoints: [],
    importantFiles: [],
    scripts: [],
  };
  const oldImportGraph = {
    edges: [{ from: 'src/old.ts', to: 'src/base.ts', specifiers: ['base'] }],
    hubs: ['src/base.ts'],
    entryLike: ['src/old.ts'],
    dependsOn: new Map([['src/old.ts', ['src/base.ts']]]),
    importedBy: new Map([['src/base.ts', ['src/old.ts']]]),
  };
  const newImportGraph = {
    edges: [
      { from: 'src/old.ts', to: 'src/base.ts', specifiers: ['base'] },
      { from: 'src/new.ts', to: 'src/base.ts', specifiers: ['base'] },
    ],
    hubs: ['src/base.ts'],
    entryLike: ['src/old.ts', 'src/new.ts'],
    dependsOn: new Map([
      ['src/old.ts', ['src/base.ts']],
      ['src/new.ts', ['src/base.ts']],
    ]),
    importedBy: new Map([['src/base.ts', ['src/old.ts', 'src/new.ts']]]),
  };
  const oldSymbols = [
    { file: 'src/old.ts', exports: [{ name: 'oldValue', kind: 'const', isDefault: false }] },
  ];
  const newSymbols = [
    { file: 'src/old.ts', exports: [{ name: 'oldValue', kind: 'const', isDefault: false }] },
    { file: 'src/new.ts', exports: [{ name: 'newValue', kind: 'const', isDefault: false }] },
  ];
  const oldCallGraph = { edges: [], calls: new Map(), calledBy: new Map() };
  const newCallGraph = {
    edges: [
      {
        from: { file: 'src/new.ts', symbol: 'newValue' },
        to: { file: 'src/old.ts', symbol: 'oldValue' },
      },
    ],
    calls: new Map(),
    calledBy: new Map(),
  };

  function createDeferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  let scanCalls = 0;
  let secondDetectionStarted = createDeferred();
  let releaseSecondDetection = createDeferred();

  return {
    config,
    oldScan,
    newScan,
    oldDetection,
    newDetection,
    oldImportGraph,
    newImportGraph,
    oldSymbols,
    newSymbols,
    oldCallGraph,
    newCallGraph,
    nextScanCall() {
      scanCalls += 1;
      return scanCalls;
    },
    markSecondDetectionStarted() {
      secondDetectionStarted.resolve();
    },
    waitForSecondDetection() {
      return secondDetectionStarted.promise;
    },
    releaseDetection() {
      releaseSecondDetection.resolve();
    },
    waitForReleaseDetection() {
      return releaseSecondDetection.promise;
    },
    reset() {
      scanCalls = 0;
      secondDetectionStarted = createDeferred();
      releaseSecondDetection = createDeferred();
    },
  };
});

vi.mock('../src/core/config.js', () => ({
  loadConfig: vi.fn(async () => mockState.config),
}));

vi.mock('../src/core/scanner.js', () => ({
  scanRepository: vi.fn(async () =>
    mockState.nextScanCall() === 1 ? mockState.oldScan : mockState.newScan,
  ),
}));

vi.mock('../src/core/detector.js', () => ({
  detectRepository: vi.fn(async (_rootPath: string, scan: unknown) => {
    if (scan === mockState.newScan) {
      mockState.markSecondDetectionStarted();
      await mockState.waitForReleaseDetection();
      return mockState.newDetection;
    }

    return mockState.oldDetection;
  }),
}));

vi.mock('../src/core/import-graph.js', () => ({
  buildImportGraph: vi.fn(async (_rootPath: string, scan: unknown) =>
    scan === mockState.newScan ? mockState.newImportGraph : mockState.oldImportGraph,
  ),
  buildImportGraphFromEdges: vi.fn(),
  extractImportEdgesForFile: vi.fn(),
}));

vi.mock('../src/core/symbols.js', () => ({
  extractSymbols: vi.fn(async (_rootPath: string, scan: unknown) =>
    scan === mockState.newScan ? mockState.newSymbols : mockState.oldSymbols,
  ),
  extractSymbolsForFile: vi.fn(),
}));

vi.mock('../src/core/call-graph.js', () => ({
  buildCallGraph: vi.fn(async (_rootPath: string, scan: unknown) =>
    scan === mockState.newScan ? mockState.newCallGraph : mockState.oldCallGraph,
  ),
  buildCallGraphFromEdges: vi.fn(),
  extractCallEdgesForFile: vi.fn(),
}));

describe('ProjectCache full scan 原子性', () => {
  test('fullScan 进行中时 status 不会读到半更新索引', async () => {
    mockState.reset();
    const { ProjectCache } = await import('../src/mcp/cache.js');
    const cache = new ProjectCache('/repo', { watch: false });

    await cache.ensureReady();
    cache.markDirty('src/new.ts', 'add');
    const refresh = cache.refresh();
    await mockState.waitForSecondDetection();

    expect(cache.getStatus()).toMatchObject({
      indexedFiles: 1,
      edges: 1,
      callEdges: 0,
    });

    mockState.releaseDetection();
    await refresh;

    expect(cache.getStatus()).toMatchObject({
      indexedFiles: 2,
      edges: 2,
      callEdges: 1,
    });
  });
});
