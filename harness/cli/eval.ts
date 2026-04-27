#!/usr/bin/env -S npx tsx
import { loadConfig } from '../helpers/config.js';
import { runEval, formatResultLine, type EvalConfig } from '../eval/eval-runner.js';
import { runPath } from '../helpers/paths.js';
import { runCli } from './run-cli.js';

const evalConfigName = process.argv[2];
const modelConfigName = process.argv[3];
if (!evalConfigName || !modelConfigName) {
  console.error('usage: eval <eval-config> <model-config>');
  process.exit(2);
}

await runCli('eval', async (ac, usage) => {
  const evalConfig = loadConfig<EvalConfig>(evalConfigName, 'eval');
  const result = await runEval({
    llmConfigName: modelConfigName,
    evalConfig,
    abortSignal: ac.signal,
    usage,
  });
  console.log(formatResultLine(result));
  console.log(`[eval] result written to ${runPath(result.runId)}`);
  process.exit(result.score === result.total ? 0 : 1);
});
