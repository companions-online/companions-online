import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const FRAME_W = 92;
const FRAME_H = 92;
const COLS = 7;  // col 0 = standing, cols 1-6 = walk
const ROWS = 8;  // one per game Direction (N=0 .. NW=7)

// Pixellab frame index → game Direction row
const PL_TO_ROW = [4, 3, 2, 1, 0, 7, 6, 5];
//                  S  SE  E  NE  N  NW  W  SW

// Pixellab direction names (in pixellab frame order)
const PL_DIR_NAMES = [
  'south', 'south-east', 'east', 'north-east',
  'north', 'north-west', 'west', 'south-west',
];

const IMPORT_DIR = path.resolve(import.meta.dirname!, '../assets/import');
const OUTPUT_DIR = path.resolve(import.meta.dirname!, '../client-web/assets');

async function importDeer() {
  const prefix = 'adult_white-tailed_deer_slender_quadruped_standing';
  const rotationsGif = path.join(IMPORT_DIR, `${prefix}_rotations_8dir.gif`);

  const composites: sharp.OverlayOptions[] = [];

  // Standing frames from rotations GIF
  for (let pl = 0; pl < 8; pl++) {
    const row = PL_TO_ROW[pl];
    const buf = await sharp(rotationsGif, { page: pl }).png().toBuffer();
    composites.push({ input: buf, left: 0, top: row * FRAME_H });
  }

  // Walk frames from per-direction GIFs
  for (let pl = 0; pl < 8; pl++) {
    const row = PL_TO_ROW[pl];
    const dirName = PL_DIR_NAMES[pl];
    const walkGif = path.join(IMPORT_DIR, `${prefix}_walk-6-frames_${dirName}.gif`);

    if (!fs.existsSync(walkGif)) {
      // Mirror the opposite direction (E↔W) if available
      const oppositeIdx = dirName === 'west' ? 2 : dirName === 'east' ? 6 : -1;
      if (oppositeIdx >= 0) {
        const oppName = PL_DIR_NAMES[oppositeIdx];
        const oppGif = path.join(IMPORT_DIR, `${prefix}_walk-6-frames_${oppName}.gif`);
        if (fs.existsSync(oppGif)) {
          console.log(`Mirroring ${oppName} → ${dirName}`);
          for (let frame = 0; frame < 6; frame++) {
            const buf = await sharp(oppGif, { page: frame }).flop().png().toBuffer();
            composites.push({ input: buf, left: (frame + 1) * FRAME_W, top: row * FRAME_H });
          }
          continue;
        }
      }
      console.warn(`Missing walk GIF: ${dirName}, skipping`);
      continue;
    }

    for (let frame = 0; frame < 6; frame++) {
      const buf = await sharp(walkGif, { page: frame }).png().toBuffer();
      composites.push({ input: buf, left: (frame + 1) * FRAME_W, top: row * FRAME_H });
    }
  }

  // Compose sprite sheet
  const output = path.join(OUTPUT_DIR, 'deer.png');
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

  console.log(`Sprite sheet: ${COLS * FRAME_W}x${ROWS * FRAME_H} (${COLS}x${ROWS} cells @ ${FRAME_W}x${FRAME_H})`);
  console.log(`Written to: ${output}`);
}

importDeer().catch((e) => { console.error(e); process.exit(1); });
