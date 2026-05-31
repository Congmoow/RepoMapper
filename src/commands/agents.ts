import path from 'node:path';

import fs from 'fs-extra';
import pc from 'picocolors';

import { loadConfig } from '../core/config.js';
import { createProjectContext } from '../core/context.js';
import { detectRepository } from '../core/detector.js';
import { renderAgents } from '../renderers/agents.js';
import { scanRepository } from '../core/scanner.js';
import { writeTextFile } from '../utils/fs.js';

interface AgentsOptions {
  output?: string;
  force?: boolean;
}

export async function runAgents(rootPath = '.', options: AgentsOptions = {}): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const output = options.output ?? 'AGENTS.md';
  const outputPath = path.resolve(resolvedRoot, output);

  if (!options.force && (await fs.pathExists(outputPath))) {
    console.log(pc.yellow(`AGENTS.md already exists. Use --force to overwrite.`));
    return;
  }

  const config = await loadConfig(resolvedRoot);
  const scan = await scanRepository(resolvedRoot, config);
  const detection = await detectRepository(resolvedRoot, scan);
  const context = await createProjectContext(resolvedRoot, config, scan, detection);
  const content = renderAgents(context);

  await writeTextFile(outputPath, content);

  console.log(pc.green(`Generated ${path.relative(process.cwd(), outputPath) || outputPath}`));
}
