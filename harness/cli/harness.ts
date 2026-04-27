#!/usr/bin/env -S npx tsx
import { runBaseline } from '../variants/baseline.js';
import { runCompact } from '../variants/compact.js';
import { runShortened } from '../variants/shortened.js';
import { HumanDecider } from '../helpers/human-decider.js';
import { createUI } from '../helpers/human-ui.js';
import type { RunVariantOpts, VariantResult } from '../helpers/runner.js';
import { runCli } from './run-cli.js';

const VARIANTS = ['baseline', 'compact', 'shortened'] as const;
type Variant = typeof VARIANTS[number];

function usage(): never {
  console.error('usage: harness <baseline|compact|shortened> <model-config|human>');
  process.exit(2);
}

const variant = process.argv[2] as Variant | undefined;
const modelConfig = process.argv[3];
if (!variant || !modelConfig || !VARIANTS.includes(variant)) usage();

const RUN_FNS: Record<Variant, (opts: RunVariantOpts) => Promise<VariantResult>> = {
  baseline: runBaseline,
  compact: runCompact,
  shortened: runShortened,
};

await runCli(`harness:${variant}`, async (ac, usage) => {
  const run = RUN_FNS[variant];
  if (modelConfig === 'human') {
    const ui = createUI();
    return run({
      configName: 'human',
      decider: new HumanDecider(ui),
      abortSignal: ac.signal,
      usage,
    });
  }
  return run({ configName: modelConfig, abortSignal: ac.signal, usage });
});
