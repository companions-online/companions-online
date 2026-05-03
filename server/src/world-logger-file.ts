import { createWriteStream, type WriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { BaseLogger, type LogEntry, type WorldLogger } from './world-logger.js';

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

export function createFileLogger(logPath: string): WorldLogger {
  return new FileLogger(logPath);
}
