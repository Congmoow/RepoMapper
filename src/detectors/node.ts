import path from 'node:path';

import type { DetectorContribution, PackageMetadata, ScanResult, ScriptInfo } from '../types/index.js';
import { isRecord, readJsoncFile, recordOfStrings } from '../utils/fs.js';

export async function readPackageMetadata(rootPath: string): Promise<PackageMetadata | undefined> {
  return readPackageJson(path.join(rootPath, 'package.json'));
}

export async function readDependencyMetadata(
  rootPath: string,
  scan: ScanResult,
): Promise<PackageMetadata | undefined> {
  const rootMetadata = await readPackageMetadata(rootPath);

  if (rootMetadata === undefined) {
    return undefined;
  }

  const workspacePackagePaths = resolveWorkspacePackagePaths(rootMetadata.workspaces, scan.files);
  const workspaceMetadata = await Promise.all(
    workspacePackagePaths.map(async (packagePath) => readPackageJson(path.join(rootPath, packagePath))),
  );
  const manifests = [rootMetadata, ...workspaceMetadata.filter((item): item is PackageMetadata => item !== undefined)];

  return mergePackageMetadata(manifests);
}

async function readPackageJson(packagePath: string): Promise<PackageMetadata | undefined> {
  const rawPackage = await readJsoncFile(packagePath);

  if (!isRecord(rawPackage)) {
    return undefined;
  }

  const dependencies = recordOfStrings(rawPackage.dependencies);
  const devDependencies = recordOfStrings(rawPackage.devDependencies);
  const scripts = toScripts(rawPackage.scripts);
  const workspaces = toWorkspaces(rawPackage.workspaces);
  const name = typeof rawPackage.name === 'string' ? rawPackage.name : undefined;

  return {
    ...(name === undefined ? {} : { name }),
    scripts,
    dependencies,
    devDependencies,
    allDependencies: {
      ...dependencies,
      ...devDependencies,
    },
    workspaces,
  };
}

export async function detectNode(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const metadata = await readPackageMetadata(rootPath);

  if (metadata === undefined) {
    return emptyContribution();
  }

  const dependencyMetadata = await readDependencyMetadata(rootPath, scan);
  const techStack = new Set<string>();
  const dependencies = dependencyMetadata?.allDependencies ?? metadata.allDependencies;

  addWhen(techStack, hasDependency(dependencies, 'typescript') || scan.files.includes('tsconfig.json'), 'TypeScript');
  addWhen(techStack, hasDependency(dependencies, 'react'), 'React');
  addWhen(techStack, hasDependency(dependencies, 'vite') || hasViteConfig(scan), 'Vite');
  addWhen(techStack, hasDependency(dependencies, 'express'), 'Express');
  addWhen(techStack, hasDependency(dependencies, 'prisma') || hasDependency(dependencies, '@prisma/client'), 'Prisma');
  addWhen(techStack, hasDependency(dependencies, 'vitest'), 'Vitest');
  addWhen(techStack, hasDependency(dependencies, 'jest'), 'Jest');
  addWhen(techStack, hasDependency(dependencies, 'eslint'), 'ESLint');
  addWhen(techStack, hasDependency(dependencies, 'prettier'), 'Prettier');

  return {
    ...(metadata.name === undefined ? {} : { projectName: metadata.name }),
    detectedTechStack: [...techStack],
    detectedFeatures: ['Node.js package'],
    entryPoints: detectEntryPoints(scan),
    importantFiles: [{ path: 'package.json', reason: 'Project metadata, scripts and dependency declarations' }],
    scripts: metadata.scripts,
  };
}

export function resolveWorkspacePackagePaths(workspaces: string[], files: string[]): string[] {
  const packagePaths = new Set<string>();

  for (const workspace of workspaces) {
    const normalizedWorkspace = workspace.replaceAll('\\', '/').replace(/\/$/, '');

    if (normalizedWorkspace.includes('*')) {
      const prefix = normalizedWorkspace.split('*')[0]?.replace(/\/$/, '');
      if (prefix === undefined || prefix.length === 0) {
        continue;
      }

      for (const file of files) {
        if (file.startsWith(`${prefix}/`) && file.endsWith('/package.json')) {
          packagePaths.add(file);
        }
      }

      continue;
    }

    const candidate = `${normalizedWorkspace}/package.json`;
    if (files.includes(candidate)) {
      packagePaths.add(candidate);
    }
  }

  return [...packagePaths].sort();
}

function mergePackageMetadata(manifests: PackageMetadata[]): PackageMetadata {
  const [rootMetadata] = manifests;

  return {
    ...(rootMetadata?.name === undefined ? {} : { name: rootMetadata.name }),
    scripts: rootMetadata?.scripts ?? [],
    dependencies: Object.assign({}, ...manifests.map((manifest) => manifest.dependencies)) as Record<string, string>,
    devDependencies: Object.assign({}, ...manifests.map((manifest) => manifest.devDependencies)) as Record<
      string,
      string
    >,
    allDependencies: Object.assign({}, ...manifests.map((manifest) => manifest.allDependencies)) as Record<
      string,
      string
    >,
    workspaces: rootMetadata?.workspaces ?? [],
  };
}

export function emptyContribution(): DetectorContribution {
  return {
    detectedTechStack: [],
    detectedFeatures: [],
    entryPoints: [],
    importantFiles: [],
    scripts: [],
  };
}

export function hasDependency(dependencies: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(dependencies, name);
}

function toScripts(value: unknown): ScriptInfo[] {
  return Object.entries(recordOfStrings(value)).map(([name, command]) => ({
    name,
    command,
  }));
}

function toWorkspaces(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }

  if (isRecord(value) && Array.isArray(value.packages)) {
    return value.packages.filter((entry): entry is string => typeof entry === 'string');
  }

  return [];
}

function hasViteConfig(scan: ScanResult): boolean {
  return scan.files.some((file) => /^vite\.config\.(ts|mts|js|mjs)$/.test(file));
}

function detectEntryPoints(scan: ScanResult) {
  const candidates = [
    { path: 'src/main.tsx', label: 'Frontend app entry' },
    { path: 'src/main.ts', label: 'App entry point' },
    { path: 'src/cli.ts', label: 'CLI entry point' },
    { path: 'src/index.ts', label: 'Node.js entry point' },
    { path: 'src/server.ts', label: 'Server entry point' },
    { path: 'src/app.ts', label: 'App bootstrap entry' },
  ];

  return candidates.filter((candidate) => scan.files.includes(candidate.path));
}

function addWhen(target: Set<string>, condition: boolean, value: string): void {
  if (condition) {
    target.add(value);
  }
}
