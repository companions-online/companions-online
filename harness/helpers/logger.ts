import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { logPath } from './paths.js';

export interface Logger {
  event(kind: string, data: unknown): void;
  stdout(line: string): void;
  close(): void;
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Session-scoped logger: one jsonl file per session at
 * `harness/logs/<sessionId>-log.jsonl`.
 */
export function createLogger(sessionId: string): Logger {
  const file = logPath(sessionId);
  mkdirSync(dirname(file), { recursive: true });
  const stream: WriteStream = createWriteStream(file, { flags: 'a' });
  return {
    event(kind, data) {
      stream.write(JSON.stringify({ t: new Date().toISOString(), kind, data }) + '\n');
    },
    stdout(line) {
      process.stdout.write(`[${ts()}] ${line}\n`);
    },
    close() { stream.end(); },
  };
}
