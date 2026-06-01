import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

import {
  buildCallGraph,
  buildCallGraphFromEdges,
  extractCallEdgesForFile,
  type CallEdge,
  type CallGraph,
} from '../core/call-graph.js';
import { loadConfig } from '../core/config.js';
import { ContentIndex } from '../core/content-index.js';
import { detectRepository } from '../core/detector.js';
import {
  buildImportGraph,
  buildImportGraphFromEdges,
  extractImportEdgesForFile,
  type ImportEdge,
  type ImportGraph,
} from '../core/import-graph.js';
import { scanRepository } from '../core/scanner.js';
import { extractSymbols, extractSymbolsForFile, type FileSymbols } from '../core/symbols.js';
import type { DetectionResult, RepoMapperConfig, ScanResult } from '../types/index.js';
import { RepoMapperError } from '../utils/errors.js';
import { toPosixPath } from '../utils/path.js';

type DirtyEvent = 'add' | 'change' | 'unlink';

export interface PendingChange {
  path: string;
  event: DirtyEvent;
}

/** Stable, machine-readable hint for what an agent should do next. */
export type NextAction = 'none' | 'call_refresh';

export type CacheStatus = {
  indexedFiles: number;
  symbols: number;
  edges: number;
  callEdges: number;
  lastFullScan: string | null;
  lastUpdated: string | null;
  pendingChanges: PendingChange[];
  watcherActive: boolean;
  fresh: boolean;
  needsRefresh: boolean;
  refreshInProgress: boolean;
  /** Machine-readable enum; switch on this. */
  nextAction: NextAction;
  /** Human-readable explanation, or null when nextAction is 'none'. */
  nextActionMessage: string | null;
};

interface ProjectCacheOptions {
  watch?: boolean;
}

export class ProjectCache {
  private config: RepoMapperConfig | null = null;
  private scanResult: ScanResult | null = null;
  private detection: DetectionResult | null = null;
  private importGraph: ImportGraph | null = null;
  private callGraph: CallGraph | null = null;
  private symbols: FileSymbols[] | null = null;
  private readonly contentIndex: ContentIndex;
  private dirtyFiles = new Map<string, DirtyEvent>();
  private lastFullScan = 0;
  private lastUpdated = 0;
  private watcher: FSWatcher | null = null;
  private initPromise: Promise<void> | null = null;
  private refreshPromise: Promise<void> | null = null;

  readonly rootPath: string;

  constructor(
    rootPath: string,
    private readonly options: ProjectCacheOptions = {},
  ) {
    this.rootPath = path.resolve(rootPath);
    this.contentIndex = new ContentIndex(this.rootPath);
  }

  async ensureReady(): Promise<void> {
    if (this.isReady()) {
      return;
    }

    this.initPromise ??= this.fullScan();
    await this.initPromise;
    this.initPromise = null;

    if (this.options.watch !== false) {
      await this.startWatcher();
    }
  }

  private isReady(): boolean {
    return (
      this.config !== null &&
      this.scanResult !== null &&
      this.detection !== null &&
      this.importGraph !== null &&
      this.callGraph !== null &&
      this.symbols !== null
    );
  }

  markDirty(file: string, event: DirtyEvent): void {
    const normalized = this.normalizeRepoPath(file);
    if (normalized.length === 0) {
      return;
    }

    const existing = this.dirtyFiles.get(normalized);
    if (event === 'unlink') {
      this.dirtyFiles.set(normalized, event);
      return;
    }

    if (existing === 'add' || event === 'add') {
      this.dirtyFiles.set(normalized, 'add');
      return;
    }

    this.dirtyFiles.set(normalized, 'change');
  }

  async refresh(): Promise<void> {
    if (this.refreshPromise !== null) {
      await this.refreshPromise;
      return;
    }

    this.refreshPromise = this.refreshInternal();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshInternal(): Promise<void> {
    await this.ensureReady();

    if (this.dirtyFiles.size === 0) {
      return;
    }

    const pending = this.getPendingChanges();
    const needsFullScan = pending.some(
      (change) => change.event === 'add' || change.event === 'unlink',
    );

    if (needsFullScan) {
      this.dirtyFiles.clear();
      await this.fullScan();
      return;
    }

    const changedFiles = pending.map((change) => change.path);
    this.dirtyFiles.clear();
    await this.refreshChangedFiles(changedFiles);
    this.lastUpdated = Date.now();
  }

  getScan(): ScanResult {
    if (this.scanResult === null) {
      throw new RepoMapperError('Project cache is not ready. Call ensureReady() first.');
    }
    return this.scanResult;
  }

  getDetection(): DetectionResult {
    if (this.detection === null) {
      throw new RepoMapperError('Project cache is not ready. Call ensureReady() first.');
    }
    return this.detection;
  }

  getImportGraph(): ImportGraph {
    if (this.importGraph === null) {
      throw new RepoMapperError('Project cache is not ready. Call ensureReady() first.');
    }
    return this.importGraph;
  }

  getSymbols(): FileSymbols[] {
    if (this.symbols === null) {
      throw new RepoMapperError('Project cache is not ready. Call ensureReady() first.');
    }
    return this.symbols;
  }

  getCallGraph(): CallGraph {
    if (this.callGraph === null) {
      throw new RepoMapperError('Project cache is not ready. Call ensureReady() first.');
    }
    return this.callGraph;
  }

  getContentIndex(): ContentIndex {
    return this.contentIndex;
  }

  getPendingChanges(): PendingChange[] {
    return [...this.dirtyFiles.entries()]
      .map(([filePath, event]) => ({ path: filePath, event }))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  getStatus(): CacheStatus {
    const pendingChanges = this.getPendingChanges();
    const refreshInProgress = this.refreshPromise !== null;
    const needsRefresh = pendingChanges.length > 0;

    return {
      indexedFiles: this.scanResult?.files.length ?? 0,
      symbols:
        this.symbols?.reduce((count, file) => count + (file.symbols ?? file.exports).length, 0) ??
        0,
      edges: this.importGraph?.edges.length ?? 0,
      callEdges: this.callGraph?.edges.length ?? 0,
      lastFullScan: this.lastFullScan === 0 ? null : new Date(this.lastFullScan).toISOString(),
      lastUpdated: this.lastUpdated === 0 ? null : new Date(this.lastUpdated).toISOString(),
      pendingChanges,
      watcherActive: this.watcher !== null,
      fresh: !needsRefresh && !refreshInProgress,
      needsRefresh,
      refreshInProgress,
      nextAction: needsRefresh ? 'call_refresh' : 'none',
      nextActionMessage: needsRefresh
        ? 'Index has pending changes; call repomapper_refresh before trusting results. 索引存在待处理变更，调用 repomapper_refresh 后再信任结果。'
        : null,
    };
  }

  async close(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }

  private async fullScan(): Promise<void> {
    const config = await loadConfig(this.rootPath);
    const scanResult = await scanRepository(this.rootPath, config);
    const detection = await detectRepository(this.rootPath, scanResult);
    const importGraph = await buildImportGraph(this.rootPath, scanResult);
    const symbols = await extractSymbols(this.rootPath, scanResult);
    const callGraph = await buildCallGraph(this.rootPath, scanResult, importGraph, symbols);
    const scannedAt = Date.now();

    this.config = config;
    this.scanResult = scanResult;
    this.detection = detection;
    this.importGraph = importGraph;
    this.symbols = symbols;
    this.callGraph = callGraph;
    this.lastFullScan = scannedAt;
    this.lastUpdated = scannedAt;
    // File set may have changed; drop all cached file contents so grep re-reads.
    this.contentIndex.clear();
  }

  private async refreshChangedFiles(files: string[]): Promise<void> {
    const scan = this.getScan();
    const currentEdges = this.getImportGraph().edges.filter((edge) => !files.includes(edge.from));
    const nextEdges: ImportEdge[] = [...currentEdges];
    const currentCallEdges = this.getCallGraph().edges.filter(
      (edge) => !files.includes(edge.from.file),
    );
    const nextCallEdges: CallEdge[] = [...currentCallEdges];

    for (const file of files) {
      if (!scan.files.includes(file)) {
        continue;
      }

      nextEdges.push(...(await extractImportEdgesForFile(this.rootPath, file, scan)));
      await this.replaceSymbolsForFile(file);
      // Content changed; drop cached lines so next grep re-reads this file.
      this.contentIndex.invalidate(file);
    }

    this.importGraph = buildImportGraphFromEdges(nextEdges);
    const symbolByFile = new Map(this.getSymbols().map((entry) => [entry.file, entry.exports]));

    for (const file of files) {
      if (!scan.files.includes(file)) {
        continue;
      }

      nextCallEdges.push(
        ...(await extractCallEdgesForFile(
          this.rootPath,
          file,
          this.getImportGraph(),
          symbolByFile,
        )),
      );
    }

    this.callGraph = buildCallGraphFromEdges(nextCallEdges);
  }

  private async replaceSymbolsForFile(file: string): Promise<void> {
    const nextSymbols = this.getSymbols().filter((entry) => entry.file !== file);
    const updated = await extractSymbolsForFile(this.rootPath, file);
    if (updated !== undefined) {
      nextSymbols.push(updated);
    }
    this.symbols = nextSymbols.sort((left, right) => left.file.localeCompare(right.file));
  }

  private async startWatcher(): Promise<void> {
    if (this.watcher !== null) {
      return;
    }

    const ignored = this.config?.ignore.map((entry) => path.join(this.rootPath, entry)) ?? [];
    this.watcher = chokidar.watch(this.rootPath, {
      ignored,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });

    this.watcher.on('all', (event, absolutePath) => {
      if (event !== 'add' && event !== 'change' && event !== 'unlink') {
        return;
      }

      this.markDirty(path.relative(this.rootPath, absolutePath), event);
    });

    await new Promise<void>((resolve) => {
      this.watcher?.on('ready', resolve);
    });
  }

  private normalizeRepoPath(file: string): string {
    const absolute = path.isAbsolute(file) ? file : path.join(this.rootPath, file);
    return toPosixPath(path.relative(this.rootPath, absolute));
  }
}
