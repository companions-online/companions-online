import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNewWorld, saveWorld, loadWorld } from '../server/src/world-persistence.js';
import { TICKS_PER_GAME_HOUR } from '@shared/constants.js';

describe('World persistence: tickOffset', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const d of tempDirs) {
      await rm(d, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'cotest-'));
    tempDirs.push(dir);
    return dir;
  }

  it('round-trips tickOffset through save + load', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);
    world.setTickOffset(3 * TICKS_PER_GAME_HOUR + 15);
    await saveWorld(world, worldDir, meta);

    const reloaded = await loadWorld(worldDir);
    expect(reloaded.world.tickOffset).toBe(3 * TICKS_PER_GAME_HOUR + 15);
    expect(reloaded.meta.tickOffset).toBe(3 * TICKS_PER_GAME_HOUR + 15);
  });

  it('loads legacy saves (no tickOffset field) as offset 0', async () => {
    const dir = await makeTempDir();
    const { world, meta, worldDir } = await createNewWorld(42, dir);
    // Simulate a pre-lighting save by stripping the field.
    const legacyMeta = { ...meta, tickOffset: undefined };
    delete (legacyMeta as { tickOffset?: number }).tickOffset;
    await saveWorld(world, worldDir, legacyMeta);
    // Overwrite meta.json without the field by re-saving; saveWorld above
    // would have set tickOffset from world, so manually re-write instead.
    const { writeFile } = await import('node:fs/promises');
    const stripped: { [k: string]: unknown } = { ...legacyMeta };
    delete stripped.tickOffset;
    await writeFile(join(worldDir, 'meta.json'), JSON.stringify(stripped, null, 2));

    const reloaded = await loadWorld(worldDir);
    expect(reloaded.world.tickOffset).toBe(0);
  });
});
