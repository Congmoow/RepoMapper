import { z } from 'zod';

import type { RepoMapperConfig } from '../types/index.js';

export const configSchema = z
  .object({
    maxDepth: z.number().int().positive().default(4),
    ignore: z
      .array(z.string())
      .default(['node_modules', 'dist', 'build', '.git', 'coverage', '.next', 'target']),
    includeTests: z.boolean().default(true),
    includeScripts: z.boolean().default(true),
    includeCi: z.boolean().default(true),
    includeDocker: z.boolean().default(true),
  })
  .strip();

export const DEFAULT_CONFIG: RepoMapperConfig = configSchema.parse({});

export type ConfigInput = z.input<typeof configSchema>;
