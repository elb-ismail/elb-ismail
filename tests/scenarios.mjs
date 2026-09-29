// Deterministic browser scenarios for The Moving Sanctuary.
// Run: node tests/scenarios.mjs [filter]      (needs Playwright; uses a global install if the project has none)
// Screenshots go to tests/out/ (git-ignored).
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const URL_BASE = pathToFileURL(path.join(root, 'index.html')).href;
const OUT = path.join(here, 'out');
mkdirSync(OUT, { recursive: true });

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { const req = createRequire(import.meta.url); ({ chromium } = req(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

const filter = process.argv[2] || '';
const results = [];
let browser;
async function launch() {
  try { return await chromium.launch(); }
  catch { return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }); }
}
function assert(cond, msg) { if (!cond) throw new Error('assert: ' + msg); }

async function page(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 780 }, hasTouch: !!opts.touch, isMobile: !!opts.touch, reducedMotion: opts.reducedMotion || 'no-preference' });
  const pg = await ctx.newPage();
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) pg.errors.push('console: ' + m.text()); });
  if (opts.storage) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, opts.storage);
  await pg.goto(URL_BASE + '?debug=1' + (opts.hash || ''));
  await pg.waitForFunction(() => window.MS && MS.state === 'title');
  if (opts.seed != null) await pg.evaluate(n => MS.seed(n), opts.seed);
  pg.shot = name => pg.screenshot({ path: path.join(OUT, name + '.png') });
  return pg;
}
async function beginFirstPlace(pg) {
  await pg.click('#btnBegin');
  await pg.click('.rnode.avail');
  await pg.click('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
}
const ev = (pg, type) => pg.evaluate(t => MS.events.filter(e => e.type === t).length, type);
async function toDock(pg) {
  await pg.evaluate(() => { const G = MS.G; MS.teleport(G.sanct.x + 70, G.sanct.y); });
  await pg.waitForTimeout(150);
  await pg.keyboard.press('e');
  await pg.waitForFunction(() => MS.state === 'dock');
}
async function scenario(name, fn, opts) {
  if (filter && !name.includes(filter)) return;
  const pg = await page(opts);
  const t0 = Date.now();
  try {
    await fn(pg);
    assert(pg.errors.length === 0, 'no page errors: ' + pg.errors.join(' | '));
    results.push([name, 'PASS', Date.now() - t0]);
  } catch (e) {
    results.push([name, 'FAIL ' + e.message.split('\n')[0], Date.now() - t0]);
    await pg.shot('FAIL-' + name.replace(/\W+/g, '-')).catch(() => {});
  }
  await pg.context().close();
}

browser = await launch();

/* ---------- Milestone A: golden path and fairness ---------- */
await scenario('start: first place is the staged golden path, facing the open corridor', async pg => {
  await beginFirstPlace(pg);
  const s = await pg.evaluate(() => ({ teach: MS.G.teach, aim: MS.G.face, sig: MS.G.signals.map(s => s.real), east: MS.G.Z.edges.find(e => e.a === MS.G.Z.dockR && e.b === MS.G.Z.dockR + 1).open }));
  assert(s.teach, 'teach zone'); assert(s.east, 'corridor east of the Sanctuary is open'); assert(Math.abs(s.aim) < 0.01, 'Warden faces east');
  assert(s.sig.length === 2 && s.sig[0] === false && s.sig[1] === true, 'mimic nearer, survivor deeper');
  await pg.waitForTimeout(1200);
  const g = await pg.evaluate(() => MS.guide());
  assert(g.cur === 'move', 'movement guidance first, got ' + g.cur);
  await pg.shot('A-golden-start');
}, { seed: 11 });

await scenario('fairness: unlit loot and creatures are not drawn', async pg => {
  await beginFirstPlace(pg);
  await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    const G = MS.G, v = G.view, c = document.getElementById('game'), ctx = c.getContext('2d'), dpr = c.width / innerWidth;
    const lum = (x, y) => { const d = ctx.getImageData(Math.round(x * dpr) - 2, Math.round(y * dpr) - 2, 5, 5).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 4) / 3; };
    const out = [];
    for (const it of G.items) {
      const sx = v.ox + it.x * v.zoom, sy = v.oy + it.y * v.zoom;
      if (it.vis || sx < 40 || sy < 140 || sx > innerWidth - 40 || sy > innerHeight - 90) continue;
      out.push(lum(sx, sy));
    }
    return { n: out.length, max: Math.max(0, ...out), anyVisInDark: G.items.some(i => i.vis && !MS.G.lights.some(l => Math.hypot(l.x - i.x, l.y - i.y) < l.r + 10)) };
  });
  assert(r.n > 0, 'some unlit items on screen to check');
  assert(r.max < 14, 'unlit loot does not show through the dark (max luminance ' + r.max.toFixed(1) + ')');
  assert(!r.anyVisInDark, 'visibility only inside lights');
}, { seed: 11 });

await scenario('rule: a lit doorway and a pinned doorway never change; a changed doorway settles', async pg => {
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z;
    // stand next to a doorway away from the Sanctuary and keep it in the glow
    const k = Z.edges.findIndex(e => e.a !== Z.dockR && e.b !== Z.dockR);
    const c = (e => e.v ? { x: (e.i + 1) * 9 * 32 + 16, y: (e.j * 9 + 5) * 32 } : { x: (e.i * 9 + 5) * 32, y: (e.j + 1) * 9 * 32 + 16 })(Z.edges[k]);
    MS.teleport(c.x - (Z.edges[k].v ? 40 : 0), c.y - (Z.edges[k].v ? 0 : 40));
    MS.update(0.016);
    const before = Z.edges[k].open;
    let changedLit = 0;
    for (let i = 0; i < 400; i++) { MS.update(0.016); if (Z.edges[k].open !== before) changedLit++; }
    // pin it with a beacon, walk far away, force shifts
    G.beacons.push({ x: G.p.x, y: G.p.y, lit: true, c: 1, old: false, placedT: G.t });
    const pinned = MS.doorPinned(k);
    MS.teleport(G.sanct.x + 70, G.sanct.y);
    const b2 = Z.edges[k].open; let changedPinned = 0;
    for (let i = 0; i < 300; i++) { G.t += 0.5; MS.tryShift(); if (Z.edges[k].open !== b2) changedPinned++; }
    // settle rule: any doorway that changed cannot change again for 18 s
    G.beacons.pop();
    let reroll = 0, changes = 0;
    const last = {};
    for (let i = 0; i < 600; i++) {
      G.t += 0.25; const snap = Z.edges.map(e => e.open); MS.tryShift();
      Z.edges.forEach((e, j) => { if (e.open !== snap[j]) { changes++; if (last[j] != null && G.t - last[j] < 18) reroll++; last[j] = G.t; } });
    }
    return { changedLit, pinned, changedPinned, reroll, changes };
  });
  assert(r.changedLit === 0, 'a doorway in your light never changed');
  assert(r.pinned && r.changedPinned === 0, 'a beacon-pinned doorway never changed');
  assert(r.changes > 5 && r.reroll === 0, `doorways change when unlit (${r.changes}) but never reroll within 18 s (${r.reroll})`);
}, { seed: 12 });

await scenario('looking away: a watched doorway can change, discovery is guided and logged as intentional', async pg => {
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z;
    const dc = k => { const e = Z.edges[k]; return e.v ? { x: (e.i + 1) * 288 + 16, y: (e.j * 9 + 5) * 32 } : { x: (e.i * 9 + 5) * 32, y: (e.j + 1) * 288 + 16 }; };
    const rc = r => ({ x: (r % Z.RW * 9 + 5) * 32, y: (Math.floor(r / Z.RW) * 9 + 5) * 32 });
    // watch a closed doorway from inside its room, then turn away and gamble on it opening
    const targets = Z.edges.map((e, k) => k).filter(k => !Z.edges[k].open && Z.edges[k].a !== Z.dockR && Z.edges[k].b !== Z.dockR);
    let changed = -1, cx = 0, cy = 0;
    for (const k of targets.slice(0, 4)) {
      const room = Z.edges[k].a, c = dc(k); ({ x: cx, y: cy } = rc(room));
      for (let round = 0; round < 4 && changed < 0; round++) {
        MS.teleport(cx, cy); G.debugAim = Math.atan2(c.y - cy, c.x - cx); MS.update(0.05);
        const was = G.mem[k];
        G.debugAim += Math.PI;   // look away
        for (let i = 0; i < 220 && changed < 0; i++) { MS.update(0.05); G.hollows.forEach(h => h.dead = true); if (Z.edges[k].open !== (was === 1)) changed = k; }
      }
      if (changed >= 0) break;
    }
    if (changed < 0) return { changed };
    const e = Z.edges[changed], c = e.v ? { x: (e.i + 1) * 288 + 16, y: (e.j * 9 + 5) * 32 } : { x: (e.i * 9 + 5) * 32, y: (e.j + 1) * 288 + 16 };
    MS.teleport(cx, cy); G.hollows.forEach(h => h.dead = true);
    G.debugAim = Math.atan2(c.y - cy, c.x - cx);
    for (let i = 0; i < 5; i++) MS.update(0.05);
    return { changed, manip: MS.CH.exp.stats.manipulations || 0, disc: MS.events.filter(e => e.type === 'doorDiscovered').length };
  });
  assert(r.changed >= 0, 'a doorway changed after looking away');
  assert(r.disc >= 1, 'looking back discovers the change');
  assert(r.manip >= 1, 'recorded as an intentional route manipulation');
  await pg.waitForTimeout(300);
  const g = await pg.evaluate(() => MS.guide());
  assert(g.cur === 'door' || g.done.includes('door'), 'door guidance responds, got ' + g.cur);
  await pg.shot('A-door-discovered');
}, { seed: 13 });

await scenario('order: leave immediately; nothing stuck, nothing falsely recorded', async pg => {
  await beginFirstPlace(pg);
  await toDock(pg);
  const five = await pg.$$eval('#dockPanel section.q h3', hs => hs.map(h => h.textContent));
  assert(five.length === 5, 'dock answers the five questions: ' + five.join(' / '));
  await pg.shot('A-dock-five');
  await pg.click('#dockDepart');
  await pg.waitForFunction(() => MS.state === 'route');
  const st = await pg.evaluate(() => MS.CH.exp.stats);
  assert(st.abandoned === 0, 'unheard voices are not counted as abandoned');
  assert(st.zones === 1, 'departure recorded');
}, { seed: 14 });

await scenario('order: ignore the voice and walk into the mimic untested; reveal cites no invented clues', async pg => {
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const G = MS.G, m = G.signals.find(s => !s.real);
    G.hollows.forEach(h => h.dead = true);
    MS.teleport(m.x + 20, m.y); G.debugAim = 0;   // face away: no light on it long enough to read its pulse
    return true;
  });
  await pg.keyboard.down('e'); await pg.waitForTimeout(1300); await pg.keyboard.up('e');
  const cue = await pg.evaluate(() => MS.CH.exp.stats.mimicCues[0]);
  assert(cue && cue.how === 'touch', 'mimic revealed by touch');
  assert(cue.cues.rhythm === false && cue.cues.drift === false, 'no clue recorded that was not observed: ' + JSON.stringify(cue.cues));
  const logs = await pg.evaluate(() => MS.G.logs.map(l => l.text).join(' | '));
  assert(/had not checked its pulse/.test(logs), 'reveal tells you what you did not check');
}, { seed: 15 });

await scenario('order: flare the voice first, before any lens; mimic exposed, guidance moves on', async pg => {
  await beginFirstPlace(pg);
  const pos = await pg.evaluate(() => { const G = MS.G, m = G.signals.find(s => !s.real); MS.teleport(m.x - 150, m.y); G.debugAim = 0; MS.update(0.02); const v = G.view; return [v.ox + m.x * v.zoom, v.oy + m.y * v.zoom]; });
  await pg.mouse.move(pos[0], pos[1]);
  await pg.waitForTimeout(80);
  await pg.keyboard.press('f');
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => ({ exposed: MS.CH.exp.stats.mimicsExposed, res: MS.CH.exp.stats.flareResults, flares: MS.G.p.flares }));
  assert(r.exposed === 1, 'flare exposed the mimic');
  assert(r.res && r.res[0] === 'exposed a mimic', 'flare result recorded: ' + JSON.stringify(r.res));
  await pg.waitForTimeout(600);
  const g = await pg.evaluate(() => MS.guide());
  assert(g.cur !== 'voice', 'voice guidance does not linger after the test');
}, { seed: 16 });

await scenario('order: plant a beacon before being told; guidance acknowledges instead of asking', async pg => {
  await beginFirstPlace(pg);
  await pg.keyboard.press('b');
  await pg.waitForTimeout(200);
  const g = await pg.evaluate(() => ({ ...MS.guide(), placed: MS.CH.exp.stats.beaconsPlaced }));
  assert(g.placed === 1, 'beacon placed');
  assert(g.done.includes('beacon'), 'beacon lesson marked understood');
  assert(/Pinned/.test(g.ack || ''), 'acknowledgement shown: ' + g.ack);
}, { seed: 17 });

await scenario('fall: pack drops where you fell, crew scarred, guidance points to the pack, recovery works', async pg => {
  await beginFirstPlace(pg);
  await pg.evaluate(() => { const G = MS.G; G.p.carryE = 7; G.p.warmth = 5; G.p.hurtT = 0; MS.teleport(G.sanct.x + 300, G.sanct.y + 10); G.debugAim = 0; const h = MS.spawnHollowAt(G.p.x - 14, G.p.y, 'plain', 0); });
  await pg.waitForFunction(() => MS.G && MS.G.fallDone && MS.G.fallT <= 0, null, { timeout: 5000 });
  const r = await pg.evaluate(() => ({ pack: MS.G.items.find(i => i.kind === 'pack'), scars: MS.CH.crew.map(c => c.scars), guide: MS.guide().cur }));
  assert(r.pack && r.pack.e === 7, 'pack with 7 ember lies where you fell');
  assert(r.scars.includes(1), 'a crew member is scarred');
  assert(r.guide === 'carried', 'guidance explains the changed situation, got ' + r.guide);
  await pg.shot('A-after-fall');
  await pg.evaluate(() => { const p = MS.G.items.find(i => i.kind === 'pack'); MS.G.hollows.forEach(h => h.dead = true); MS.teleport(p.x + 16, p.y); });
  await pg.keyboard.down('e'); await pg.waitForTimeout(700); await pg.keyboard.up('e');
  const back = await pg.evaluate(() => ({ carry: MS.G.p.carryE, rec: MS.CH.exp.stats.packRecovered }));
  assert(back.carry === 7 && back.rec === 1, 'pack recovered');
}, { seed: 18 });

await scenario('return later: lessons persist across crossings; the second visit is not a tutorial', async pg => {
  await beginFirstPlace(pg);
  await pg.keyboard.press('b');
  await pg.waitForTimeout(1500);
  await toDock(pg); await pg.click('#dockDepart');
  // walk the rest of the crossing fast
  for (let i = 0; i < 6; i++) {
    const st = await pg.evaluate(() => MS.state);
    if (st === 'debrief') break;
    await pg.evaluate(() => { MS.CH.exp.ember += 40; });
    await pg.click('#restBtn'); await pg.click('#btnContinue');   // stopping and resuming mid-crossing
    await pg.click('.rnode.avail'); await pg.click('#goBtn');
    await pg.waitForFunction(() => MS.state === 'zone' || MS.state === 'debrief');
    if (await pg.evaluate(() => MS.state) === 'zone') { await toDock(pg); await pg.click('#dockDepart'); }
  }
  assert(await pg.evaluate(() => MS.state) === 'debrief', 'crossing completed');
  await pg.click('#dbNext');
  await pg.click('.rnode.avail'); await pg.click('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  const r = await pg.evaluate(() => ({ teach: MS.G.teach, done: MS.guide().done, crossing: MS.CH.crossings }));
  assert(r.crossing === 2 && !r.teach, 'second crossing is not staged');
  assert(r.done.includes('beacon'), 'learned lessons persist: ' + r.done.join(','));
}, { seed: 19 });

await browser.close();
const fails = results.filter(r => !r[1].startsWith('PASS'));
for (const [n, s, ms] of results) console.log(`${s.startsWith('PASS') ? 'ok  ' : 'FAIL'}  ${n}  (${ms} ms)${s.startsWith('PASS') ? '' : '\n      ' + s}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
