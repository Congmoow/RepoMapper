import type { DetectorContribution, ScanResult } from '../types/index.js';
import { emptyContribution, hasDependency, readDependencyMetadata } from './node.js';

export async function detectBackend(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const metadata = await readDependencyMetadata(rootPath, scan);
  const dependencies = metadata?.allDependencies ?? {};
  const techStack = new Set<string>();
  const features = new Set<string>();

  addWhen(techStack, hasDependency(dependencies, 'express'), 'Express');
  addWhen(techStack, hasDependency(dependencies, '@nestjs/core') || hasDependency(dependencies, '@nestjs/common'), 'NestJS');
  addWhen(techStack, hasDependency(dependencies, 'fastify'), 'Fastify');

  if (techStack.size > 0 || scan.directories.includes('backend')) {
    features.add('Backend');
  }

  if (techStack.size === 0 && features.size === 0) {
    return emptyContribution();
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints: detectBackendEntryPoints(scan),
    importantFiles: [],
    scripts: [],
  };
}

function detectBackendEntryPoints(scan: ScanResult) {
  const candidates = [
    { path: 'src/server.ts', label: 'Server entry point' },
    { path: 'src/index.ts', label: 'Server entry point' },
    { path: 'backend/src/server.ts', label: 'Monorepo backend entry' },
    { path: 'backend/src/index.ts', label: 'Monorepo backend entry' },
  ];

  return candidates.filter((candidate) => scan.files.includes(candidate.path));
}

function addWhen(target: Set<string>, condition: boolean, value: string): void {
  if (condition) {
    target.add(value);
  }
}
