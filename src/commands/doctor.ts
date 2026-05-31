import path from 'node:path';

import fs from 'fs-extra';
import pc from 'picocolors';

import { loadConfig } from '../core/config.js';
import { scanRepository } from '../core/scanner.js';
import type { DoctorCheck } from '../types/index.js';

interface DoctorOptions {
  json?: boolean;
}

export async function runDoctor(rootPath = '.', options: DoctorOptions = {}): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const checks = await runDoctorChecks(resolvedRoot);

  if (options.json === true) {
    console.log(JSON.stringify({ summary: summarizeChecks(checks), checks }, null, 2));
    if (checks.some((check) => check.status === 'fail')) {
      process.exitCode = 1;
    }
    return;
  }

  for (const check of checks) {
    console.log(`${formatStatus(check.status)} ${check.label}: ${check.message}`);
  }

  if (checks.some((check) => check.status === 'fail')) {
    process.exitCode = 1;
  }
}

function summarizeChecks(checks: DoctorCheck[]): Record<DoctorCheck['status'], number> {
  return {
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    fail: checks.filter((check) => check.status === 'fail').length,
  };
}

async function runDoctorChecks(resolvedRoot: string): Promise<DoctorCheck[]> {
  const [pathCheck, configCheck, scanResult] = await Promise.all([
    checkPath(resolvedRoot),
    checkConfig(resolvedRoot),
    (async () => {
      try {
        const config = await loadConfig(resolvedRoot);
        const scan = await scanRepository(resolvedRoot, config);
        return { files: scan.files, directories: scan.directories, ok: true as const };
      } catch {
        return { files: [] as string[], directories: [] as string[], ok: false as const };
      }
    })(),
  ]);

  const fileChecks = scanResult.ok
    ? [
        checkFile(
          scanResult.files,
          'README.md',
          'README.md',
          'Provides project background and usage',
          'warning',
        ),
        checkFile(
          scanResult.files,
          'package.json',
          'package.json',
          'Provides Node.js project metadata',
          'warning',
        ),
        checkTests(scanResult.files, scanResult.directories),
        checkGitHubActions(scanResult.files),
        checkDocker(scanResult.files),
      ]
    : [];

  return [pathCheck, configCheck, ...fileChecks];
}

async function checkPath(resolvedRoot: string): Promise<DoctorCheck> {
  if (!(await fs.pathExists(resolvedRoot))) {
    return {
      label: 'target path',
      status: 'fail',
      message: `Path does not exist: ${resolvedRoot}`,
    };
  }

  try {
    await fs.access(resolvedRoot, fs.constants.R_OK);
    return { label: 'target path', status: 'pass', message: 'Path exists and is readable' };
  } catch {
    return {
      label: 'target path',
      status: 'fail',
      message: `Path is not readable: ${resolvedRoot}`,
    };
  }
}

async function checkConfig(resolvedRoot: string): Promise<DoctorCheck> {
  try {
    await loadConfig(resolvedRoot);
    return { label: 'config', status: 'pass', message: 'Config file is valid' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { label: 'config', status: 'fail', message: `Config file error: ${message}` };
  }
}

function checkFile(
  files: string[],
  filePath: string,
  label: string,
  passMessage: string,
  missingStatus: 'warning' | 'fail',
): DoctorCheck {
  if (files.includes(filePath)) {
    return { label, status: 'pass', message: passMessage };
  }

  return { label, status: missingStatus, message: 'Not found' };
}

function checkTests(files: string[], directories: string[]): DoctorCheck {
  const hasTestsDirectory = directories.some((d) => d === 'tests' || d.endsWith('/tests'));
  const hasTestFile = files.some((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f));

  if (hasTestsDirectory || hasTestFile) {
    return { label: 'tests', status: 'pass', message: 'Test directory or test files detected' };
  }

  return { label: 'tests', status: 'warning', message: 'No test directory or test files detected' };
}

function checkGitHubActions(files: string[]): DoctorCheck {
  if (files.some((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) {
    return { label: 'GitHub Actions', status: 'pass', message: 'CI workflow detected' };
  }

  return { label: 'GitHub Actions', status: 'warning', message: 'No CI workflow detected' };
}

function checkDocker(files: string[]): DoctorCheck {
  const dockerFiles = [
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'compose.yml',
    'compose.yaml',
  ];

  if (files.some((f) => dockerFiles.includes(f))) {
    return { label: 'Docker', status: 'pass', message: 'Docker configuration detected' };
  }

  return { label: 'Docker', status: 'warning', message: 'No Docker configuration detected' };
}

function formatStatus(status: DoctorCheck['status']): string {
  if (status === 'pass') return pc.green('✅');
  if (status === 'warning') return pc.yellow('⚠');
  return pc.red('❌');
}
