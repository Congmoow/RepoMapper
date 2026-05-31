import path from 'node:path';

import Table from 'cli-table3';
import ora from 'ora';
import pc from 'picocolors';

import { loadConfig } from '../core/config.js';
import { createProjectContext } from '../core/context.js';
import { detectRepository } from '../core/detector.js';
import { scanRepository } from '../core/scanner.js';

interface ScanOptions {
  json?: boolean;
}

export async function runScan(rootPath = '.', options: ScanOptions = {}): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const spinner = options.json === true ? undefined : ora('Scanning repository').start();

  const config = await loadConfig(resolvedRoot);
  const scan = await scanRepository(resolvedRoot, config);
  const detection = await detectRepository(resolvedRoot, scan);
  const context = await createProjectContext(resolvedRoot, config, scan, detection);

  if (options.json === true) {
    console.log(
      JSON.stringify(
        {
          projectName: context.projectName,
          detectedTechStack: context.detection.detectedTechStack,
          keyFiles: context.scan.keyFiles,
          entryPoints: context.detection.entryPoints.map((entry) => entry.path),
        },
        null,
        2,
      ),
    );
    return;
  }

  spinner?.succeed('Scan complete');

  const table = new Table({
    head: [pc.bold('Field'), pc.bold('Result')],
    wordWrap: true,
  });

  table.push(
    ['Project name', context.projectName],
    ['Tech stack', context.detection.detectedTechStack.join(', ') || 'Not detected'],
    ['Key files', context.scan.keyFiles.join(', ') || 'Not detected'],
    [
      'Entry points',
      context.detection.entryPoints.map((entry) => entry.path).join(', ') || 'Not detected',
    ],
  );

  console.log(table.toString());
}
