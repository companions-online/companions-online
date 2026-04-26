import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './paths.js';

export interface ModelConfig {
  model: string;
  actionWindowSize?: number;
  [k: string]: unknown;
}

export type ConfigKind = 'model' | 'eval';

/**
 * Load `harness/config/<name>.json`, runtime-check that its `type` field
 * matches `expected`, then cast to T. The `type` field is a discriminator —
 * it's not surfaced in TS types because callers that load by kind already
 * know what they got.
 *
 * @param dir override the config directory (tests inject fixtures here)
 */
export function loadConfig<T>(name: string, expected: ConfigKind, dir: string = CONFIG_DIR): T {
  const path = join(dir, `${name}.json`);
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch { throw new Error(`config not found: ${path}`); }

  let cfg: { type?: unknown };
  try { cfg = JSON.parse(raw); }
  catch (e) { throw new Error(`config ${path} is not valid JSON: ${(e as Error).message}`); }

  if (cfg.type !== expected) {
    throw new Error(`config ${path} has type=${JSON.stringify(cfg.type)}, expected ${JSON.stringify(expected)}`);
  }
  if (expected === 'model' && !(cfg as ModelConfig).model) {
    throw new Error(`config ${path} missing "model"`);
  }
  return cfg as T;
}
