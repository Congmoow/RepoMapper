import type { DetectionResult, DetectorContribution, ScanResult } from '../types/index.js';
import { detectBackend } from '../detectors/backend.js';
import { detectCi } from '../detectors/ci.js';
import { detectDatabase } from '../detectors/database.js';
import { detectDocker } from '../detectors/docker.js';
import { detectFrontend } from '../detectors/frontend.js';
import { detectGo } from '../detectors/go.js';
import { detectJava } from '../detectors/java.js';
import { detectMonorepo } from '../detectors/monorepo.js';
import { detectNode } from '../detectors/node.js';
import { detectPython } from '../detectors/python.js';
import { detectRust } from '../detectors/rust.js';

export async function detectRepository(rootPath: string, scan: ScanResult): Promise<DetectionResult> {
  const contributions = await Promise.all([
    detectNode(rootPath, scan),
    detectFrontend(rootPath, scan),
    detectBackend(rootPath, scan),
    detectDatabase(rootPath, scan),
    detectDocker(scan),
    detectCi(rootPath, scan),
    detectMonorepo(rootPath, scan),
    detectPython(rootPath, scan),
    detectGo(rootPath, scan),
    detectRust(rootPath, scan),
    detectJava(rootPath, scan),
  ]);

  return mergeContributions(contributions);
}

function mergeContributions(contributions: DetectorContribution[]): DetectionResult {
  const firstProjectName = contributions.find((contribution) => contribution.projectName !== undefined)
    ?.projectName;
  const workspacePackages = contributions
    .flatMap((contribution) => contribution.workspacePackages ?? [])
    .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== undefined);

  const result: DetectionResult = {
    ...(firstProjectName === undefined ? {} : { projectName: firstProjectName }),
    detectedTechStack: uniqueFlat(contributions.map((contribution) => contribution.detectedTechStack)),
    detectedFeatures: uniqueFlat(contributions.map((contribution) => contribution.detectedFeatures)),
    entryPoints: uniqueByPath(contributions.flatMap((contribution) => contribution.entryPoints)),
    importantFiles: uniqueByPath(contributions.flatMap((contribution) => contribution.importantFiles)),
    scripts: uniqueScripts(contributions.flatMap((contribution) => contribution.scripts)),
    ...(workspacePackages.length > 0 ? { workspacePackages } : {}),
  };

  return result;
}

function uniqueFlat(values: string[][]): string[] {
  return [...new Set(values.flat())].sort((left, right) => left.localeCompare(right));
}

function uniqueByPath<T extends { path: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    if (!seen.has(value.path)) {
      seen.add(value.path);
      result.push(value);
    }
  }

  return result;
}

function uniqueScripts<T extends { name: string }>(values: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const value of values) {
    if (!seen.has(value.name)) {
      seen.add(value.name);
      result.push(value);
    }
  }

  return result;
}
