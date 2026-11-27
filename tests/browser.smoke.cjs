// Browser smoke test: loads the game from disk (no server), plays on desktop and phone viewports,
// reports page errors and writes screenshots. Usage: node tests/browser.smoke.cjs <outDir>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://game.test';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

async function serveFromDisk(ctx) {
  await ctx.route(`${ORIGIN}/**`, (route) => {
    const u = new URL(route.request().url());
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
}

// Test helper: let the built-in AI drive the human slot for a while so the screenshot shows a developed base.
async function autoplay(page, ms) {
  await page.evaluate(() => { const g = window.__game; g.world.players[g.me].ai = true; g.world.players[g.me].difficulty = 'hard'; g.speed = 12; });
  await page.waitForTimeout(ms);
  return page.evaluate(() => {
    const g = window.__game, w = g.world;
    g.speed = 1; w.players[g.me].ai = false;
    g.controller.centerOnBase(); g.controller.selectAllArmy();
    return { time: Math.round(w.time), buildings: w.buildings.filter((x) => x.owner === g.me).length, units: w.units.filter((x) => x.owner === g.me).length, fps: g.fps };
  });
}

(async () => {
  const out = process.argv[2] || path.join(ROOT, 'tests', 'shots');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const errs = [];
  const watch = (p, tag) => {
    p.on('pageerror', (e) => errs.push(`${tag} pageerror: ${e.message}\n${e.stack}`));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(`${tag} console: ${m.text()}`); });
  };

  // ---- Desktop ----
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  await serveFromDisk(ctx);
  const p = await ctx.newPage(); watch(p, 'desktop');
  await p.goto(`${ORIGIN}/index.html?nosw`);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/01-menu.png` });
  await p.click('[data-go="skirmish"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/02-setup.png` });
  await p.click('#btn-start');
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/03-start.png` });
  await p.keyboard.press('d'); // deploy crawler
  await p.waitForTimeout(1600);
  const first = await p.$('#build-grid .bi');
  if (first) await first.click();
  await p.evaluate(() => { window.__game.speed = 8; });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: `${out}/04-building.png` });
  console.log('desktop', JSON.stringify(await autoplay(p, 25000)));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/05-base.png` });
  await p.click('#sb-tabs .tab[data-cat="vehicle"]');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/06-vehicles.png` });
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/07-pause.png` });
  await p.click('#p-save'); // saves and resumes
  await p.waitForTimeout(300);
  await p.click('#btn-menu');
  await p.click('#p-load');
  await p.waitForTimeout(500);
  console.log('after load', await p.evaluate(() => Math.round(window.__game.world.time)));

  // ---- Phone (landscape) ----
  const m = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
  await serveFromDisk(m);
  const mp = await m.newPage(); watch(mp, 'phone');
  await mp.goto(`${ORIGIN}/index.html?nosw`);
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: `${out}/08-phone-menu.png` });
  await mp.tap('[data-go="skirmish"]');
  await mp.tap('#btn-start');
  await mp.waitForTimeout(800);
  // tap the crawler twice to deploy (select, then tap again)
  const pos = await mp.evaluate(() => { const g = window.__game; const u = g.world.units.find((x) => x.owner === g.me); const [sx, sy] = g.renderer.worldToScreen(u.x, u.y); return { sx, sy }; });
  await mp.touchscreen.tap(pos.sx, pos.sy);
  await mp.waitForTimeout(150);
  await mp.touchscreen.tap(pos.sx, pos.sy);
  await mp.waitForTimeout(600);
  console.log('phone deployed hq:', await mp.evaluate(() => { const g = window.__game; return g.world.buildings.some((b) => b.owner === g.me && b.type === 'hq'); }));
  console.log('phone', JSON.stringify(await autoplay(mp, 20000)));
  await mp.waitForTimeout(600);
  await mp.screenshot({ path: `${out}/09-phone-game.png` });
  // ---- Phone (portrait) ----
  const pc = await b.newContext({ ...devices['iPhone 13'] });
  await serveFromDisk(pc);
  const pp = await pc.newPage(); watch(pp, 'portrait');
  await pp.goto(`${ORIGIN}/index.html?nosw`);
  await pp.tap('[data-go="skirmish"]');
  await pp.tap('#btn-start');
  await pp.waitForTimeout(500);
  console.log('portrait', JSON.stringify(await autoplay(pp, 8000)));
  await pp.waitForTimeout(500);
  await pp.screenshot({ path: `${out}/10-phone-portrait.png` });

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'No page errors.');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
