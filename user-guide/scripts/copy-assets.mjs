// Pulls game artifacts into the Docusaurus static dir so they ship inside
// the deployed site (../docs/) at /assets/* and /game/main.js — matching
// the absolute paths the WebGL client hardcodes (see client-webgl/src/ui/
// logo.ts and the rescale-variant-1.html boot pattern).
//
// Sources are not copied at git time; they are regenerated each build from
// ../client-webgl/. Both targets are listed in user-guide/.gitignore.

import { existsSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const userGuideRoot = resolve(__dirname, '..');
const repoRoot = resolve(userGuideRoot, '..');

const assetsSrc = resolve(repoRoot, 'client-webgl', 'assets');
const bundleSrc = resolve(repoRoot, 'client-webgl', 'dist', 'main.js');
const bundleMapSrc = resolve(repoRoot, 'client-webgl', 'dist', 'main.js.map');
const promptSrc = resolve(repoRoot, 'harness', 'config', 'prompt.md');

const assetsDst = resolve(userGuideRoot, 'static', 'assets');
const gameDst = resolve(userGuideRoot, 'static', 'game');
const promptDst = resolve(userGuideRoot, 'static', 'prompt.md');

if (!existsSync(assetsSrc)) {
  console.error(`[copy-assets] missing source: ${assetsSrc}`);
  process.exit(1);
}
if (!existsSync(bundleSrc)) {
  console.error(
    `[copy-assets] missing client bundle: ${bundleSrc}\n` +
    `              run \`npm run build:client-gl\` from the repo root first.`,
  );
  process.exit(1);
}
if (!existsSync(promptSrc)) {
  console.error(`[copy-assets] missing harness prompt: ${promptSrc}`);
  process.exit(1);
}

rmSync(assetsDst, { recursive: true, force: true });
rmSync(gameDst, { recursive: true, force: true });
rmSync(promptDst, { force: true });
mkdirSync(gameDst, { recursive: true });

cpSync(assetsSrc, assetsDst, { recursive: true });
cpSync(bundleSrc, resolve(gameDst, 'main.js'));
if (existsSync(bundleMapSrc)) {
  cpSync(bundleMapSrc, resolve(gameDst, 'main.js.map'));
}
cpSync(promptSrc, promptDst);

console.log(`[copy-assets] assets → ${assetsDst}`);
console.log(`[copy-assets] bundle → ${gameDst}/main.js`);
console.log(`[copy-assets] prompt → ${promptDst}`);
