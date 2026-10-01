// Deterministic browser scenarios for The Moving Sanctuary.
// Run: node tests/scenarios.mjs [filter]      (needs Playwright; uses a global install if the project has none)
// Screenshots go to tests/out/ (git-ignored).
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import { routeThree } from './three-route.mjs';

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
  await routeThree(ctx, root);
  const pg = await ctx.newPage();
  pg.errors = []; pg.warnings = [];
  pg.on('console', m => { if (m.type() === 'warning') pg.warnings.push(m.text()); });
  pg.on('pageerror', e => pg.errors.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) pg.errors.push('console: ' + m.text()); });
  if (opts.storage) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, opts.storage);
  await pg.goto(URL_BASE + '?debug=1' + (opts.query || '') + (opts.hash || ''));
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
  const pos = await pg.evaluate(() => {
    // stand 150 px from the mimic with a clear line to it (it may have drifted since generation), facing it
    const G = MS.G, Z = G.Z, m = G.signals.find(s => !s.real), wall = (x, y) => Z.wall[Math.floor(x / 32) + Math.floor(y / 32) * Z.GW] === 1;
    const clear = (x, y) => { for (let t = 0; t <= 1; t += 0.02) if (wall(x + (m.x - x) * t, y + (m.y - y) * t)) return false; return true; };
    let a = Math.PI;
    for (let i = 0; i < 16; i++) { const b = Math.PI + i * Math.PI / 8, x = m.x + Math.cos(b) * 150, y = m.y + Math.sin(b) * 150; if (clear(x, y)) { a = b; break; } }
    MS.teleport(m.x + Math.cos(a) * 150, m.y + Math.sin(a) * 150); G.debugAim = a + Math.PI; MS.update(0.02);
    const v = G.view; return [v.ox + m.x * v.zoom, v.oy + m.y * v.zoom];
  });
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
  await pg.evaluate(() => { const p = MS.G.items.find(i => i.kind === 'pack'); MS.G.hollows.forEach(h => h.dead = true); MS.teleport(p.x, p.y + 1); });
  await pg.keyboard.down('e'); await pg.waitForTimeout(700); await pg.keyboard.up('e');
  const back = await pg.evaluate(() => ({ carry: MS.G.p.carryE, rec: MS.CH.exp.stats.packRecovered, target: MS.G.target && MS.G.target.kind, fall: MS.G.fallT, warm: MS.G.p.warmth, state: MS.state }));
  assert(back.carry >= 7 && back.rec === 1, 'pack recovered: ' + JSON.stringify(back));
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

await scenario('streams: sound, render jitter and particles never change what the simulation rolls', async pg => {
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const id = MS.G.node.id;
    const run = disturb => {
      MS.seed(77); MS.enterZone(id);
      const G = MS.G; G.debugAim = 0.6;
      for (let i = 0; i < 900; i++) {
        MS.update(1 / 30);
        if (i % 120 === 60) MS.emit('flareBurst', { f: { x: G.p.x, y: G.p.y }, result: {} });   // sound + particles
        disturb();
      }
      return JSON.stringify({ doors: G.Z.edges.map(e => e.open ? 1 : 0).join(''), hollows: G.hollows.map(h => [Math.round(h.x), Math.round(h.y), h.kind]), sig: G.signals.map(s => [Math.round(s.x), Math.round(s.y)]), dim: G.dim.toFixed(4), shiftT: G.shiftT.toFixed(4) });
    };
    const quiet = run(() => {});
    const noisy = run(() => { for (let k = 0; k < 40; k++) { MS.rng.audio(); MS.rng.visual(); MS.rng.cosmetic(); } });
    const control = run(() => { Math.random(); });
    return { same: quiet === noisy, controlDiffers: quiet !== control };
  });
  assert(r.controlDiffers, 'control: consuming the simulation stream does change the outcome (the check is sensitive)');
  assert(r.same, 'consuming the audio, visual and cosmetic streams leaves the simulation identical');
}, { seed: 23 });

/* ---------- 3D migration ---------- */
await scenario('3d step 1: Three.js loads on demand, WebGL2 draws the room under the 2D HUD layer', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  assert(await pg.evaluate(() => MS.r3) === 'ready', '3D renderer ready: ' + await pg.evaluate(() => MS.r3Error));
  await beginFirstPlace(pg);
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const c3 = document.getElementById('game3d'), c2 = document.getElementById('game');
    const order = c3.compareDocumentPosition(c2) & Node.DOCUMENT_POSITION_FOLLOWING;   // 2D canvas paints over the 3D one
    const gl = c3.getContext('webgl2'), px = new Uint8Array(4);
    return { order: !!order, webgl2: !!gl, w: c3.width, h: c3.height, bg2d: getComputedStyle(c2).backgroundColor };
  });
  assert(r.webgl2 && r.w > 0 && r.h > 0, 'WebGL2 canvas sized: ' + JSON.stringify(r));
  assert(r.order, 'the 2D HUD canvas sits above the 3D world canvas');
  assert(/rgba\(0, 0, 0, 0\)|transparent/.test(r.bg2d), '2D layer is transparent over the world: ' + r.bg2d);
  await pg.shot('3D-step1-graybox');
  const three = pg.warnings.filter(w => /THREE\./.test(w));
  assert(three.length === 0, 'no Three.js warnings (e.g. the removed PCFSoftShadowMap): ' + three.join(' | '));
}, { query: '&r3d=1', seed: 11 });

await scenario('3d step 2: doorways show the truth only while lit; otherwise the Warden\'s memory, or nothing', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  await pg.waitForTimeout(400);
  const r = await pg.evaluate(async () => {
    const G = MS.G, Z = G.Z, frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await frame();
    let doors = MS.r3Doors();
    const litWrong = doors.filter(d => G.t - G.doorSeenT[d.k] < 0.05 && (d.shown !== (Z.edges[d.k].open ? 'open' : 'closed') || d.slab !== !Z.edges[d.k].open));
    // pick a doorway far from any light and plant a false memory of it
    const far = Z.edges.map((e, k) => k).filter(k => G.t - G.doorSeenT[k] > 1 && !MS.doorPinned(k));
    const k = far[0], truth = Z.edges[k].open ? 1 : 0;
    G.mem[k] = 1 - truth; G.doorSeenT[k] = -9;
    const k2 = far[1]; G.mem[k2] = -1; G.doorSeenT[k2] = -9;
    await frame(); doors = MS.r3Doors();
    const mem = doors[k], unk = doors[k2];
    // pin: walk one room east of the dock (the dock's own doorways are always held), plant a beacon, light a pinned door
    const east = Z.dockR + 1; MS.teleport(((east % Z.RW) * 9 + 5) * 32, (Math.floor(east / Z.RW) * 9 + 5) * 32);
    G.beacons.push({ x: G.p.x, y: G.p.y, lit: true, c: 1, old: false, placedT: G.t });
    const pinK = Z.edges.findIndex((e, j) => MS.doorPinned(j) && e.a !== Z.dockR && e.b !== Z.dockR);
    if (pinK >= 0) G.doorSeenT[pinK] = G.t + 999;   // treat as lit for this check
    await frame(); const pin = pinK >= 0 ? MS.r3Doors()[pinK] : null;
    return { n: doors.length, litChecked: doors.filter(d => d.label !== 'unlit' && d.label !== 'unknown').length, litWrong: litWrong.length,
      mem: { label: mem.label, shown: mem.shown, slab: mem.slab, truth }, unk: { label: unk.label, slab: unk.slab, glow: unk.glow }, pin };
  });
  assert(r.n > 0 && r.litChecked > 0, 'some doorways are lit to check: ' + JSON.stringify(r));
  assert(r.litWrong === 0, 'every lit doorway shows its true state');
  // the false memory: truth open (1) is remembered closed, so a slab shows; truth closed (0) is remembered open, so none does
  assert(r.mem.label === 'unlit' && r.mem.shown === (r.mem.truth ? 'closed' : 'open') && r.mem.slab === (r.mem.truth === 1), 'an unlit doorway shows memory, not truth: ' + JSON.stringify(r.mem));
  assert(r.unk.label === 'unknown' && !r.unk.slab && r.unk.glow === 0, 'a never-seen doorway shows nothing: ' + JSON.stringify(r.unk));
  assert(r.pin && r.pin.label === 'pinned' && r.pin.brackets, 'a lit, pinned doorway shows its brackets: ' + JSON.stringify(r.pin));
  await pg.shot('3D-step2-doors');
}, { query: '&r3d=1', seed: 11 });

await scenario('3d step 3: unlit floor renders black in WebGL; lit floor does not; a beacon lights the doorways it pins', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, pts = [], info = [];
    // the room east of the dock, lantern aimed north: its southern half is dark
    const east = Z.dockR + 1; MS.teleport(((east % Z.RW) * 9 + 5) * 32, (Math.floor(east / Z.RW) * 9 + 5) * 32);
    G.hollows.forEach(h => h.dead = true);
    G.debugAim = -Math.PI / 2; MS.update(0.016); MS.update(0.016);
    MS.r3Read([]);   // render once so the camera and light mask reflect this position before projecting
    // floor tile centres around the Warden's room, on screen and clear of the HUD
    for (let hy = 0; hy < Z.GH * 2; hy++) for (let hx = 0; hx < Z.GW * 2; hx++) {   // half-tile grid
      const tx = hx >> 1, ty = hy >> 1;
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (hx + 0.5) * 16, y = (hy + 0.5) * 16, p = MS.r3Project(x, y, 0);
      if (p.behind || p.x < 300 || p.x > innerWidth - 300 || p.y < 150 || p.y > innerHeight - 120) continue;
      if (!MS.r3FloorVisible(x, y).visible) continue;   // a wall or doorway stands in front of it from this camera
      // classify by the light around the tile, not one texel: a sample on a cone's edge is neither lit nor unlit
      const ms = []; for (const dx of [-19, 0, 19]) for (const dy of [-19, 0, 19]) ms.push(MS.r3MaskAt(x + dx, y + dy));
      pts.push([p.x, p.y]); info.push({ m: Math.max(...ms), mMin: Math.min(...ms), tx, ty });
    }
    const lum = MS.r3Read(pts);
    const unlitI = lum.map((l, i) => i).filter(i => info[i].m < 0.05), lit = lum.filter((l, i) => info[i].mMin > 0.5);
    const worst = unlitI.sort((a, b) => lum[b] - lum[a])[0];
    return { n: pts.length, unlitN: unlitI.length, unlitMax: worst == null ? 0 : lum[worst], worst: worst == null ? null : info[worst], litN: lit.length, litMin: Math.min(255, ...lit), litMed: lit.sort((a, b) => a - b)[Math.floor(lit.length / 2)] };
  });
  assert(r.unlitN > 10 && r.litN > 10, 'enough lit and unlit floor on screen: ' + JSON.stringify(r));
  assert(r.unlitMax < 12, 'unlit floor is black in the WebGL output (max ' + r.unlitMax.toFixed(1) + ' at ' + JSON.stringify(r.worst) + ')');
  assert(r.litMed > 3 * Math.max(4, r.unlitMax), 'lit floor is clearly visible (median ' + r.litMed.toFixed(1) + ')');
  const b = await pg.evaluate(() => {
    // a beacon 70 px inside a doorway of the room east of the dock; that doorway is pinned and inside the beacon's light
    const G = MS.G, Z = G.Z, east = Z.dockR + 1;
    const dc = e => e.v ? { x: (e.i + 1) * 288 + 16, y: (e.j * 9 + 5) * 32 } : { x: (e.i * 9 + 5) * 32, y: (e.j + 1) * 288 + 16 };
    const ks = Z.edges.map((e, k) => k).filter(k => (Z.edges[k].a === east || Z.edges[k].b === east) && Z.edges[k].a !== Z.dockR && Z.edges[k].b !== Z.dockR);
    const rc = { x: ((east % Z.RW) * 9 + 5) * 32, y: (Math.floor(east / Z.RW) * 9 + 5) * 32 };
    MS.teleport(rc.x, rc.y); G.hollows.forEach(h => h.dead = true);
    const out = [];
    for (const k of ks) {
      const c = dc(Z.edges[k]), d = Math.hypot(c.x - rc.x, c.y - rc.y), bx = c.x + (rc.x - c.x) / d * 70, by = c.y + (rc.y - c.y) / d * 70;
      G.beacons = [{ x: bx, y: by, lit: true, c: 1, old: false, placedT: G.t }];
      G.debugAim = Math.atan2(rc.y - c.y, rc.x - c.x);   // lantern faces away from the doorway: only the beacon lights it
      G.doorSeenT[k] = -9; MS.update(0.016); MS.update(0.016); MS.r3Read([]);
      out.push({ k, pinned: MS.doorPinned(k), seenAgo: +(G.t - G.doorSeenT[k]).toFixed(3), mask: MS.r3MaskAt(c.x + (bx - c.x) / 70 * 14, c.y + (by - c.y) / 70 * 14), label: MS.r3Doors()[k].label });
    }
    return out;
  });
  assert(b.length > 0, 'some pinned doorways are within the beacon light');
  for (const d of b) assert(d.pinned && d.seenAgo < 0.05 && d.mask > 0.2 && (d.label === 'pinned' || d.label === 'settling'), 'pinned doorway inside beacon light is lit, seen and shown as held: ' + JSON.stringify(d));
  await pg.shot('3D-step3-light');
}, { query: '&r3d=1', seed: 11 });

await scenario('3d brackets: a pinned but unlit doorway shows brackets only during the pin flash, and never its state', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  const k = await pg.evaluate(() => {
    // 40 px west of the centre of the room east of the dock, facing west: the room's east doorway is pinned (same room)
    // but about 184 px from the beacon, beyond its 150 px light, and behind the lantern
    const G = MS.G, Z = G.Z, east = Z.dockR + 1;
    MS.teleport(((east % Z.RW) * 9 + 5) * 32 - 40, (Math.floor(east / Z.RW) * 9 + 5) * 32);
    G.hollows.forEach(h => h.dead = true); G.debugAim = Math.PI; MS.update(0.016);
    return Z.edges.findIndex(e => e.v && e.a === east);
  });
  await pg.keyboard.press('b');
  const r = await pg.evaluate(k => {
    const G = MS.G, Z = G.Z, e = Z.edges[k], b = G.beacons[G.beacons.length - 1];
    const c = { x: (e.i + 1) * 288 + 16, y: (e.j * 9 + 5) * 32 };
    MS.update(0.05); MS.r3Read([]);
    const during = { ...MS.r3Doors()[k], pinned: MS.doorPinned(k), dist: Math.round(Math.hypot(c.x - b.x, c.y - b.y)), seenAgo: G.t - G.doorSeenT[k] };
    for (let i = 0; i < 30; i++) MS.update(0.05);
    MS.r3Read([]);
    const after = { ...MS.r3Doors()[k], seenAgo: G.t - G.doorSeenT[k] };
    return { during, after };
  }, k);
  assert(r.during.pinned && r.during.dist > 150 && r.during.seenAgo > 0.1, 'setup: pinned, beyond the beacon light, unlit: ' + JSON.stringify(r.during));
  assert(r.during.brackets && (r.during.label === 'unlit' || r.during.label === 'unknown'), 'brackets show during the pin flash while the doorway shows only memory: ' + JSON.stringify(r.during));
  assert(!r.after.brackets && r.after.seenAgo > 0.1, 'after the flash, the unlit pinned doorway shows no brackets: ' + JSON.stringify(r.after));
}, { query: '&r3d=1', seed: 11 });

/* ---------- Milestone C: audio, captions, accessibility, persistence ---------- */
await scenario('audio: nothing before a gesture; buses independent; mute; nodes released', async pg => {
  assert(await pg.evaluate(() => MS.audioStats()) === null, 'no AudioContext before the player interacts');
  await beginFirstPlace(pg);
  const a0 = await pg.evaluate(() => MS.audioStats());
  assert(a0 && a0.state === 'running', 'context running after the click: ' + (a0 && a0.state));
  await pg.evaluate(() => { const G = MS.G; MS.teleport(G.sanct.x + 300, G.sanct.y); G.debugAim = Math.PI; for (let i = 0; i < 4; i++) MS.spawnHollowAt(G.p.x + 60 + i * 20, G.p.y + 30, 'plain', 0); });
  // measure while they are still closing in: they reach the Warden and dissolve on contact from about 2.2 s,
  // so a 3.5 s wait sampled a falling edge and failed intermittently (danger 0.006-0.1 instead of ~0.8)
  await pg.waitForTimeout(1500);
  const busy = await pg.evaluate(() => MS.audioStats());
  assert(busy.layers.danger > 0.2, 'danger layer rises with moving Hollows near: ' + busy.layers.danger);
  assert(busy.peak < 120, 'one-shot voices stay under the cap: ' + busy.peak);
  await pg.evaluate(() => { MS.G.hollows.forEach(h => h.dead = true); MS.teleport(MS.G.sanct.x + 70, MS.G.sanct.y); });
  await pg.waitForTimeout(3000);
  const calm = await pg.evaluate(() => MS.audioStats());
  assert(calm.layers.danger < busy.layers.danger * 0.5, 'danger fades smoothly when safe: ' + calm.layers.danger);
  assert(calm.active < 40 && calm.created > busy.created, `finished sounds are released (active ${calm.active}, created ${calm.created})`);
  await pg.keyboard.press('Escape'); await pg.click('#pSettings');
  await pg.$eval('#vol-music', el => { el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(600);
  const mv = await pg.evaluate(() => MS.audioStats());
  assert(mv.bus.music < 0.02 && mv.bus.sfx > 0.5 && mv.bus.voice > 0.5, 'music slider moves only the music bus: ' + JSON.stringify(mv.bus));
  await pg.click('[data-toggle="sound"]'); await pg.waitForTimeout(500);
  assert((await pg.evaluate(() => MS.audioStats())).master < 0.02, 'sound off mutes the master');
});

await scenario('audio: heard voices raise suspicion; captions match speech and sound; captions can be turned off', async pg => {
  await beginFirstPlace(pg);
  await pg.evaluate(() => { const G = MS.G, m = G.signals.find(s => !s.real); G.hollows.forEach(h => h.dead = true); MS.teleport(m.x - 200, m.y); G.debugAim = 0; });
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => ({ sus: MS.audioStats().layers.suspicion, caps: MS.captions, name: MS.G.signals.find(s => !s.real).name }));
  assert(r.sus > 0.2, 'suspicion layer rises near a heard, unresolved voice: ' + r.sus);
  // other voices off screen may be captioned; the one in view is captioned only by its bubble
  assert(!r.caps.some(c => c.startsWith('speech:') && c.includes(`calling itself ${r.name}:`)), 'an on-screen speaker is captioned by its bubble, not twice: ' + JSON.stringify(r.caps));
  await pg.evaluate(() => { const s = MS.G.signals[0]; MS.emit('voice', { s: { ...s, x: s.x + 5000 }, dx: 5000, dy: 0 }); });
  const caps2 = await pg.evaluate(() => MS.captions);
  assert(caps2.some(c => /speech: Voice to the east, calling itself/.test(c)), 'an off-screen speaker gets a caption with direction: ' + caps2.join(' | '));
  // environmental caption for a doorway shifting nearby
  await pg.evaluate(() => MS.emit('doorChanged', { k: 0, near: true, dx: 200, dy: 0 }));
  assert((await pg.evaluate(() => MS.captions)).some(c => /Stone shifting to the east/.test(c)), 'sound caption names the cue and its direction');
  await pg.evaluate(() => { MS.S.envCaptions = false; MS.S.captions = false; MS.emit('doorChanged', { k: 1, near: true, dx: -200, dy: 0 }); });
  assert(!(await pg.evaluate(() => MS.captions)).some(c => /to the west/.test(c)), 'no caption when turned off');
});

await scenario('accessibility: reduced motion follows the system; contrast, rebinding and volumes persist', async pg => {
  const a = await pg.evaluate(() => ({ motion: MS.S.motion, rm: document.documentElement.classList.contains('rm') }));
  assert(a.motion === false && a.rm, 'prefers-reduced-motion turns motion off by default');
  await pg.click('#btnSettings');
  await pg.click('[data-toggle="contrast"]');
  assert(await pg.evaluate(() => document.documentElement.classList.contains('hc')), 'high contrast applied');
  await pg.click('[data-rebind="flare"]'); await pg.keyboard.press('g');
  await pg.$eval('#vol-voice', el => { el.value = 35; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.shot('C-settings-contrast');
  await pg.reload(); await pg.waitForFunction(() => window.MS && MS.state === 'title');
  const b = await pg.evaluate(() => ({ hc: document.documentElement.classList.contains('hc'), key: MS.S.keys.flare, voice: MS.S.vol.voice }));
  assert(b.hc && b.key === 'g' && Math.abs(b.voice - 0.35) < 0.001, 'settings survive reload: ' + JSON.stringify(b));
  await beginFirstPlace(pg);
  const f0 = await pg.evaluate(() => MS.G.p.flares);
  await pg.keyboard.press('g'); await pg.waitForTimeout(300);
  assert(await pg.evaluate(() => MS.G.p.flares) === f0 - 1, 'rebound key throws a flare');
}, { reducedMotion: 'reduce' });

await scenario('touch: phone layout, on-screen controls work, nothing overlaps the lens bar', async pg => {
  await pg.tap('#btnBegin'); await pg.tap('.rnode.avail'); await pg.tap('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  await pg.waitForTimeout(400);
  const ui = await pg.evaluate(() => ({ mode: document.getElementById('touchUi').hidden, sizes: [...document.querySelectorAll('.tbtn')].map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.width), Math.round(r.top), Math.round(r.bottom)]; }), lensTop: innerHeight - 14 - 34 }));
  assert(ui.mode === false, 'touch controls shown');
  for (const [id, w, top, bottom] of ui.sizes) { assert(w >= 44, id + ' is a large enough target'); assert(bottom < ui.lensTop - 4, id + ' does not cover the lens bar'); }
  await pg.waitForFunction(() => document.getElementById('guide').textContent.trim().length > 0, null, { timeout: 4000 });
  const clash = await pg.evaluate(() => { const a = document.getElementById('tPause').getBoundingClientRect(), b = document.getElementById('guide').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); });
  assert(!clash, 'pause button is not covered by the guide card');
  assert(await pg.evaluate(() => /Drag/.test(document.getElementById('guide').textContent)), 'guide speaks in touch terms');
  const f0 = await pg.evaluate(() => MS.G.p.flares);
  await pg.tap('#tFlare'); await pg.waitForTimeout(300);
  assert(await pg.evaluate(() => MS.G.p.flares) === f0 - 1, 'FLARE button throws a flare');
  await pg.tap('#tLens'); await pg.waitForTimeout(100);
  assert(await pg.evaluate(() => MS.G.p.lens) === 1, 'LENS button cycles lenses');
  // drag on the left half to move
  const p0 = await pg.evaluate(() => [MS.G.p.x, MS.G.p.y]);
  const cdp = await pg.context().newCDPSession(pg);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 600 }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90, y: 600 - i * 5 }] }); await pg.waitForTimeout(40); }
  await pg.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const p1 = await pg.evaluate(() => [MS.G.p.x, MS.G.p.y]);
  assert(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 20, 'left-side drag moves the Warden');
  await pg.shot('D-touch-zone');
}, { viewport: { width: 390, height: 844 }, touch: true });

const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'pre-upgrade-v1.json'), 'utf8'));
const fixtureStore = { 'moving-sanctuary.chronicle.v1': JSON.stringify(fixture.chronicle), 'moving-sanctuary.settings.v1': JSON.stringify(fixture.settings) };
await scenario('research: comparison toggle holds doorways; questionnaire saves locally and exports as JSON', async pg => {
  await pg.evaluate(() => { MS.S.ablate.shift = true; });
  await pg.click('#btnBegin'); await pg.click('.rnode.avail'); await pg.click('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  const changed = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z; G.debugAim = Math.PI; const snap = Z.edges.map(e => e.open); let n = 0;
    for (let i = 0; i < 1200; i++) { MS.update(1 / 30); Z.edges.forEach((e, k) => { if (e.open !== snap[k]) { n++; snap[k] = e.open; } }); }
    return n;
  });
  assert(changed === 0, 'with "Doorways never move" on, no doorway changed in 40 s (changed ' + changed + ')');
  await pg.evaluate(() => { MS.teleport(MS.G.sanct.x + 70, MS.G.sanct.y); });
  await pg.waitForTimeout(150); await pg.keyboard.press('e'); await pg.click('#dockDepart'); await pg.waitForTimeout(250);
  await pg.evaluate(() => { MS.CH.exp.ember = 0; MS.CH.exp.salvage = 0; });
  await pg.click('#restBtn'); await pg.click('#btnContinue'); await pg.click('#endBtn');
  await pg.waitForFunction(() => MS.state === 'debrief');
  await pg.click('.notes summary');
  const nq = await pg.evaluate(() => document.querySelectorAll('.likert fieldset').length);
  assert(nq >= 3, 'questionnaire is offered (' + nq + ' questions)');
  for (let i = 0; i < nq; i++) await pg.click(`label:has(#lk${i}-${(i % 7) + 1})`);
  await pg.click('#notesSave');
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem('moving-sanctuary.chronicle.v1')).notes.at(-1));
  assert(saved && saved.answers.every((a, i) => a === (i % 7) + 1), 'answers stored on this device');
  assert(saved.variants.shift === true, 'the comparison variant is recorded with the notes');
  for (const k of ['decisionsPerMin', 'doorSurprises', 'firstDoorSeconds', 'doorsChangedWhileLookingAway', 'lensInformedReads', 'flareResults', 'packsRecovered', 'packsLeftBehind', 'idlePauses']) assert(k in saved.metrics, 'metrics include ' + k);
  await pg.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } }); } catch (e) {} });
  await pg.click('#notesCopy'); await pg.waitForTimeout(150);
  const text = await pg.evaluate(() => document.getElementById('notesText').value);
  let parsed = null; try { parsed = JSON.parse(text); } catch (e) {}
  assert(parsed && Array.isArray(parsed.questions) && parsed.notes.length >= 1, 'export falls back to selectable JSON when the clipboard is refused');
  await pg.evaluate(() => { MS.S.ablate.shift = false; });
});

await scenario('performance: normal frames keep full quality; sustained slow frames halve the darkness mask once', async pg => {
  await pg.click('#btnBegin'); await pg.click('.rnode.avail'); await pg.click('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  await pg.waitForTimeout(3000);
  const base = await pg.evaluate(() => ({ scale: MS.QUALITY.maskScale, work: MS.frameWorkMs }));
  console.log('      frame work (headless, software GL): ' + base.work + ' ms average');
  assert(base.scale === 1, 'full-resolution mask at normal cost (' + base.work + ' ms)');
  await pg.evaluate(() => MS.stall(16));
  await pg.waitForFunction(() => MS.QUALITY.maskScale === 0.5, null, { timeout: 8000 });
  await pg.evaluate(() => MS.stall(0));
  await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => ({ ev: MS.events.filter(e => e.type === 'quality').length, state: MS.state }));
  assert(after.ev === 1 && after.state === 'zone', 'quality steps down exactly once and play continues');
});

await scenario('save: a real pre-upgrade v1 save loads untouched, plays, saves and reloads', async pg => {
  const raw0 = await pg.evaluate(() => localStorage.getItem('moving-sanctuary.chronicle.v1'));
  assert(raw0 === fixtureStore['moving-sanctuary.chronicle.v1'], 'loading the title does not rewrite the save');
  const t = await pg.evaluate(() => ({ line: document.getElementById('titleChron').textContent, tells: MS.S.tells, vol: MS.S.vol.master, keys: MS.S.keys.use }));
  assert(/in progress/.test(t.line) && t.tells === 'clear' && t.vol === 0.8 && t.keys === 'e', 'old settings kept, new ones defaulted: ' + JSON.stringify(t));
  await pg.click('#btnContinue');
  await pg.waitForFunction(() => MS.state === 'route');
  const pinned = fixture.chronicle.zones['1-0'].beacons.length;
  assert(pinned === 1, 'fixture holds a persisted beacon');
  await pg.click('.rnode.avail'); await pg.click('#goBtn'); await pg.waitForFunction(() => MS.state === 'zone');
  await pg.waitForTimeout(800);
  await toDock(pg); await pg.click('#dockDepart'); await pg.waitForFunction(() => MS.state === 'route');
  await pg.reload(); await pg.waitForFunction(() => window.MS && MS.state === 'title');
  const c = await pg.evaluate(() => JSON.parse(localStorage.getItem('moving-sanctuary.chronicle.v1')));
  assert(c.v === 1 && c.crew.some(x => x.name === fixture.chronicle.crew[1].name), 'crew from the old save survives');
  assert(c.zones['1-0'].beacons.length === 1, 'old beacon still recorded');
  if (c.exp.path.length !== fixture.chronicle.exp.path.length + 1) console.log('      diagnostic (save): saved path ' + JSON.stringify(c.exp.path) + ', events ' + JSON.stringify(await pg.evaluate(() => MS.events.map(e => e.type).slice(-20))));   // intermittent once in ~15 full runs; not reproduced in 10 traced replays
  assert(c.exp.path.length === fixture.chronicle.exp.path.length + 1, 'progress continued from the old save');
  assert(c.exp.stats.zones === fixture.chronicle.exp.stats.zones + 1, 'old stats extended, not reset');
}, { storage: fixtureStore });

await browser.close();
const fails = results.filter(r => !r[1].startsWith('PASS'));
for (const [n, s, ms] of results) console.log(`${s.startsWith('PASS') ? 'ok  ' : 'FAIL'}  ${n}  (${ms} ms)${s.startsWith('PASS') ? '' : '\n      ' + s}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
