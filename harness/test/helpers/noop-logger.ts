import type { Logger } from '../../logger.js';

export function createNoopLogger(): Logger & { events: { kind: string; data: unknown }[]; stdoutLines: string[] } {
  const events: { kind: string; data: unknown }[] = [];
  const stdoutLines: string[] = [];
  return {
    event(kind, data) { events.push({ kind, data }); },
    stdout(line) { stdoutLines.push(line); },
    close() { /* noop */ },
    events,
    stdoutLines,
  };
}
