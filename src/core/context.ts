import path from 'node:path';

import type {
  DetectionResult,
  FileSymbolsSummary,
  ImportGraphSummary,
  ProjectContext,
  RepoMapperConfig,
  ScanResult,
} from '../types/index.js';
import { buildImportGraph } from './import-graph.js';
import { extractSymbols, summarizeSymbols } from './symbols.js';

export async function createProjectContext(
  rootPath: string,
  config: RepoMapperConfig,
  scan: ScanResult,
  detection: DetectionResult,
): Promise<ProjectContext> {
  const projectName = detection.projectName ?? path.basename(rootPath);

  const hasImportGraphFiles = scan.files.some(
    (file) => /\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.py') || file.endsWith('.go'),
  );
  const hasTsJs = scan.files.some((file) => /\.[cm]?[jt]sx?$/.test(file));
  let importGraph: ImportGraphSummary | undefined;
  let symbols: FileSymbolsSummary[] | undefined;

  if (hasImportGraphFiles) {
    const graph = await buildImportGraph(rootPath, scan);
    importGraph = {
      hubs: graph.hubs,
      entryLike: graph.entryLike,
      edgeCount: graph.edges.length,
    };
  }

  if (hasTsJs) {
    const allSymbols = await extractSymbols(rootPath, scan);
    const summarized = summarizeSymbols(allSymbols, 15);
    symbols = summarized.map((entry) => ({
      file: entry.file,
      exports: entry.exports.map((exported) => ({ name: exported.name, kind: exported.kind })),
    }));
  }

  return {
    projectName,
    rootPath,
    generatedAt: new Date().toISOString(),
    config,
    scan,
    detection,
    directoryMap: buildDirectoryMap(scan, config.maxDepth),
    suggestedReadingOrder: buildSuggestedReadingOrder(scan, detection),
    importGraph,
    symbols,
  };
}

function buildDirectoryMap(scan: ScanResult, maxDepth: number): string[] {
  const entries = [...scan.directories.map((entry) => `${entry}/`), ...scan.files];

  return entries
    .filter((entry) => entry.split('/').filter(Boolean).length <= maxDepth)
    .sort((left, right) => left.localeCompare(right));
}

function buildSuggestedReadingOrder(scan: ScanResult, detection: DetectionResult): string[] {
  const candidates = [
    'README.md',
    'package.json',
    'repomapper.config.json',
    ...detection.entryPoints.map((entry) => entry.path),
    ...detection.importantFiles.map((file) => file.path),
  ];
  const available = new Set(scan.files);
  const order = candidates.filter((candidate) => available.has(candidate));

  return [...new Set(order)];
}
