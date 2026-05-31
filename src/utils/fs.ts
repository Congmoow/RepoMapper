import path from 'node:path';

import fs from 'fs-extra';
import { parse } from 'jsonc-parser';

import { RepoMapperError } from './errors.js';

export async function readTextFile(filePath: string): Promise<string | undefined> {
  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return fs.readFile(filePath, 'utf8');
}

export async function readJsoncFile(filePath: string): Promise<unknown | undefined> {
  const content = await readTextFile(filePath);

  if (content === undefined) {
    return undefined;
  }

  try {
    return parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new RepoMapperError(`Failed to parse JSON file ${filePath}: ${message}`);
  }
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  if (filePath === '-') {
    console.log(content.endsWith('\n') ? content.slice(0, -1) : content);
    return;
  }

  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, 'utf8');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function recordOfStrings(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
