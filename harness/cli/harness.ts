#!/usr/bin/env -S npx tsx
import { runBaseline } from '../variants/baseline.js';
import { runCompact } from '../variants/compact.js';
import { runTruncated } from '../variants/truncated.js';
import { HumanDecider } from '../helpers/human-decider.js';
import { createUI } from '../helpers/human-ui.js';
import { runCli } from './run-cli.js';

const VARIANTS = ['baseline', 'compact', 'truncated', 'human'] as const;
type Variant = typeof VARIANTS[number];

function usage(): never {
  console.error('usage: harness <baseline|compact|truncated|human> <model-config>');
  process.exit(2);
}

const variant = process.argv[2] as Variant | undefined;
const modelConfig = process.argv[3];
if (!variant || !modelConfig || !VARIANTS.includes(variant)) usage();

await runCli(`harness:${variant}`, async (ac) => {
  if (variant === 'human') {
    const ui = createUI();
    return runCompact({
      configName: modelConfig,
      decider: new HumanDecider(ui),
      abortSignal: ac.signal,
    });
  }
  const run = variant === 'baseline' ? runBaseline
    : variant === 'truncated' ? runTruncated
    : runCompact;
  return run({ configName: modelConfig, abortSignal: ac.signal });
});
