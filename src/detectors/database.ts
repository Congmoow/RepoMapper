import path from 'node:path';

import type { DetectorContribution, ImportantFile, ScanResult } from '../types/index.js';
import { readTextFile } from '../utils/fs.js';
import {
  emptyContribution,
  hasDependency,
  readDependencyMetadata,
  readPackageMetadata,
  resolveWorkspacePackagePaths,
} from './node.js';

export async function detectDatabase(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const metadata = await readDependencyMetadata(rootPath, scan);
  const dependencies = metadata?.allDependencies ?? {};
  const rootMetadata = await readPackageMetadata(rootPath);
  const schemaPaths = getRelevantSchemaPaths(scan, rootMetadata?.workspaces ?? []);
  const schemas = await Promise.all(schemaPaths.map(async (schemaPath) => readTextFile(path.join(rootPath, schemaPath))));
  const techStack = new Set<string>();
  const importantFiles: ImportantFile[] = [];

  addWhen(techStack, hasDependency(dependencies, 'prisma') || hasDependency(dependencies, '@prisma/client') || schemas.length > 0, 'Prisma');
  addWhen(techStack, hasDependency(dependencies, 'pg') || schemas.some((schema) => schema?.includes('provider = "postgresql"') === true), 'PostgreSQL');
  addWhen(techStack, hasDependency(dependencies, 'mysql2') || schemas.some((schema) => schema?.includes('provider = "mysql"') === true), 'MySQL');
  addWhen(techStack, hasDependency(dependencies, 'sqlite3') || schemas.some((schema) => schema?.includes('provider = "sqlite"') === true), 'SQLite');

  for (const schemaPath of schemaPaths) {
    importantFiles.push({ path: schemaPath, reason: 'Prisma data model and database connection config' });
  }

  if (techStack.size === 0 && importantFiles.length === 0) {
    return emptyContribution();
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: ['Database'],
    entryPoints: [],
    importantFiles,
    scripts: [],
  };
}

function addWhen(target: Set<string>, condition: boolean, value: string): void {
  if (condition) {
    target.add(value);
  }
}

function getRelevantSchemaPaths(scan: ScanResult, workspaces: string[]): string[] {
  const workspaceRoots = resolveWorkspacePackagePaths(workspaces, scan.files).map((packagePath) =>
    packagePath.replace(/\/package\.json$/, ''),
  );

  return scan.files.filter(
    (file) =>
      file === 'prisma/schema.prisma' ||
      workspaceRoots.some((workspaceRoot) => file === `${workspaceRoot}/prisma/schema.prisma`),
  );
}
