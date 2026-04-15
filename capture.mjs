import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();

try { await page.goto('http://localhost:3011/', { waitUntil: 'networkidle0', timeout: 8000 }); } catch {}
await new Promise(r => setTimeout(r, 2500));

const probe = await page.evaluate(() => {
  const s = window.__scene;
  if (!s) return { err: 'no scene' };
  return {
    inventoryCount: s.inventory.length,
    inventoryPreview: s.inventory.slice(0, 3).map(i => ({
      bp: i.blueprintId, qty: i.quantity, slot: i.equippedSlot,
    })),
    containerOpen: s.containerEntityId !== null,
    dialogueOpen: s.dialogueNpcId !== null,
    chatCount: s.chatLog.length,
  };
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
