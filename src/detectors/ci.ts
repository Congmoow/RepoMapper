import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { DetectorContribution, ScanResult } from '../types/index.js';
import { isRecord, readTextFile } from '../utils/fs.js';
import { emptyContribution } from './node.js';

export async function detectCi(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const workflows = scan.files.filter((file) => /^\.github\/workflows\/.+\.ya?ml$/.test(file));

  if (workflows.length === 0) {
    return emptyContribution();
  }

  const workflowNames = await Promise.all(
    workflows.map(async (workflow) => readWorkflowName(path.join(rootPath, workflow))),
  );
  const labels = workflowNames.filter((name): name is string => name !== undefined);

  return {
    detectedTechStack: ['GitHub Actions'],
    detectedFeatures: labels.length > 0 ? labels.map((name) => `CI: ${name}`) : ['CI'],
    entryPoints: [],
    importantFiles: workflows.map((workflow) => ({
      path: workflow,
      reason: 'GitHub Actions workflow',
    })),
    scripts: [],
  };
}

async function readWorkflowName(filePath: string): Promise<string | undefined> {
  const content = await readTextFile(filePath);

  if (content === undefined) {
    return undefined;
  }

  try {
    const parsed = parseYaml(content);
    if (isRecord(parsed) && typeof parsed.name === 'string') {
      return parsed.name;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
