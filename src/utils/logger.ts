import createDebug from 'debug';
import pc from 'picocolors';

export const debugLog = createDebug('repomapper');

export function info(message: string): void {
  console.log(pc.cyan(message));
}

export function success(message: string): void {
  console.log(pc.green(message));
}

export function warn(message: string): void {
  console.warn(pc.yellow(message));
}

export function error(message: string): void {
  console.error(pc.red(message));
}
