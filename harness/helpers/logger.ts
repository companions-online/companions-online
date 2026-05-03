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

export interface CreateLoggerOpts {
  /** Suppress `stdout(...)` output. JSONL `event(...)` writes are unaffected. Used by the multi-character CLI to keep the TUI from being trampled. */
  quiet?: boolean;
}

/**
 * Session-scoped logger: one jsonl file per session at
 * `harness/logs/<sessionId>-log.jsonl`.
 */
export function createLogger(sessionId: string, opts: CreateLoggerOpts = {}): Logger {
  const file = logPath(sessionId);
  mkdirSync(dirname(file), { recursive: true });
  const stream: WriteStream = createWriteStream(file, { flags: 'a' });
  const quiet = opts.quiet === true;
  return {
    event(kind, data) {
      stream.write(JSON.stringify({ t: new Date().toISOString(), kind, data }) + '\n');
    },
    stdout(line) {
      if (quiet) return;
      process.stdout.write(`[${ts()}] ${line}\n`);
    },
    close() { stream.end(); },
  };
}
