import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';

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
 * Session-scoped logger: one jsonl file per session, keyed by the session UUID.
 */
export function createLogger(sessionId: string, logDir = 'harness/logs'): Logger {
  mkdirSync(logDir, { recursive: true });
  const file = join(logDir, `${sessionId}.jsonl`);
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
