import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHARACTERS_DIR } from './paths.js';
import type { ModelConfig } from './config.js';

export type HarnessVariant = 'baseline' | 'compact' | 'shortened' | 'incremental-compaction';

export interface Character {
  /** Resolves to `harness/characters/<prompt>.md` (or `harness/config/<prompt>.md`). */
  prompt: string;
  /** History-management strategy. The CLI maps this to the variant's run* function. */
  harness: HarnessVariant;
  /** Inlined model config — same shape as `harness/config/<model>.json`. */
  model: ModelConfig;
}

const VARIANTS: ReadonlySet<HarnessVariant> = new Set(['baseline', 'compact', 'shortened', 'incremental-compaction']);

/** Default location: `harness/characters/config.json`. */
export function defaultCharactersConfigPath(): string {
  return join(CHARACTERS_DIR, 'config.json');
}

export function loadCharactersConfig(path: string = defaultCharactersConfigPath()): Character[] {
  let raw: string;
  try { raw = readFileSync(path, 'utf8'); }
  catch { throw new Error(`characters config not found: ${path}`); }

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error(`characters config ${path} is not valid JSON: ${(e as Error).message}`); }

  if (!Array.isArray(parsed)) {
    throw new Error(`characters config ${path} must be a JSON array`);
  }

  return parsed.map((entry, i) => validateCharacter(entry, i, path));
}

function validateCharacter(entry: unknown, i: number, path: string): Character {
  const where = `${path}[${i}]`;
  if (!entry || typeof entry !== 'object') throw new Error(`${where}: must be an object`);
  const e = entry as Record<string, unknown>;

  if (typeof e.prompt !== 'string' || !e.prompt) {
    throw new Error(`${where}: "prompt" must be a non-empty string`);
  }
  if (typeof e.harness !== 'string' || !VARIANTS.has(e.harness as HarnessVariant)) {
    throw new Error(`${where}: "harness" must be one of ${[...VARIANTS].join('|')}`);
  }
  if (!e.model || typeof e.model !== 'object') {
    throw new Error(`${where}: "model" must be an object (inlined ModelConfig)`);
  }
  const m = e.model as Record<string, unknown>;
  if (m.type !== 'model') {
    throw new Error(`${where}: "model.type" must be "model"`);
  }
  if (typeof m.model !== 'string' || !m.model) {
    throw new Error(`${where}: "model.model" must be a non-empty string`);
  }

  return {
    prompt: e.prompt,
    harness: e.harness as HarnessVariant,
    model: e.model as ModelConfig,
  };
}
