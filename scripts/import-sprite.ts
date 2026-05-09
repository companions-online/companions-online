import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const FRAME_W = 92;
const FRAME_H = 92;
const COLS = 7;  // col 0 = standing, cols 1-6 = walk
const ROWS = 8;  // one per game Direction (N=0 .. NW=7)
const WALK_FRAMES = 6;

// Pixellab frame index → game Direction row
const PL_TO_ROW = [4, 3, 2, 1, 0, 7, 6, 5];
//                  S  SE  E  NE  N  NW  W  SW

// Pixellab direction names (in pixellab frame order)
const PL_DIR_NAMES = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
] as const;

// Horizontal-mirror fallbacks: if the walk GIF for the key direction is
// missing, flop the value direction's GIF. North/south have no horizontal
// mirror so they're not in this table.
const MIRROR_OPPOSITE: Record<string, string> = {
  'west': 'east',
  'south-west': 'south-east',
  'north-west': 'north-east',
};

const IMPORT_DIR = path.resolve(import.meta.dirname!, '../assets/import');
// Creature sprite sheets land under client-webgl/assets/creatures/. (Other
// asset categories live in sibling sub-folders — see sprite-manifest.ts.)
const OUTPUT_DIR = path.resolve(import.meta.dirname!, '../client-webgl/assets/creatures');

interface CreatureConfig {
  /** Filename prefix shared by the rotations and walk GIFs. */
  prefix: string;
  /** Builds the trailing suffix (incl. leading `_`) for a walk GIF. */
  walkSuffix: (dir: string) => string;
  /** Output PNG filename inside OUTPUT_DIR. */
  outputName: string;
}

async function importCreature(cfg: CreatureConfig) {
  const rotationsGif = path.join(IMPORT_DIR, `${cfg.prefix}_rotations_8dir.gif`);
  const composites: sharp.OverlayOptions[] = [];

  // Standing frames from rotations GIF (one page per pixellab direction).
  // Cache the buffers so we can reuse them as a walk fallback when a
  // direction has no walk GIF and no mirror source.
  const standingBufs: Buffer[] = [];
  for (let pl = 0; pl < 8; pl++) {
    const row = PL_TO_ROW[pl];
    const buf = await sharp(rotationsGif, { page: pl }).png().toBuffer();
    standingBufs.push(buf);
    composites.push({ input: buf, left: 0, top: row * FRAME_H });
  }

  // Walk frames per direction.
  for (let pl = 0; pl < 8; pl++) {
    const row = PL_TO_ROW[pl];
    const dirName = PL_DIR_NAMES[pl];
    const walkGif = path.join(IMPORT_DIR, `${cfg.prefix}${cfg.walkSuffix(dirName)}`);

    if (fs.existsSync(walkGif)) {
      for (let frame = 0; frame < WALK_FRAMES; frame++) {
        const buf = await sharp(walkGif, { page: frame }).png().toBuffer();
        composites.push({ input: buf, left: (frame + 1) * FRAME_W, top: row * FRAME_H });
      }
      continue;
    }

    // Try mirroring the opposite direction horizontally.
    const oppName = MIRROR_OPPOSITE[dirName];
    if (oppName) {
      const oppGif = path.join(IMPORT_DIR, `${cfg.prefix}${cfg.walkSuffix(oppName)}`);
      if (fs.existsSync(oppGif)) {
        console.log(`${cfg.outputName}: mirroring ${oppName} → ${dirName}`);
        for (let frame = 0; frame < WALK_FRAMES; frame++) {
          const buf = await sharp(oppGif, { page: frame }).flop().png().toBuffer();
          composites.push({ input: buf, left: (frame + 1) * FRAME_W, top: row * FRAME_H });
        }
        continue;
      }
    }

    // No walk GIF and no mirror source — repeat the standing frame so the
    // row isn't blank. The creature will appear to walk in place when
    // facing this direction.
    console.warn(`${cfg.outputName}: no walk GIF for ${dirName}, using standing frame`);
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      composites.push({ input: standingBufs[pl], left: (frame + 1) * FRAME_W, top: row * FRAME_H });
    }
  }

  const output = path.join(OUTPUT_DIR, cfg.outputName);
  await sharp({
    create: {
      width: COLS * FRAME_W,
      height: ROWS * FRAME_H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toFile(output);

  console.log(`${cfg.outputName}: ${COLS * FRAME_W}x${ROWS * FRAME_H} (${COLS}x${ROWS} @ ${FRAME_W}x${FRAME_H}) → ${output}`);
}

const CREATURES: Record<string, CreatureConfig> = {
  deer: {
    prefix: 'adult_white-tailed_deer_slender_quadruped_standing',
    walkSuffix: (dir) => `_walk-6-frames_${dir}.gif`,
    outputName: 'deer.png',
  },
  fox: {
    prefix: 'adult_red_fox_slender_quadruped_standing_alert_pos',
    walkSuffix: (dir) => `_walk-6-frames_${dir}.gif`,
    outputName: 'fox.png',
  },
  player: {
    prefix: 'adult_catgirl_adventurer_upright_bipedal_humanoid',
    walkSuffix: (dir) => `_walk_${dir}.gif`,
    outputName: 'player.png',
  },
  rabbit: {
    prefix: 'adult_cottontail_rabbit_small_compact_quadruped_he',
    walkSuffix: (dir) => `_custom-bunny hops on four legs_${dir}.gif`,
    outputName: 'rabbit.png',
  },
  skeleton: {
    prefix: 'humanoid_skeleton_warrior_upright_bipedal_stance_t',
    walkSuffix: (dir) => `_walk_${dir}.gif`,
    outputName: 'skeleton.png',
  },
  wolf: {
    prefix: 'adult_gray_wolf_large_lean_quadruped_standing_aler',
    walkSuffix: (dir) => `_walk-6-frames_${dir}.gif`,
    outputName: 'wolf.png',
  },
};

async function main() {
  const args = process.argv.slice(2);
  const names = args.length > 0 ? args : Object.keys(CREATURES);
  for (const name of names) {
    const cfg = CREATURES[name];
    if (!cfg) {
      console.error(`unknown creature: ${name} (known: ${Object.keys(CREATURES).join(', ')})`);
      process.exit(1);
    }
    await importCreature(cfg);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
