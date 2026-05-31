import type { DetectorContribution, ImportantFile, ScanResult } from '../types/index.js';
import { emptyContribution, hasDependency, readDependencyMetadata } from './node.js';

export async function detectFrontend(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const metadata = await readDependencyMetadata(rootPath, scan);
  const dependencies = metadata?.allDependencies ?? {};
  const techStack = new Set<string>();
  const features = new Set<string>();
  const importantFiles: ImportantFile[] = [];

  addWhen(techStack, hasDependency(dependencies, 'react'), 'React');
  addWhen(techStack, hasDependency(dependencies, 'vite') || hasConfig(scan, 'vite.config'), 'Vite');
  addWhen(techStack, hasDependency(dependencies, 'next') || hasConfig(scan, 'next.config'), 'Next.js');
  addWhen(techStack, hasDependency(dependencies, 'vue') || hasDependency(dependencies, '@vitejs/plugin-vue'), 'Vue');

  if (techStack.size > 0 || scan.directories.includes('frontend')) {
    features.add('Frontend');
  }

  if (hasConfig(scan, 'vite.config')) {
    importantFiles.push({ path: findConfig(scan, 'vite.config'), reason: 'Vite build configuration' });
  }

  if (techStack.size === 0 && features.size === 0 && importantFiles.length === 0) {
    return emptyContribution();
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints: detectFrontendEntryPoints(scan),
    importantFiles,
    scripts: [],
  };
}

function detectFrontendEntryPoints(scan: ScanResult) {
  const candidates = [
    { path: 'src/main.tsx', label: 'React/Vite frontend entry' },
    { path: 'src/main.ts', label: 'Frontend entry point' },
    { path: 'frontend/src/main.tsx', label: 'Monorepo frontend entry' },
    { path: 'frontend/src/main.ts', label: 'Monorepo frontend entry' },
  ];

  return candidates.filter((candidate) => scan.files.includes(candidate.path));
}

function hasConfig(scan: ScanResult, prefix: string): boolean {
  return scan.files.some((file) => file.startsWith(prefix));
}

function findConfig(scan: ScanResult, prefix: string): string {
  return scan.files.find((file) => file.startsWith(prefix)) ?? prefix;
}

function addWhen(target: Set<string>, condition: boolean, value: string): void {
  if (condition) {
    target.add(value);
  }
}
