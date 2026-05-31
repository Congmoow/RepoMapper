import path from 'node:path';

import { parse as parseToml } from 'smol-toml';

import type { DetectorContribution, ScanResult } from '../types/index.js';
import { isRecord, readTextFile } from '../utils/fs.js';
import { emptyContribution } from './node.js';

export async function detectPython(rootPath: string, scan: ScanResult): Promise<DetectorContribution> {
  const hasPyproject = scan.files.includes('pyproject.toml');
  const hasRequirements = scan.files.some((f) => /^requirements.*\.txt$/.test(f));
  const hasSetupPy = scan.files.includes('setup.py');
  const hasSetupCfg = scan.files.includes('setup.cfg');
  const hasPipfile = scan.files.includes('Pipfile');
  const hasPoetryLock = scan.files.includes('poetry.lock');
  const hasPyFiles = scan.files.some((f) => f.endsWith('.py'));

  if (!hasPyFiles && !hasPyproject && !hasRequirements && !hasSetupPy) {
    return emptyContribution();
  }

  const techStack = new Set<string>(['Python']);
  const features = new Set<string>();
  const importantFiles: Array<{ path: string; reason: string }> = [];
  const entryPoints: Array<{ path: string; label: string }> = [];
  const scripts: Array<{ name: string; command: string }> = [];

  // Detect package manager / build tool
  if (hasPyproject) {
    importantFiles.push({ path: 'pyproject.toml', reason: 'Python project configuration' });
    const pyproject = await readPyproject(path.join(rootPath, 'pyproject.toml'));
    if (pyproject) {
      if (pyproject.tool === 'poetry') techStack.add('Poetry');
      if (pyproject.tool === 'hatch') techStack.add('Hatch');
      if (pyproject.tool === 'pdm') techStack.add('PDM');
      if (pyproject.tool === 'uv') techStack.add('uv');
      if (pyproject.scripts.length > 0) {
        scripts.push(...pyproject.scripts);
      }
    }
  }

  if (hasRequirements) {
    importantFiles.push({ path: 'requirements.txt', reason: 'Python dependencies' });
  }
  if (hasSetupPy) {
    importantFiles.push({ path: 'setup.py', reason: 'Python package setup' });
  }
  if (hasPipfile) techStack.add('Pipenv');
  if (hasPoetryLock) techStack.add('Poetry');

  // Detect frameworks
  // Check for common frameworks via file patterns
  if (scan.files.includes('manage.py') || scan.directories.some((d) => scan.files.includes(`${d}/settings.py`))) {
    techStack.add('Django');
    features.add('Backend');
    if (scan.files.includes('manage.py')) {
      entryPoints.push({ path: 'manage.py', label: 'Django management entry' });
    }
  }

  if (scan.files.some((f) => f.endsWith('app.py') || f.endsWith('main.py'))) {
    const appFile = scan.files.find((f) => f === 'app.py' || f === 'main.py' || f === 'src/main.py' || f === 'src/app.py');
    if (appFile) {
      entryPoints.push({ path: appFile, label: 'Application entry point' });
    }
  }

  if (hasSetupPy || hasSetupCfg || hasPyproject) {
    features.add('Python package');
  }

  // Detect test frameworks
  if (scan.directories.some((d) => d === 'tests' || d === 'test') || scan.files.some((f) => f.startsWith('test_') || f.includes('/test_'))) {
    features.add('Tests');
  }

  return {
    detectedTechStack: [...techStack],
    detectedFeatures: [...features],
    entryPoints,
    importantFiles,
    scripts,
  };
}

interface PyprojectInfo {
  tool: string | undefined;
  scripts: Array<{ name: string; command: string }>;
}

async function readPyproject(filePath: string): Promise<PyprojectInfo | undefined> {
  const content = await readTextFile(filePath);
  if (content === undefined) return undefined;

  try {
    const parsed = parseToml(content);
    if (!isRecord(parsed)) return undefined;

    let tool: string | undefined;
    if (isRecord(parsed.tool)) {
      if ('poetry' in parsed.tool) tool = 'poetry';
      else if ('hatch' in parsed.tool) tool = 'hatch';
      else if ('pdm' in parsed.tool) tool = 'pdm';
      else if ('uv' in parsed.tool) tool = 'uv';
    }

    const scripts: Array<{ name: string; command: string }> = [];
    if (isRecord(parsed.project) && isRecord(parsed.project.scripts)) {
      for (const [name, command] of Object.entries(parsed.project.scripts)) {
        if (typeof command === 'string') {
          scripts.push({ name, command });
        }
      }
    }

    return { tool, scripts };
  } catch {
    return undefined;
  }
}


