import path from 'node:path';

import fs from 'fs-extra';

import { loadConfig } from '../../core/config.js';
import { detectRepository } from '../../core/detector.js';
import { scanRepository } from '../../core/scanner.js';
import type { DetectionResult } from '../../types/index.js';
import type { ProjectCache } from '../cache.js';

const PROJECT_MANIFESTS = new Set([
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'setup.py',
  'setup.cfg',
  'Pipfile',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
]);

export async function handleContext(cache: ProjectCache): Promise<{
  projectName: string;
  rootPath: string;
  detectedTechStack: string[];
  detectedFeatures: string[];
  entryPoints: Array<{ path: string; label: string }>;
  importantFiles: Array<{ path: string; reason: string }>;
  scripts: Array<{ name: string; command: string }>;
  projectRoot?: string;
  rootWarning?: string;
  workspaceFiles?: Array<{ path: string; reason: string }>;
  warnings?: string[];
}> {
  await cache.refresh();
  const detection = cache.getDetection();
  const upstream = isEmptyDetection(detection)
    ? await detectUpstreamProject(cache.rootPath)
    : undefined;
  const effectiveDetection = upstream?.detection ?? detection;
  const relativePrefix =
    upstream === undefined ? undefined : toRepoRelativePrefix(upstream.projectRoot, cache.rootPath);

  const noProjectDetected = isEmptyDetection(detection) && upstream === undefined;

  return {
    projectName: effectiveDetection.projectName ?? path.basename(cache.rootPath),
    rootPath: cache.rootPath,
    detectedTechStack: effectiveDetection.detectedTechStack,
    detectedFeatures: effectiveDetection.detectedFeatures,
    entryPoints:
      relativePrefix === undefined
        ? effectiveDetection.entryPoints
        : toServedRootEntries(effectiveDetection.entryPoints, relativePrefix),
    importantFiles:
      relativePrefix === undefined
        ? effectiveDetection.importantFiles
        : toServedRootEntries(effectiveDetection.importantFiles, relativePrefix),
    scripts: effectiveDetection.scripts,
    ...(noProjectDetected
      ? {
          warnings: [
            `No project manifest (e.g. package.json) found at or above ${cache.rootPath}; project context is unavailable. Point the server at the repository root. 未在 ${cache.rootPath} 或其上级目录发现项目清单文件（如 package.json），无法提供项目概览；请将 server 指向仓库根目录。`,
          ],
        }
      : {}),
    ...(upstream === undefined
      ? {}
      : {
          projectRoot: upstream.projectRoot,
          rootWarning: `当前服务路径不是项目根，项目根可能是 ${upstream.projectRoot}。索引仍只覆盖 ${cache.rootPath}。`,
          workspaceFiles: buildWorkspaceFiles(effectiveDetection, relativePrefix ?? ''),
        }),
  };
}

async function detectUpstreamProject(
  rootPath: string,
): Promise<{ projectRoot: string; detection: DetectionResult } | undefined> {
  let current = path.dirname(rootPath);

  while (current !== rootPath && current !== path.dirname(current)) {
    if (!(await hasProjectManifestAt(current))) {
      current = path.dirname(current);
      continue;
    }

    const config = await loadConfig(current);
    const scan = await scanRepository(current, config);
    const detection = await detectRepository(current, scan);

    if (!isEmptyDetection(detection)) {
      return { projectRoot: current, detection };
    }

    current = path.dirname(current);
  }

  return undefined;
}

async function hasProjectManifestAt(rootPath: string): Promise<boolean> {
  for (const manifest of PROJECT_MANIFESTS) {
    if (await fs.pathExists(path.join(rootPath, manifest))) {
      return true;
    }
  }

  return false;
}

function isEmptyDetection(detection: DetectionResult): boolean {
  return (
    detection.projectName === undefined &&
    detection.detectedTechStack.length === 0 &&
    detection.detectedFeatures.length === 0 &&
    detection.entryPoints.length === 0 &&
    detection.importantFiles.length === 0 &&
    detection.scripts.length === 0
  );
}

function toRepoRelativePrefix(projectRoot: string, rootPath: string): string {
  return path.relative(projectRoot, rootPath).replaceAll(path.sep, '/');
}

function toServedRootEntries<T extends { path: string }>(entries: T[], prefix: string): T[] {
  return entries
    .filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`))
    .map((entry) => ({
      ...entry,
      path: entry.path === prefix ? '.' : entry.path.slice(prefix.length + 1),
    }));
}

function buildWorkspaceFiles(
  detection: DetectionResult,
  prefix: string,
): Array<{ path: string; reason: string }> {
  return detection.importantFiles
    .filter((file) => !file.path.startsWith(`${prefix}/`))
    .map((file) => ({ path: file.path, reason: file.reason }));
}
