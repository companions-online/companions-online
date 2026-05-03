import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadCharactersConfig } from '../../helpers/characters-config.js';

let tmpDirs: string[] = [];

afterEach(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
  tmpDirs = [];
});

function writeConfig(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'chars-config-'));
  tmpDirs.push(dir);
  const file = join(dir, 'config.json');
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

const okModel = { type: 'model', model: 'google/gemma-4-31b-it' };

describe('loadCharactersConfig', () => {
  it('loads + validates a happy path config', () => {
    const path = writeConfig([
      { prompt: 'princess', harness: 'baseline', model: okModel },
      { prompt: 'hunter', harness: 'compact', model: okModel },
    ]);
    const chars = loadCharactersConfig(path);
    expect(chars.length).toBe(2);
    expect(chars[0]).toMatchObject({ prompt: 'princess', harness: 'baseline' });
    expect(chars[1]).toMatchObject({ prompt: 'hunter', harness: 'compact' });
  });

  it('throws when the file is missing', () => {
    expect(() => loadCharactersConfig('/nope/missing.json')).toThrow(/not found/);
  });

  it('throws on malformed JSON', () => {
    const path = writeConfig('{ not json');
    expect(() => loadCharactersConfig(path)).toThrow(/not valid JSON/);
  });

  it('throws when the root is not an array', () => {
    const path = writeConfig({ prompt: 'x' });
    expect(() => loadCharactersConfig(path)).toThrow(/JSON array/);
  });

  it('throws on missing prompt', () => {
    const path = writeConfig([{ harness: 'baseline', model: okModel }]);
    expect(() => loadCharactersConfig(path)).toThrow(/"prompt"/);
  });

  it('throws on bad harness name', () => {
    const path = writeConfig([{ prompt: 'p', harness: 'bogus', model: okModel }]);
    expect(() => loadCharactersConfig(path)).toThrow(/"harness"/);
  });

  it('throws when model.type is wrong', () => {
    const path = writeConfig([
      { prompt: 'p', harness: 'baseline', model: { type: 'eval', model: 'x' } },
    ]);
    expect(() => loadCharactersConfig(path)).toThrow(/model\.type/);
  });

  it('throws when model.model is empty', () => {
    const path = writeConfig([
      { prompt: 'p', harness: 'baseline', model: { type: 'model' } },
    ]);
    expect(() => loadCharactersConfig(path)).toThrow(/model\.model/);
  });
});
