import { createWriteStream, type WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly msg: string;
  readonly ts: number;
  readonly data?: unknown;
}

export interface WorldLogger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** Logs an `error` entry when `cond` is false. Returns `cond` so callers can
   *  short-circuit: `if (!logger.assert(cond, ..., ...)) return;`. */
  assert(cond: boolean, msg: string, data?: unknown): boolean;
  /** Populated only by the memory logger; always empty for the file logger. */
  readonly entries: readonly LogEntry[];
  readonly warnCount: number;
  readonly errorCount: number;
  close(): Promise<void>;
}

class BaseLogger implements WorldLogger {
  warnCount = 0;
  errorCount = 0;
  readonly entries: LogEntry[] = [];
  protected readonly memory: boolean;

  constructor(memory: boolean) {
    this.memory = memory;
  }

  info(msg: string, data?: unknown): void { this.write('info', msg, data); }
  warn(msg: string, data?: unknown): void { this.warnCount++; this.write('warn', msg, data); }
  error(msg: string, data?: unknown): void { this.errorCount++; this.write('error', msg, data); }

  assert(cond: boolean, msg: string, data?: unknown): boolean {
    if (!cond) this.error(`assert failed: ${msg}`, data);
    return cond;
  }

  protected write(level: LogLevel, msg: string, data?: unknown): void {
    const entry: LogEntry = { level, msg, ts: Date.now(), data };
    if (this.memory) this.entries.push(entry);
    this.onEntry(entry);
  }

  protected onEntry(_entry: LogEntry): void { /* override */ }

  async close(): Promise<void> { /* override */ }
}

class MemoryLogger extends BaseLogger {
  constructor() { super(true); }
}

class FileLogger extends BaseLogger {
  private stream: WriteStream | null = null;
  private readyPromise: Promise<void>;
  private streamErrored = false;

  constructor(logPath: string) {
    super(false);
    this.readyPromise = this.open(logPath);
  }

  private async open(logPath: string): Promise<void> {
    try {
      await mkdir(dirname(logPath), { recursive: true });
      this.stream = createWriteStream(logPath, { flags: 'a' });
      this.stream.on('error', (err) => {
        if (!this.streamErrored) {
          this.streamErrored = true;
          // eslint-disable-next-line no-console
          console.error('[world-logger] write stream error:', err);
        }
      });
    } catch (err) {
      this.streamErrored = true;
      // eslint-disable-next-line no-console
      console.error('[world-logger] failed to open log file:', err);
    }
  }

  protected override onEntry(entry: LogEntry): void {
    if (!this.stream || this.streamErrored) return;
    try {
      this.stream.write(JSON.stringify(entry) + '\n');
    } catch (err) {
      if (!this.streamErrored) {
        this.streamErrored = true;
        // eslint-disable-next-line no-console
        console.error('[world-logger] write error:', err);
      }
    }
  }

  override async close(): Promise<void> {
    await this.readyPromise;
    const stream = this.stream;
    if (!stream) return;
    await new Promise<void>((resolve) => stream.end(resolve));
    this.stream = null;
  }
}

export function createMemoryLogger(): WorldLogger {
  return new MemoryLogger();
}

export function createFileLogger(logPath: string): WorldLogger {
  return new FileLogger(logPath);
}
