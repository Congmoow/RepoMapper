import path from 'node:path';

import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import type { DetectorContribution, ScanResult, WorkspacePackage } from '../types/index.js';
import { isRecord, readJsoncFile, readTextFile } from '../utils/fs.js';
import { emptyContribution, readPackageMetadata, resolveWorkspacePackagePaths } from './node.js';

export async function detectMonorepo(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const metadata = await readPackageMetadata(rootPath);
  const workspaceHints = [
    ...(metadata?.workspaces ?? []),
    ...(await readPnpmWorkspace(rootPath)),
    ...(await readCargoWorkspace(rootPath, scan)),
  ];
  const structureHints = ['frontend', 'backend', 'packages'].filter((directory) =>
    scan.directories.includes(directory),
  );

  if (workspaceHints.length === 0 && structureHints.length === 0) {
    return emptyContribution();
  }

  const workspacePackages = await detectWorkspacePackages(rootPath, metadata?.workspaces ?? [], scan);

  return {
    detectedTechStack: workspaceHints.length > 0 ? ['Monorepo'] : [],
    detectedFeatures: ['Monorepo structure'],
    entryPoints: [],
    importantFiles: detectImportantFiles(scan),
    scripts: [],
    workspacePackages,
  };
}

async function detectWorkspacePackages(
  rootPath: string,
  workspaces: string[],
  scan: ScanResult,
): Promise<WorkspacePackage[]> {
  if (workspaces.length === 0) {
    return [];
  }

  const packagePaths = resolveWorkspacePackagePaths(workspaces, scan.files);
  const allNames = new Set<string>();
  const rawPackages: Array<{ name: string; relPath: string; deps: Record<string, string>; devDeps: Record<string, string> }> = [];

  for (const pkgPath of packagePaths) {
    const raw = await readJsoncFile(path.join(rootPath, pkgPath));
    if (!isRecord(raw)) continue;
    const name = typeof raw.name === 'string' ? raw.name : pkgPath.replace('/package.json', '');
    const deps = isRecord(raw.dependencies) ? raw.dependencies : {};
    const devDeps = isRecord(raw.devDependencies) ? raw.devDependencies : {};
    allNames.add(name);
    rawPackages.push({
      name,
      relPath: pkgPath.replace('/package.json', ''),
      deps: deps as Record<string, string>,
      devDeps: devDeps as Record<string, string>,
    });
  }

  return rawPackages.map((pkg) => ({
    name: pkg.name,
    path: pkg.relPath,
    dependencies: Object.keys(pkg.deps).filter((dep) => allNames.has(dep)),
    devDependencies: Object.keys(pkg.devDeps).filter((dep) => allNames.has(dep)),
  }));
}

async function readPnpmWorkspace(rootPath: string): Promise<string[]> {
  const workspacePath = path.join(rootPath, 'pnpm-workspace.yaml');
  const content = await readTextFile(workspacePath);

  if (content === undefined) {
    return [];
  }

  try {
    const parsed = parseYaml(content);
    if (isRecord(parsed) && Array.isArray(parsed.packages)) {
      return parsed.packages.filter((entry): entry is string => typeof entry === 'string');
    }
  } catch {
    return [];
  }

  return [];
}

async function readCargoWorkspace(rootPath: string, scan: ScanResult): Promise<string[]> {
  if (!scan.files.includes('Cargo.toml')) {
    return [];
  }

  const content = await readTextFile(path.join(rootPath, 'Cargo.toml'));
  if (content === undefined) {
    return [];
  }

  try {
    const parsed = parseToml(content);
    if (isRecord(parsed) && isRecord(parsed.workspace) && Array.isArray(parsed.workspace.members)) {
      return parsed.workspace.members.filter((entry): entry is string => typeof entry === 'string');
    }
  } catch {
    return [];
  }

  return [];
}

function detectImportantFiles(scan: ScanResult) {
  const candidates = ['package.json', 'pnpm-workspace.yaml', 'turbo.json', 'nx.json', 'Cargo.toml'];

  return candidates
    .filter((file) => scan.files.includes(file))
    .map((file) => ({
      path: file,
      reason: 'Monorepo workspace configuration',
    }));
}
