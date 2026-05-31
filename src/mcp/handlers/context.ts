import path from 'node:path';

import { loadConfig } from '../../core/config.js';
import { detectRepository } from '../../core/detector.js';
import { scanRepository } from '../../core/scanner.js';
import type { DetectionResult } from '../../types/index.js';
import type { ProjectCache } from '../cache.js';

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
}> {
  await cache.refresh();
  const detection = cache.getDetection();
  const upstream = isEmptyDetection(detection)
    ? await detectUpstreamProject(cache.rootPath)
    : undefined;
  const effectiveDetection = upstream?.detection ?? detection;
  const relativePrefix =
    upstream === undefined ? undefined : toRepoRelativePrefix(upstream.projectRoot, cache.rootPath);

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
