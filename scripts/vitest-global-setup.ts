import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BUILD_NUMBER_FILE = resolve(process.cwd(), '.build-number');

export default function setup(): void {
  let n = 0;
  try { n = parseInt(readFileSync(BUILD_NUMBER_FILE, 'utf8').trim(), 10) || 0; } catch {}
  n += 1;
  writeFileSync(BUILD_NUMBER_FILE, String(n));
  console.log(`[build #${n}]`);
}
