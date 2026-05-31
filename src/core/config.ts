import path from 'node:path';

import { ZodError } from 'zod';

import { DEFAULT_CONFIG, configSchema } from '../schema/config.js';
import type { RepoMapperConfig } from '../types/index.js';
import { readJsoncFile } from '../utils/fs.js';
import { RepoMapperError } from '../utils/errors.js';

export const CONFIG_FILE_NAME = 'repomapper.config.json';

export async function loadConfig(rootPath: string): Promise<RepoMapperConfig> {
  const configPath = path.join(rootPath, CONFIG_FILE_NAME);
  const rawConfig = await readJsoncFile(configPath);

  if (rawConfig === undefined) {
    return DEFAULT_CONFIG;
  }

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      throw new RepoMapperError(`Config validation failed: ${issues}`);
    }

    throw error;
  }
}
