// Import a Pixellab v2 character export into the game's sprite-sheet layout.
//
// Expects an export directory at `assets/<variant>/` containing:
//   - metadata.json       (size, directions, frames map)
//   - rotations/<dir>.png (one per direction, the standing pose)
//   - animations/<animName>/<dir>/frame_NNN.png (per-direction walk frames)
//
// Output sheet (matches existing creature sheets):
//   - cols = 1 standing + N walk frames
//   - rows = 8 directions in game order: N, NE, E, SE, S, SW, W, NW
//
// Usage:
//   tsx scripts/import-character.ts <variant-dir> <output-name> [animation-name]
//   e.g. tsx scripts/import-character.ts beastkin player-4.png

import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

// Game Direction order: row 0 = N, row 1 = NE, ... row 7 = NW.
const DIR_TO_ROW: Record<string, number> = {
  'north': 0,
  'north-east': 1,
  'east': 2,
  'south-east': 3,
  'south': 4,
  'south-west': 5,
  'west': 6,
  'north-west': 7,
};

interface Metadata {
  character: {
    size: { width: number; height: number };
    directions: number;
  };
  frames: {
    rotations: Record<string, string>;
    animations: Record<string, Record<string, string[]>>;
  };
}

const ASSETS_DIR = path.resolve(import.meta.dirname!, '../assets');
const OUTPUT_DIR = path.resolve(import.meta.dirname!, '../client-webgl/assets/creatures');

async function importCharacter(variantDir: string, outputName: string, animationName?: string) {
  const root = path.join(ASSETS_DIR, variantDir);
  const meta: Metadata = JSON.parse(fs.readFileSync(path.join(root, 'metadata.json'), 'utf8'));

  const FRAME_W = meta.character.size.width;
  const FRAME_H = meta.character.size.height;

  const anims = meta.frames.animations ?? {};
  const animKeys = Object.keys(anims);
  const chosenName = animationName ?? animKeys[0];
  const anim = chosenName ? anims[chosenName] : undefined;
  if (chosenName && !anim) {
    throw new Error(`animation "${chosenName}" not found in ${variantDir}; available: ${animKeys.join(', ') || '(none)'}`);
  }

  // Walk frame count comes from whichever direction the animation provides;
  // assume all directions in a single animation have the same length.
  const walkFrames = anim ? (Object.values(anim)[0]?.length ?? 0) : 0;
  const COLS = 1 + walkFrames;
  const ROWS = 8;

  const composites: sharp.OverlayOptions[] = [];

  for (const [dir, row] of Object.entries(DIR_TO_ROW)) {
    const rotRel = meta.frames.rotations[dir];
    if (!rotRel) {
      console.warn(`${outputName}: no rotation for ${dir}, skipping row`);
      continue;
    }
    const rotBuf = fs.readFileSync(path.join(root, rotRel));
    composites.push({ input: rotBuf, left: 0, top: row * FRAME_H });

    if (!anim) continue;

    const frames = anim[dir];
    if (!frames || frames.length === 0) {
      console.warn(`${outputName}: animation "${chosenName}" missing ${dir}, repeating standing frame`);
      for (let f = 0; f < walkFrames; f++) {
        composites.push({ input: rotBuf, left: (f + 1) * FRAME_W, top: row * FRAME_H });
      }
      continue;
    }
    for (let f = 0; f < frames.length; f++) {
      const buf = fs.readFileSync(path.join(root, frames[f]));
      composites.push({ input: buf, left: (f + 1) * FRAME_W, top: row * FRAME_H });
    }
  }

  const output = path.join(OUTPUT_DIR, outputName);
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

  console.log(`${outputName}: ${COLS * FRAME_W}x${ROWS * FRAME_H} (${COLS}x${ROWS} @ ${FRAME_W}x${FRAME_H}, anim=${chosenName ?? 'none'}) → ${output}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('usage: tsx scripts/import-character.ts <variant-dir> <output-name> [animation-name]');
    process.exit(1);
  }
  const [variantDir, outputName, animationName] = args;
  await importCharacter(variantDir, outputName, animationName);
}

main().catch((e) => { console.error(e); process.exit(1); });
