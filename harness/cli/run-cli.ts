/**
 * Shared CLI plumbing: SIGINT → AbortController, error logging, exit code.
 * Replaces the boilerplate that used to live in every variant's `cli()`.
 */
export async function runCli(name: string, fn: (ac: AbortController) => Promise<unknown>): Promise<void> {
  const ac = new AbortController();
  process.on('SIGINT', () => {
    console.error(`\n[${name}] SIGINT — shutting down`);
    ac.abort();
  });
  try {
    await fn(ac);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
