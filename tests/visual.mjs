// Screenshot tour of the golden path and every screen. Run: node tests/visual.mjs [desktop|mobile|all] [contrast] [reduced]
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { routeThree } from './three-route.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const URL_BASE = pathToFileURL(path.join(here, '..', 'index.html')).href;
const OUT = path.join(here, 'out', 'visual'); mkdirSync(OUT, { recursive: true });
let chromium;
try { ({ chromium } = await import('playwright')); } catch { const req = createRequire(import.meta.url); ({ chromium } = req(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }
const which = process.argv[2] || 'desktop', flags = process.argv.slice(3);
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }));
const errors = [];
async function tour(tag, viewport, touch) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, reducedMotion: flags.includes('reduced') ? 'reduce' : 'no-preference' });
  await routeThree(ctx, path.join(here, '..'));
  const pg = await ctx.newPage();
  pg.on('pageerror', e => errors.push(tag + ': ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) errors.push(tag + ': ' + m.text()); });
  await pg.goto(URL_BASE + '?debug=1');
  await pg.waitForFunction(() => window.MS && MS.state === 'title');
  await pg.evaluate(f => { MS.seed(21); if (f.includes('contrast')) { MS.S.contrast = true; document.documentElement.classList.add('hc'); } }, flags);
  if (touch) pg.click = (sel, o) => pg.tap(sel, o); // phones tap, so the game stays in touch mode
  const shot = n => pg.screenshot({ path: path.join(OUT, `${tag}-${n}.png`) });
  await pg.waitForTimeout(400); await shot('01-title');
  await pg.click('#btnBegin'); await pg.waitForTimeout(250); await shot('02-route');
  await pg.click('.rnode.avail'); await pg.waitForTimeout(150); await shot('02b-route-selected');
  await pg.click('#goBtn'); await pg.waitForFunction(() => MS.state === 'zone');
  await pg.waitForTimeout(1500); await shot('03-sanctuary');
  // into the corridor, a Hollow held in the lantern
  await pg.evaluate(() => { const G = MS.G, Z = G.Z; MS.teleport((Z.dock.i * 9 + 13) * 32, (Z.dock.j * 9 + 5) * 32); G.debugAim = 0; G.hollows.forEach(h => h.dead = true); const h = MS.spawnHollowAt(G.p.x + 150, G.p.y + 10, 'plain', 0); });
  await pg.waitForTimeout(900); await shot('04-hollow-in-lantern');
  for (const [k, n] of [['2', '05-lens-ember'], ['3', '06-lens-echo'], ['4', '07-lens-survey']]) { await pg.keyboard.press(k); await pg.waitForTimeout(700); await shot(n); await pg.keyboard.press(k); }
  await pg.keyboard.press('b'); await pg.waitForTimeout(350); await shot('08-beacon-placed');
  // the voice: watch the mimic in the Echo lens long enough to note its pulse
  await pg.evaluate(() => { const G = MS.G, m = G.signals.find(s => !s.real); G.hollows.forEach(h => h.dead = true); MS.teleport(m.x - 120, m.y); G.debugAim = 0; });
  await pg.keyboard.press('3'); await pg.waitForTimeout(2600); await shot('09-mimic-suspicion-echo'); await pg.keyboard.press('3');
  await pg.waitForTimeout(500); await shot('10-mimic-ledger-lantern');
  await pg.evaluate(() => { const G = MS.G, m = G.signals.find(s => !s.real); MS.teleport(m.x + 22, m.y); G.debugAim = Math.PI; });
  await pg.keyboard.down('e'); await pg.waitForTimeout(1100); await pg.keyboard.up('e'); await pg.waitForTimeout(250); await shot('11-mimic-reveal');
  await pg.waitForTimeout(900); await shot('11b-mimic-reveal-late');
  // a flare thrown at the real survivor
  await pg.evaluate(() => { const G = MS.G, s = G.signals.find(s => s.real); G.hollows.forEach(h => h.dead = true); MS.teleport(s.x - 140, s.y); G.debugAim = 0; });
  await pg.keyboard.press('f'); await pg.waitForTimeout(650); await shot('12-flare-reveal');
  // low ember, low warmth, late dark
  await pg.evaluate(() => { const G = MS.G; MS.CH.exp.ember = 1; G.p.warmth = 20; G.dim = 0.82; });
  await pg.waitForTimeout(500); await shot('13-low-ember-danger');
  await pg.evaluate(() => { const G = MS.G; G.p.warmth = 100; G.dim = 0.3; MS.CH.exp.ember = 12; MS.teleport(G.sanct.x + 70, G.sanct.y); });
  await pg.waitForTimeout(200); await pg.keyboard.press('e'); await pg.waitForTimeout(300); await shot('14-dock');
  await pg.click('#dockBack'); await pg.keyboard.press('h'); await pg.waitForTimeout(200); await shot('15-field-guide'); await pg.click('#helpBack');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(200); await shot('16-pause'); await pg.click('#pResume');
  await pg.evaluate(() => { MS.teleport(MS.G.sanct.x + 70, MS.G.sanct.y); }); await pg.waitForTimeout(150); await pg.keyboard.press('e'); await pg.click('#dockDepart'); await pg.waitForTimeout(250);
  await shot('17-route-after');
  await pg.evaluate(() => { MS.CH.exp.ember = 0; MS.CH.exp.salvage = 0; });
  await pg.click('#restBtn'); await pg.click('#btnContinue'); await pg.click('#endBtn'); await pg.waitForTimeout(300); await shot('18-debrief');
  await pg.click('#dbChron'); await pg.waitForTimeout(200); await shot('19-chronicle');
  await pg.click('#chronBack'); await pg.click('#dbTitle'); await pg.click('#btnSettings'); await pg.waitForTimeout(200); await shot('20-settings');
  await ctx.close();
}
if (which === 'desktop' || which === 'all') await tour('desk' + (flags.length ? '-' + flags.join('-') : ''), { width: 1280, height: 780 }, false);
if (which === 'mobile' || which === 'all') await tour('mobile' + (flags.length ? '-' + flags.join('-') : ''), { width: 390, height: 844 }, true);
await browser.close();
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
