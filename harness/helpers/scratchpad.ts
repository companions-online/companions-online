import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { memoryPath } from './paths.js';

export interface Scratchpad {
  path: string;
  read(): string;
  update(content: string): void;
}

/**
 * Per-session markdown scratchpad. Default path lives alongside the session
 * log in `harness/logs/<sessionId>-memory.md`. Tests may override `dir` to
 * use a tmp directory; in that mode the filename is just `<sessionId>.md`.
 */
export function openScratchpad(sessionId: string, dir?: string): Scratchpad {
  const path = dir ? join(dir, `${sessionId}.md`) : memoryPath(sessionId);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, '', 'utf8');
  return {
    path,
    read() { return readFileSync(path, 'utf8'); },
    update(content: string) { writeFileSync(path, content, 'utf8'); },
  };
}
