import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HELPERS_DIR = dirname(fileURLToPath(import.meta.url));

/** Absolute path of the harness/ root. */
export const HARNESS_ROOT = resolve(HELPERS_DIR, '..');

/** All session artifacts (log/memory/run) live here, keyed by session UUID. */
export const LOGS_DIR = join(HARNESS_ROOT, 'logs');

/** Model + eval configs (and prompt.md) live here. */
export const CONFIG_DIR = join(HARNESS_ROOT, 'config');

/** Optional named character prompts. Searched before CONFIG_DIR when a prompt name is given. */
export const CHARACTERS_DIR = join(HARNESS_ROOT, 'characters');

export function logPath(sessionId: string): string {
  return join(LOGS_DIR, `${sessionId}-log.jsonl`);
}

export function memoryPath(sessionId: string): string {
  return join(LOGS_DIR, `${sessionId}-memory.md`);
}

export function runPath(sessionId: string): string {
  return join(LOGS_DIR, `${sessionId}-run.json`);
}
