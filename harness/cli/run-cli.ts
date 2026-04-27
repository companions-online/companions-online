import type { UsageAccumulator } from '../helpers/runner.js';

/**
 * Shared CLI plumbing: SIGINT → AbortController, error logging, exit code,
 * token-usage line on every exit path. The same `usage` object is passed to
 * the inner fn so it can be threaded into the runner / eval-runner; whatever
 * the runner accumulated by the time control returns here gets printed.
 */
export async function runCli(
  name: string,
  fn: (ac: AbortController, usage: UsageAccumulator) => Promise<unknown>,
): Promise<void> {
  const ac = new AbortController();
  const usage: UsageAccumulator = { prompt: 0, completion: 0, total: 0 };
  process.on('SIGINT', () => {
    console.error(`\n[${name}] SIGINT — shutting down`);
    ac.abort();
  });
  try {
    await fn(ac, usage);
  } catch (e) {
    console.error(e);
    printUsage(name, usage);
    process.exit(1);
  }
  printUsage(name, usage);
}

function printUsage(name: string, usage: UsageAccumulator): void {
  console.log(`[${name}] tokens: in=${usage.prompt} out=${usage.completion} total=${usage.total}`);
}
