import path from 'node:path';

import fs from 'fs-extra';
import pc from 'picocolors';

import { CONFIG_FILE_NAME } from '../core/config.js';
import { DEFAULT_CONFIG } from '../schema/config.js';

export async function runInit(rootPath = '.'): Promise<void> {
  const configPath = path.resolve(rootPath, CONFIG_FILE_NAME);

  if (await fs.pathExists(configPath)) {
    console.log(pc.yellow(`Config file already exists: ${CONFIG_FILE_NAME}`));
    return;
  }

  await fs.writeJson(configPath, DEFAULT_CONFIG, {
    spaces: 2,
  });
  await fs.appendFile(configPath, '\n', 'utf8');

  console.log(pc.green(`Generated ${CONFIG_FILE_NAME}`));
}
