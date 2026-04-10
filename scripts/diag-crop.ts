// Crop a small region of an existing PNG so it can be Read at native resolution
// without auto-downscaling.
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import path from 'path';

const inPath = process.argv[2] ?? 'scripts/dist/frame-bug.png';
const outPath = process.argv[3] ?? 'scripts/dist/diag-crop.png';
const sx = Number(process.argv[4] ?? '500');
const sy = Number(process.argv[5] ?? '300');
const sw = Number(process.argv[6] ?? '200');
const sh = Number(process.argv[7] ?? '200');
const scale = Number(process.argv[8] ?? '4');

const img = await loadImage(path.resolve(inPath));
const out = createCanvas(sw * scale, sh * scale);
const ctx = out.getContext('2d') as unknown as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
ctx.drawImage(img as any, sx, sy, sw, sh, 0, 0, sw * scale, sh * scale);

fs.writeFileSync(path.resolve(outPath), (out as any).toBuffer('image/png'));
console.log(`Wrote ${outPath} (cropped ${sw}x${sh} from ${sx},${sy}, scaled ${scale}x)`);
