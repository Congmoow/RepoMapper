import path from 'node:path';

export function normalizePath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function resolveRootPath(rootPath: string): string {
  return path.resolve(rootPath);
}

export function pathExistsInList(paths: string[], target: string): boolean {
  const normalizedTarget = toPosixPath(target);
  return paths.includes(normalizedTarget);
}

export function isInsideDirectory(filePath: string, directoryPath: string): boolean {
  const normalizedFile = toPosixPath(filePath);
  const normalizedDirectory = toPosixPath(directoryPath).replace(/\/$/, '');
  return normalizedFile === normalizedDirectory || normalizedFile.startsWith(`${normalizedDirectory}/`);
}
