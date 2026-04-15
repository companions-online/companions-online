import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try { await page.goto('http://localhost:3011/', { waitUntil: 'networkidle0', timeout: 8000 }); } catch {}
await new Promise(r => setTimeout(r, 2500));

const probe = await page.evaluate(() => {
  const s = window.__scene;
  if (!s) return { err: 'no scene — boot failed or hook not set' };
  return {
    myEntityId: s.myEntityId,
    seed: s.seed,
    entityCount: s.entities.size,
    wallChunks: s.wallDrawablesByChunk.size,
    totalWalls: Array.from(s.wallDrawablesByChunk.values()).reduce((a, b) => a + b.length, 0),
    cameraTile: [s.camera.centerTileX, s.camera.centerTileY],
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
