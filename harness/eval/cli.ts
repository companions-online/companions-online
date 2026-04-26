import { readFileSync } from 'node:fs';
import { runEval, formatResultLine, type EvalConfig } from './eval-runner.js';

async function main(): Promise<void> {
  const llmConfigName = process.argv[2];
  const evalConfigPath = process.argv[3];
  if (!llmConfigName || !evalConfigPath) {
    console.error('usage: tsx harness/eval/cli.ts <llm-config-name> <eval-config-path>');
    process.exit(2);
  }

  const evalConfig = JSON.parse(readFileSync(evalConfigPath, 'utf8')) as EvalConfig;

  const ac = new AbortController();
  process.on('SIGINT', () => {
    console.error('\n[eval] SIGINT — aborting');
    ac.abort();
  });

  const result = await runEval({
    llmConfigName,
    evalConfig,
    abortSignal: ac.signal,
  });

  console.log(formatResultLine(result));
  console.log(`[eval] result written to harness/eval/runs/${result.runId}.json`);
  process.exit(result.score === result.total ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
