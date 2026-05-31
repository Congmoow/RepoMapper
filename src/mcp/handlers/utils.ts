import { toPosixPath } from '../../utils/path.js';

export function normalizeQueryPath(value: string): string {
  const normalized = toPosixPath(value.trim())
    .replace(/^\.?\//, '')
    .replace(/\/$/, '');
  return normalized.length === 0 ? '.' : normalized;
}
