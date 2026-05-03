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

// File-logger lives in world-logger-file.ts so this module stays free of
// node:fs/path imports — keeps the standalone (browser) bundle building
// without a Node shim. BaseLogger is exported so the file variant can extend.
export class BaseLogger implements WorldLogger {
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

export function createMemoryLogger(): WorldLogger {
  return new MemoryLogger();
}
