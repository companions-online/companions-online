// Render one frame of the client-webgl prototype to a PNG.
//
// Strategy: spin up esbuild's dev server (same config as client-webgl/dev.ts)
// on an auto-assigned port, launch headless Chromium via puppeteer with
// WebGL2+SwiftShader enabled, wait for the first render, screenshot the
// canvas, resize to max 200px wide via sharp, and save.
//
// WebGL2 in headless Chromium requires the new headless mode plus ANGLE's
// SwiftShader backend — the default `--use-gl=swiftshader` gives WebGL1 only,
// so we pass `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader`.

import * as esbuild from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..', 'client-webgl');
const REPO_ROOT = path.resolve(__dirname, '..');

const outputPath = process.argv[2]
  ?? path.resolve(__dirname, 'dist', 'gl-frame.png');
const MAX_WIDTH = Number(process.argv[3] ?? '200');
const WAIT_MS = Number(process.argv[4] ?? '1500');
const CANVAS_W = 1600;
const CANVAS_H = 900;

// --- Build server --------------------------------------------------------
// Mirrors client-webgl/dev.ts — same esbuild config + @shared alias plugin.
const ctx = await esbuild.context({
  entryPoints: [path.resolve(CLIENT_ROOT, 'src/main.ts')],
  bundle: true,
  outdir: path.resolve(CLIENT_ROOT, 'dist'),
  sourcemap: true,
  format: 'esm',
  logLevel: 'error',
  plugins: [{
    name: 'shared-alias',
    setup(build) {
      build.onResolve({ filter: /^@shared\// }, (args) => {
        const rel = args.path.slice('@shared/'.length).replace(/\.js$/, '');
        return { path: path.resolve(REPO_ROOT, 'shared', 'src', rel + '.ts') };
      });
    },
  }],
});

const { port } = await ctx.serve({
  servedir: CLIENT_ROOT,
  port: 0, // let esbuild pick any free port
});

const url = `http://127.0.0.1:${port}/index.html`;
console.log(`[render-gl] serving ${url}`);

// --- Launch Chromium -----------------------------------------------------
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--headless=new',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--no-sandbox',
    `--window-size=${CANVAS_W},${CANVAS_H}`,
  ],
  defaultViewport: { width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 1 },
});

try {
  const page = await browser.newPage();

  // Surface any browser-side errors so render failures aren't silent.
  page.on('pageerror', (err) => console.error('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    console.error(`[browser ${msg.type()}]`, msg.text());
  });
  page.on('requestfailed', (req) => {
    console.error('[browser requestfailed]', req.url(), req.failure()?.errorText);
  });

  await page.goto(url, { waitUntil: 'load' });

  // Probe canvas state after the wait so we know if the first frame actually
  // landed (toDataURL on an empty 2D-context canvas returns a tiny all-white
  // PNG, and we'd silently save it otherwise).
  const probe = await page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement | null;
    if (!c) return { ok: false, reason: 'no canvas element' };
    return {
      ok: true,
      width: c.width,
      height: c.height,
      hasWebGL2: !!c.getContext('webgl2'),
    };
  });
  console.log('[render-gl] canvas probe:', probe);

  // Give the scene time to upload textures + run a few RAF frames. The scene
  // factory is fully async (world-gen + texture array uploads + instance
  // buffer generation) so we wait a generous amount by default.
  await new Promise((resolve) => setTimeout(resolve, WAIT_MS));

  // Screenshot the canvas via the compositor rather than `toDataURL`, which
  // returns an empty image for WebGL contexts created without
  // `preserveDrawingBuffer: true` (the framebuffer is discarded after each
  // present). `elementHandle.screenshot()` captures the composited output,
  // which always has pixels.
  const canvasHandle = await page.$('#game');
  if (!canvasHandle) throw new Error('canvas #game not found');
  const pngBytes = await canvasHandle.screenshot({ type: 'png', omitBackground: false });

  // --- Resize to max MAX_WIDTH wide -------------------------------------
  const resized = await sharp(pngBytes)
    .resize({ width: MAX_WIDTH, withoutEnlargement: false })
    .png()
    .toBuffer();

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, resized);

  console.log(`[render-gl] wrote ${outputPath} (${resized.length} bytes)`);
} finally {
  await browser.close();
  await ctx.dispose();
}
