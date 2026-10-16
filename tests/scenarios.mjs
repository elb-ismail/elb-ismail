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
  if (process.env.THROTTLE) {   // e.g. THROTTLE=4: run every page with the CPU slowed down 4x (Chrome DevTools throttling)
    const cdp = await ctx.newCDPSession(pg);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  }
  pg.errors = []; pg.warnings = [];
  pg.on('console', m => { if (m.type() === 'warning') pg.warnings.push(m.text()); });
  pg.on('pageerror', e => pg.errors.push('pageerror: ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/ERR_CERT|fonts\.g/.test(m.text())) pg.errors.push('console: ' + m.text()); });
  await pg.goto(URL_BASE + '?debug=1' + (opts.query || '') + (opts.hash || ''));
  await pg.waitForFunction(() => window.MS && MS.state === 'title');
  if (opts.storage) {
    // Seed through the page, then reload. (An addInitScript seeder runs so early on file:// pages that localStorage can
    // read as empty: in 5 of 25 traced runs it wrote the fixture back over a correct save after the test's reload.
    // Writing from the page and reloading persisted in 25 of 25 runs.)
    await pg.evaluate(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, opts.storage);
    await pg.reload();
    await pg.waitForFunction(() => window.MS && MS.state === 'title');
  }
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
// Wait for game time, not wall time: when frames are slow (CPU throttling, loaded CI) the game runs slower than the
// clock (each frame's step is capped), so a fixed wall-clock wait can end before the game has done the thing.
async function gameWait(pg, secs) {
  const t0 = await pg.evaluate(() => MS.G.t);
  await pg.waitForFunction(([t0, s]) => MS.G && MS.G.t >= t0 + s, [t0, secs], { timeout: 20000 });
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
  await pg.keyboard.down('e'); await gameWait(pg, 1.3); await pg.keyboard.up('e');
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
  await gameWait(pg, 0.9);
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
  await pg.keyboard.down('e'); await gameWait(pg, 0.7); await pg.keyboard.up('e');
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

await scenario('3d step 4: unlit Hollows, mimics, escorts and loot read back at the unlit-floor level; lit ones show', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1, P = G.p;
    const rc = { x: ((east % Z.RW) * 9 + 5) * 32, y: (Math.floor(east / Z.RW) * 9 + 5) * 32 };
    // the north part of the room east of the dock, lantern aimed north: the south of the room and its neighbours are dark
    MS.teleport(rc.x, rc.y - 96); G.debugAim = -Math.PI / 2;
    const hol = G.hollows[0], mimic = G.signals.find(s => !s.real), kinds = [...new Set(G.items.map(i => i.kind))];
    const items = kinds.map(k => G.items.find(i => i.kind === k));
    G.hollows.slice(1).forEach(h => h.dead = true);
    G.escorts.push({ name: 'Test', trait: G.signals.find(s => s.real).trait, x: P.x, y: P.y, shaken: true, shakeT: 99, home: false, walk: 0, ang: 0 });
    const esc = G.escorts[G.escorts.length - 1];
    const ents = [['hollow', hol, 0.15], ['mimic', mimic, 0.35], ['escort', esc, 0.35], ...items.map(i => ['item:' + i.kind, i, { ember: 0.15, salvage: 0.08, relic: 0.32 }[i.kind] || 0.22])]   // sample height: each mesh's centre;
    MS.update(0.001); MS.r3Read([]);
    // park everything on open floor that is off screen, so the spots below are bare floor
    // (each on its own tile: a Hollow touching an escort dissolves)
    const pk = [];
    for (let i = 0; i < Z.GW * Z.GH && pk.length < ents.length; i++) { const x = (i % Z.GW + 0.5) * 32, y = (Math.floor(i / Z.GW) + 0.5) * 32, p = MS.r3Project(x, y, 0); if (!Z.wall[i] && (p.x < -200 || p.y < -200 || p.x > innerWidth + 200 || p.y > innerHeight + 200) && !pk.some(q => Math.hypot(q.x - x, q.y - y) < 64)) pk.push({ x, y }); }
    ents.forEach(([, e], i) => { e.x = pk[i].x; e.y = pk[i].y; }); hol.emerge = 0;
    MS.update(0.001); MS.update(0.001); MS.r3Read([]);
    // dark spots: open floor whose whole neighbourhood is unlit, on screen, seen directly, spaced apart. The Hollow's
    // spot must also be out of eye range (260 px, or no clear line), since eyes in the dark are allowed there.
    const wallOn = (x1, y1) => { for (let s = 0; s <= 1; s += 1 / 64) { const x = P.x + (x1 - P.x) * s, y = P.y + (y1 - P.y) * s; if (Z.wall[Math.floor(x / 32) + Math.floor(y / 32) * Z.GW]) return true; } return false; };
    const cand = [];
    for (let ty = 0; ty < Z.GH; ty++) for (let tx = 0; tx < Z.GW; tx++) {
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32, p = MS.r3Project(x, y, 0);
      if (p.behind || p.x < 60 || p.x > innerWidth - 60 || p.y < 150 || p.y > innerHeight - 100) continue;
      let m = 0; for (const dx of [-40, 0, 40]) for (const dy of [-40, 0, 40]) m = Math.max(m, MS.r3MaskAt(x + dx, y + dy));
      if (m > 0.05 || !MS.r3FloorVisible(x, y).visible) continue;
      cand.push({ x, y, noEyes: Math.hypot(x - P.x, y - P.y) > 270 || wallOn(x, y) });
    }
    const spots = [], far = cand.find(c => c.noEyes);
    if (far) spots.push(far);
    for (const c of cand) if (spots.length < ents.length && !spots.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 56)) spots.push(c);
    if (!far || spots.length < ents.length) return { spots: spots.length, need: ents.length, cand: cand.length, far: !!far };
    // the same pixels with the entities parked elsewhere (bare unlit floor), then with each entity standing there
    const pts = ents.map(([, , h], i) => { const p = MS.r3Project(spots[i].x, spots[i].y, h); return [p.x, p.y]; });
    const floor = MS.r3Read(pts);
    ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; }); hol.emerge = 0;
    MS.update(0.001); MS.update(0.001);
    ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; });   // undo the 2 ms of drift before drawing
    const dark = MS.r3Read(pts), info = MS.r3Entities(), darkVis = ents.map(([, e]) => !!e.vis && e !== esc);
    if (!G.hollows.includes(hol)) return { lostHollow: true };
    const hi = info.hollows[G.hollows.indexOf(hol)];
    // positive control: the same entities a few steps into the lantern's light (Warden moved south so they stay in the room)
    MS.teleport(rc.x, rc.y + 60);
    const lit = ents.map(([, , h], i) => ({ x: P.x + (i - (ents.length - 1) / 2) * 18, y: P.y - 90 - (i % 2) * 34, h }));   // well inside the cone
    ents.forEach(([, e], i) => { e.x = lit[i].x; e.y = lit[i].y; }); hol.emerge = 0;
    MS.update(0.001); MS.update(0.001);
    ents.forEach(([, e], i) => { e.x = lit[i].x; e.y = lit[i].y; });
    MS.r3Read([]);
    const lpts = lit.map(l => { const p = MS.r3Project(l.x, l.y, l.h); return [p.x, p.y]; });
    const litL = MS.r3Read(lpts), info2 = MS.r3Entities();
    return {
      rows: ents.map(([n], i) => ({ n, floor: +floor[i].toFixed(1), dark: +dark[i].toFixed(1), lit: +litL[i].toFixed(1) })),
      hollowDark: hi, hollowLit: info2.hollows[G.hollows.indexOf(hol)],
      darkVis, litVis: ents.map(([n, e]) => [n, e === esc || !!e.vis]), mimicLit: !!info2.figs[G.signals.indexOf(mimic)].shown
    };
  });
  assert(!r.lostHollow, 'setup: the Hollow under test is still in the place');
  assert(r.rows, 'enough dark floor on screen for every entity: ' + JSON.stringify(r));
  if (process.env.VERBOSE) console.log('      readback', JSON.stringify(r.rows));
  assert(!r.darkVis.some(Boolean), 'setup: the simulation counts them all unlit');
  for (const row of r.rows) {
    assert(row.dark < 12 && Math.abs(row.dark - row.floor) <= 2, 'unlit ' + row.n + ' reads back at the unlit floor level: ' + JSON.stringify(row));
  }
  assert(!r.hollowDark.body && !r.hollowDark.eyes, 'unlit Hollow beyond eye range: no body, no eyes: ' + JSON.stringify(r.hollowDark));
  assert(r.litVis.every(v => v[1]), 'setup: the simulation counts the control positions lit: ' + JSON.stringify(r.litVis));
  const brightest = r.rows.filter(x => x.n !== 'hollow');
  for (const row of brightest) assert(row.lit > 24 && row.lit > row.dark + 12, 'positive control: lit ' + row.n + ' is drawn: ' + JSON.stringify(row));
  assert(r.hollowLit.simVis && r.hollowLit.body && r.hollowLit.eyes, 'positive control: a lit Hollow shows its body: ' + JSON.stringify(r.hollowLit));
  assert(r.mimicLit, 'positive control: a lit mimic is shown');
  await pg.shot('3D-step4-entities');
}, { query: '&r3d=1', seed: 11 });

await scenario('3d step 4: Hollow eyes show in the dark only along a clear line within 260 px; no entity casts a shadow or reflects', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1, P = G.p;
    MS.teleport(((east % Z.RW) * 9 + 5) * 32, ((Math.floor(east / Z.RW) * 9 + 5) * 32)); G.debugAim = -Math.PI / 2;
    const hol = G.hollows[0]; G.hollows.slice(1).forEach(h => h.dead = true);
    MS.update(0.001); MS.r3Read([]);
    const wallOn = (x0, y0, x1, y1) => { for (let s = 0; s <= 1; s += 1 / 64) { const x = x0 + (x1 - x0) * s, y = y0 + (y1 - y0) * s; if (Z.wall[Math.floor(x / 32) + Math.floor(y / 32) * Z.GW]) return true; } return false; };
    let clear = null, blocked = null;
    for (let ty = 0; ty < Z.GH && !(clear && blocked); ty++) for (let tx = 0; tx < Z.GW; tx++) {
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32, d = Math.hypot(x - P.x, y - P.y);
      let m = 0; for (const dx of [-40, 0, 40]) for (const dy of [-40, 0, 40]) m = Math.max(m, MS.r3MaskAt(x + dx, y + dy));
      if (d < 120 || d > 230 || m > 0.05) continue;   // the whole neighbourhood dark: the simulation tests a Hollow's radius
      if (!wallOn(P.x, P.y, x, y)) clear = clear || { x, y, d }; else if (wallOn(P.x, P.y, x, y) && d < 200) blocked = blocked || { x, y, d };
    }
    const at = s => { hol.x = s.x; hol.y = s.y; hol.emerge = 0; MS.update(0.001); hol.x = s.x; hol.y = s.y; MS.r3Read([]); return MS.r3Entities().hollows[G.hollows.indexOf(hol)]; };
    const out = { clear, blocked, inClear: clear && at(clear), inBlocked: blocked && at(blocked) };
    // nothing that represents a creature, person or object casts shadows, and nothing in the scene reflects
    const E = MS.R3.E, roots = [E.warden, E.cone, E.sanct.g, ...[...E.hollows.values()].map(o => o.g), ...[...E.figs.values()].map(o => o.g), ...[...E.items.values()].map(o => o.g)];
    let casters = 0, reflective = 0;
    for (const root of roots) root.traverse(o => { if (o.castShadow) casters++; });
    MS.R3.scene.traverse(o => { const ms = o.material ? [].concat(o.material) : []; for (const m of ms) if (m.envMap || m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) reflective++; });
    out.casters = casters; out.reflective = reflective; out.env = !!MS.R3.scene.environment;
    return out;
  });
  assert(r.clear && r.blocked, 'setup: a dark spot in clear view and one behind a wall: ' + JSON.stringify(r));
  assert(!r.inClear.simVis && !r.inClear.body && r.inClear.eyes && r.inClear.eyeA > 0, 'in the dark with a clear line: eyes only: ' + JSON.stringify(r.inClear));
  assert(!r.inBlocked.simVis && !r.inBlocked.body && !r.inBlocked.eyes, 'behind a wall: nothing at all: ' + JSON.stringify(r.inBlocked));
  assert(r.casters === 0, 'no entity casts a shadow (' + r.casters + ')');
  assert(r.reflective === 0 && !r.env, 'no reflective materials or environment map');
}, { query: '&r3d=1', seed: 11 });

await scenario('3d step 4: across a played minute, no unlit Hollow body is ever drawn, in any frame', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const G = MS.G; let frames = 0, bodies = 0, eyesOnly = 0, bad = [];
    for (let i = 0; i < 1800; i++) {
      G.debugAim = Math.sin(i / 70) * 2.2; G.debugFocus = i % 300 > 240;
      MS.update(1 / 30); if (i % 3) continue;
      MS.r3Read([]); frames++;
      const e = MS.r3Entities();
      e.hollows.forEach((h, k) => {
        if (!h) return;
        if (h.body) bodies++; else if (h.eyes) eyesOnly++;
        if (h.body && !h.simVis) bad.push({ i, k, why: 'body while unlit' });
        if (h.eyes && !h.simVis && Math.hypot(h.x - G.p.x, h.y - G.p.y) >= 260) bad.push({ i, k, why: 'eyes beyond 260 px in the dark' });
        if (h.body && MS.r3MaskAt(h.x, h.y) < 0.01) bad.push({ i, k, why: 'body where the light mask is black', m: MS.r3MaskAt(h.x, h.y) });
      });
    }
    return { frames, bodies, eyesOnly, bad: bad.slice(0, 5), nBad: bad.length, hollows: G.hollows.length };
  });
  assert(r.frames > 500 && r.hollows > 0, 'setup: frames and Hollows to check: ' + JSON.stringify(r));
  assert(r.nBad === 0, 'no Hollow body is drawn unlit: ' + JSON.stringify(r));
}, { query: '&r3d=1', seed: 11 });

await scenario('streams 3d: drawing 3D entities never calls Math.random and never changes what the simulation rolls', async pg => {
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const id = MS.G.node.id;
    let simCalls = 0, visCalls = 0;
    const run = render => {
      MS.seed(77); MS.enterZone(id);
      const G = MS.G, Z = G.Z, east = Z.dockR + 1; G.debugAim = 0.6;
      MS.teleport(((east % Z.RW) * 9 + 5) * 32, (Math.floor(east / Z.RW) * 9 + 5) * 32);   // away from the Sanctuary, so the escort stays an escort
      G.escorts.push({ name: 'Test', trait: G.signals.find(s => s.real).trait, x: G.p.x - 20, y: G.p.y, shaken: true, shakeT: 99, home: false, walk: 0, ang: 0 });   // a trembling escort
      for (let i = 0; i < 900; i++) {
        MS.update(1 / 30);
        if (i % 120 === 60) MS.emit('flareBurst', { f: { x: G.p.x, y: G.p.y }, result: {} });
        if (render) {
          const mr = Math.random, vr = MS.rng.visual;
          Math.random = () => { simCalls++; return mr(); };
          MS.rng.visual = () => { visCalls++; return vr(); };
          try { MS.r3Read([]); } finally { Math.random = mr; MS.rng.visual = vr; }
        }
      }
      return JSON.stringify({ doors: G.Z.edges.map(e => e.open ? 1 : 0).join(''), hollows: G.hollows.map(h => [Math.round(h.x), Math.round(h.y), h.kind]), sig: G.signals.map(s => [Math.round(s.x), Math.round(s.y)]), esc: G.escorts.map(e => [Math.round(e.x), Math.round(e.y)]), dim: G.dim.toFixed(4), shiftT: G.shiftT.toFixed(4) });
    };
    const quiet = run(false), drawn = run(true);
    return { same: quiet === drawn, simCalls, visCalls };
  });
  assert(r.visCalls > 0, 'control: 3D entity animation does draw from visualRng (the trembling escort): ' + JSON.stringify(r));
  assert(r.simCalls === 0, '3D rendering never calls Math.random: ' + JSON.stringify(r));
  assert(r.same, 'rendering 3D entities every frame leaves the simulation identical');
}, { query: '&r3d=1', seed: 23 });

await scenario('3d normal input: mouse aims through the 3D camera, keys walk the Warden to the next room, the camera follows', async pg => {
  // no teleport, no debug aim, no state edits: only clicks, mouse movement and held keys
  await pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });
  await beginFirstPlace(pg);
  const vw = 1280, vh = 780;
  await pg.mouse.move(vw - 200, vh / 2 - 40);
  await gameWait(pg, 0.3);
  const a = await pg.evaluate(([mx, my]) => {
    const P = MS.G.p, w = MS.r3ScreenToWorld(mx, my), e = MS.r3Entities().warden;
    return { simAim: P.aim, want: Math.atan2(w.y - P.y, w.x - P.x), meshAim: e.aim, dx: e.x - P.x, dy: e.y - P.y, room: MS.R3.room, x0: P.x };
  }, [vw - 200, vh / 2 - 40]);
  const dAng = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
  assert(dAng(a.simAim, a.want) < 0.02, 'the lantern aims where the cursor meets the 3D floor: ' + JSON.stringify(a));
  assert(dAng(a.meshAim, a.simAim) < 0.02 && Math.hypot(a.dx, a.dy) < 0.5, 'the Warden mesh stands and faces where the simulation says: ' + JSON.stringify(a));
  await pg.keyboard.down('d');
  try {
    await pg.waitForFunction(r0 => MS.R3.room !== r0, a.room, { timeout: 20000 });
  } finally { await pg.keyboard.up('d'); }
  await pg.mouse.move(vw - 180, vh / 2 - 20);
  await gameWait(pg, 0.3);
  const b = await pg.evaluate(([mx, my]) => {
    const G = MS.G, P = G.p, Z = G.Z, room = MS.R3.room, w = MS.r3ScreenToWorld(mx, my), e = MS.r3Entities().warden;
    const t = MS.R3.target, cx = ((room % Z.RW) * 9 + 4.5), cz = (Math.floor(room / Z.RW) * 9 + 4.5);
    const gp = MS.R3.E.glass.getWorldPosition(new (MS.R3.T.Vector3)()), gs = MS.r3Project(gp.x * 32, gp.z * 32, gp.y);
    const ws = MS.r3Project(P.x, P.y, 0.6);
    return { room, x: P.x, simRoom: Math.floor(P.y / 288) * Z.RW + Math.floor(P.x / 288), camOnRoom: Math.hypot(t.x - cx, t.z - cz),
      simAim: P.aim, want: Math.atan2(w.y - P.y, w.x - P.x), dx: e.x - P.x, dy: e.y - P.y, glass: MS.r3Read([[gs.x, gs.y]])[0], ws };
  }, [vw - 180, vh / 2 - 20]);
  assert(b.x > a.x0 && b.room !== a.room && b.room === b.simRoom, 'the Warden walked east into the next room and the camera took that room: ' + JSON.stringify({ a, b }));
  assert(b.camOnRoom < 0.6, 'the camera is centred on the new room: ' + JSON.stringify(b));
  assert(dAng(b.simAim, b.want) < 0.02 && Math.hypot(b.dx, b.dy) < 0.5, 'after the camera move, aim and mesh still match the simulation: ' + JSON.stringify(b));
  assert(b.ws.x > 0 && b.ws.x < vw && b.ws.y > 0 && b.ws.y < vh && b.glass > 60, 'the Warden and the lantern glass are on screen and bright: ' + JSON.stringify(b));
  await pg.shot('3D-step4-normal-input');
}, { query: '&r3d=1', seed: 11 });

/* ---------- Step 5A: the Survey lens in 3D ---------- */
// What 3D drew for Survey (after MS.r3Frame) against the 2D rule computed from raw state (drawSurveyLens): every
// doorway within 760 px shows its true state, PINNED when held, and within 420 px when it was last lit; none beyond.
const defineSurveyCheck = pg => pg.evaluate(() => {
  window.doorAt = e => e.v ? { x: (e.i + 1) * 288 + 16, y: (e.j * 9 + 5) * 32 } : { x: (e.i * 9 + 5) * 32, y: (e.j + 1) * 288 + 16 };
  window.surveyCheck = () => {
    const G = MS.G, P = G.p, drawn = MS.r3Survey(), byK = new Map(drawn.map(d => [d.k, d])), bad = [];
    G.Z.edges.forEach((e, k) => {
      const c = doorAt(e), d = Math.hypot(c.x - P.x, c.y - P.y), ago = G.t - G.doorSeenT[k], got = byK.get(k);
      if (d > 760) { if (got) bad.push({ k, why: 'drawn beyond 760 px', d }); return; }
      const tag = MS.doorPinned(k) ? 'PINNED' : e.open ? 'OPEN' : 'SHUT', ageWanted = d < 420 && ago > 1;
      if (!got) { const p = MS.r3Project(c.x, c.y, 0.02); if (!p.behind && p.x > 0 && p.y > 0 && p.x < innerWidth && p.y < innerHeight) bad.push({ k, why: 'in reach and on screen but not drawn' }); return; }
      const ageOk = !ageWanted ? got.age === null : G.doorSeenT[k] < 0 ? got.age === 'never lit' : /^lit \d+:\d\d ago$/.test(got.age);
      if (got.tag !== tag || got.state !== (e.open ? 'open' : 'closed') || !ageOk || got.provenance !== 'ledgerEarned') bad.push({ k, tag, got, ageWanted });
    });
    return { n: drawn.length, bad };
  };
});
const noThreeWarnings = pg => { const w = pg.warnings.filter(x => /THREE\./.test(x)); assert(w.length === 0, 'no Three.js warnings: ' + w.join(' | ')); };
const r3ready = pg => pg.waitForFunction(() => MS.r3 === 'ready' || MS.r3 === 'failed', null, { timeout: 15000 });

await scenario('survey A: normal input raises Survey, crosses into the next room with it up, and lowers it', async pg => {
  // no teleport, no debug aim, no state edits: clicks, mouse, keys. MS.hold only freezes the clock to measure a frame.
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.mouse.move(1080, 350);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const a = await pg.evaluate(() => { MS.r3Frame(); return { lens: MS.G.p.lens, grid: MS.R3.survey.grid.visible, chk: surveyCheck(), room: MS.R3.room }; });
  assert(a.lens === 3 && a.grid, 'key 4 raises Survey: ' + JSON.stringify(a));
  assert(a.chk.n > 0 && a.chk.bad.length === 0, 'Survey draws exactly what the 2D rule shows: ' + JSON.stringify(a.chk));
  await pg.shot('survey-01-full-light');
  await pg.evaluate(() => MS.hold(false));
  await pg.keyboard.down('d');
  try { await pg.waitForFunction(r0 => MS.R3.room !== r0, a.room, { timeout: 30000 }); } finally { await pg.keyboard.up('d'); }
  await gameWait(pg, 0.2);
  await pg.evaluate(() => MS.hold(true));
  const b = await pg.evaluate(() => {
    MS.r3Frame();
    const G = MS.G, P = G.p, Z = G.Z, e = MS.r3Entities().warden;
    return { lens: P.lens, room: MS.R3.room, simRoom: Math.floor(P.y / 288) * Z.RW + Math.floor(P.x / 288), chk: surveyCheck(), dx: e.x - P.x, dy: e.y - P.y };
  });
  assert(b.lens === 3 && b.room !== a.room && b.room === b.simRoom, 'Survey stays up across the camera move to the Warden\'s new room: ' + JSON.stringify({ a: a.room, b }));
  assert(b.chk.n > 0 && b.chk.bad.length === 0 && Math.hypot(b.dx, b.dy) < 0.5, 'after the move, Survey and the Warden still match the simulation: ' + JSON.stringify(b));
  await pg.shot('survey-09-camera-transition');
  await pg.evaluate(() => MS.hold(false));
  await pg.keyboard.press('4');
  await gameWait(pg, 0.2);
  await pg.evaluate(() => MS.hold(true));
  const c = await pg.evaluate(() => { MS.r3Frame(); return { lens: MS.G.p.lens, drawn: MS.r3Survey().length, grid: MS.R3.survey.grid.visible }; });
  assert(c.lens === 0 && c.drawn === 0 && !c.grid, 'key 4 again lowers Survey and its marks go: ' + JSON.stringify(c));
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey B: an unlit, never-observed doorway out of Survey reach shows nothing at all', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  const k = await pg.evaluate(() => {
    const G = MS.G, P = G.p; G.hollows.forEach(h => h.dead = true);
    return G.Z.edges.findIndex((e, k) => G.doorSeenT[k] < 0 && G.mem[k] === -1 && Math.hypot(doorAt(e).x - P.x, doorAt(e).y - P.y) > 900);
  });
  assert(k >= 0, 'setup: a never-lit, never-remembered doorway more than 900 px away');
  await pg.keyboard.press('4');
  await gameWait(pg, 1.0);   // four Survey scans
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(k => {
    MS.r3Frame();
    const G = MS.G;
    return { lens: G.p.lens, pres: MS.lensPresentation({ kind: 'door', k }, 3), door: MS.r3Doors()[k], drawn: MS.r3Survey().some(d => d.k === k),
      mem: G.mem[k], seen: G.doorSeenT[k], chk: surveyCheck(), neverLitNear: MS.r3Survey().filter(d => d.age === 'never lit').length };
  }, k);
  assert(r.lens === 3, 'Survey is up');
  assert(r.pres.provenance === 'unknown' && r.pres.survey === null && !r.pres.brackets && r.pres.shown === 'unknown', 'presentation: unknown, nothing to show: ' + JSON.stringify(r.pres));
  assert(r.door.shown === 'unknown' && !r.door.slab && r.door.glow === 0 && !r.door.brackets, '3D doorway: no slab, no glow, no brackets: ' + JSON.stringify(r.door));
  assert(!r.drawn, 'no Survey glyph, tag or age for it');
  assert(r.mem === -1 && r.seen < 0, 'the simulation learned nothing about it either: ' + JSON.stringify(r));
  assert(r.chk.bad.length === 0, 'every doorway Survey does draw follows the 2D rule: ' + JSON.stringify(r.chk));
  await pg.shot('survey-B-unknown-doorway');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey C: a doorway changed while unseen shows memory until Survey reaches it, then the earned truth', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  const s = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1, rc = { x: ((east % Z.RW) * 9 + 5) * 32, y: (Math.floor(east / Z.RW) * 9 + 5) * 32 };
    G.hollows.forEach(h => h.dead = true);
    const k = Z.edges.findIndex(e => e.v && e.a === east), c = doorAt(Z.edges[k]);
    // observe it: stand in the room and shine the lantern on it
    MS.teleport(rc.x, rc.y); G.debugAim = Math.atan2(c.y - rc.y, c.x - rc.x);
    for (let i = 0; i < 6; i++) MS.update(1 / 30);
    const observed = { seenAgo: G.t - G.doorSeenT[k], open: Z.edges[k].open, mem: G.mem[k] };
    // walk far away (setup), then the doorway changes while nobody can see it. The simulation only shifts doorways
    // at random, so the change is applied directly, as tryShift would: flip it and mark when it changed.
    let far = null;
    for (let r = 0; r < Z.NR && !far; r++) { const x = ((r % Z.RW) * 9 + 5) * 32, y = (Math.floor(r / Z.RW) * 9 + 5) * 32; if (Math.hypot(x - c.x, y - c.y) > 900) far = { x, y }; }
    MS.teleport(far.x, far.y); G.debugAim = 0; MS.update(1 / 30);
    Z.edges[k].open = !Z.edges[k].open; Z.edges[k].changedAt = G.t;
    return { k, rc, observed, now: Z.edges[k].open, far };
  });
  assert(s.observed.seenAgo < 0.05 && s.observed.mem === (s.observed.open ? 1 : 0), 'setup: the doorway was seen and remembered: ' + JSON.stringify(s.observed));
  await pg.keyboard.press('4');
  await gameWait(pg, 1.0);
  await pg.evaluate(() => MS.hold(true));
  const away = await pg.evaluate(k => {
    MS.r3Frame(); const G = MS.G;
    return { lens: G.p.lens, mem: G.mem[k], door: MS.r3Doors()[k], pres: MS.lensPresentation({ kind: 'door', k }, 3), drawn: MS.r3Survey().some(d => d.k === k), found: MS.events.some(ev => ev.type === 'doorDiscovered' && ev.k === k), chk: surveyCheck() };
  }, s.k);
  const oldShown = s.observed.open ? 'open' : 'closed';
  assert(away.lens === 3, 'Survey is up');
  assert(away.door.label === 'unlit' && away.door.shown === oldShown && away.pres.provenance === 'remembered' && away.pres.survey === null, 'out of reach, the doorway shows the remembered state only: ' + JSON.stringify(away));
  assert(!away.drawn && away.mem === (s.observed.open ? 1 : 0) && !away.found, 'Survey did not read it and memory is unchanged: ' + JSON.stringify(away));
  assert(away.chk.bad.length === 0, 'Survey matches the 2D rule: ' + JSON.stringify(away.chk));
  // back into reach, still unlit: Survey reads the true doorway (the 2D rule) and the simulation records the discovery
  await pg.evaluate(rc => { const G = MS.G; MS.teleport(rc.x, rc.y + 60); G.debugAim = Math.PI / 2; MS.hold(false); }, s.rc);
  await gameWait(pg, 0.6);
  await pg.evaluate(() => MS.hold(true));
  const near = await pg.evaluate(k => {
    MS.r3Frame(); const G = MS.G, sv = MS.r3Survey().find(d => d.k === k);
    return { seenAgo: G.t - G.doorSeenT[k], mem: G.mem[k], door: MS.r3Doors()[k], sv, found: MS.events.filter(ev => ev.type === 'doorDiscovered' && ev.k === k).map(ev => ev.how), chk: surveyCheck() };
  }, s.k);
  assert(near.seenAgo > 0.05 && near.door.label === 'unlit', 'setup: the doorway is still unlit, so the 3D doorway itself never shows it lit: ' + JSON.stringify(near));
  assert(near.sv && near.sv.state === (s.now ? 'open' : 'closed') && near.sv.provenance === 'ledgerEarned', 'in reach, Survey shows the earned true state: ' + JSON.stringify(near));
  assert(near.mem === (s.now ? 1 : 0) && near.found.includes('survey'), 'the simulation learned it by Survey: ' + JSON.stringify(near));
  assert(near.chk.bad.length === 0, 'Survey matches the 2D rule: ' + JSON.stringify(near.chk));
  await pg.shot('survey-08-changed-unseen');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey D: a real beacon (B key) pins an unlit doorway; brackets only during the 1.2 s flash, state never lit', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  const k = await pg.evaluate(() => {
    // 40 px west of the centre of the room east of the dock, facing west: the room's east doorway is pinned by a beacon
    // dropped here but about 184 px away, beyond its 150 px light, and behind the lantern (as in "3d brackets")
    const G = MS.G, Z = G.Z, east = Z.dockR + 1;
    MS.teleport(((east % Z.RW) * 9 + 5) * 32 - 40, (Math.floor(east / Z.RW) * 9 + 5) * 32);
    G.hollows.forEach(h => h.dead = true); G.debugAim = Math.PI; MS.update(0.016);
    return Z.edges.findIndex(e => e.v && e.a === east);
  });
  await pg.keyboard.press('4');
  await gameWait(pg, 0.6);
  const look = k => pg.evaluate(k => {
    MS.r3Frame(); const G = MS.G, e = G.Z.edges[k], c = doorAt(e), b = G.beacons[G.beacons.length - 1];
    const pres = MS.lensPresentation({ kind: 'door', k }, 3);
    // the brackets must not depend on whether the doorway is open: ask again with it flipped, then put it back
    e.open = !e.open; const flipped = MS.lensPresentation({ kind: 'door', k }, 3); e.open = !e.open;
    return { door: MS.r3Doors()[k], pres: { label: pres.label, brackets: pres.brackets, bracketA: pres.bracketA }, sameIfFlipped: flipped.brackets === pres.brackets && flipped.bracketA === pres.bracketA,
      pinned: MS.doorPinned(k), dist: b ? Math.round(Math.hypot(c.x - b.x, c.y - b.y)) : null, seenAgo: G.t - G.doorSeenT[k], flashAgo: G.pinFlash ? G.t - G.pinFlash.t : null, lens: G.p.lens, chk: surveyCheck() };
  }, k);
  await pg.evaluate(() => MS.hold(true));
  const before = await look(k);
  await pg.shot('survey-05-pinned-before');
  await pg.evaluate(() => MS.hold(false));
  const t0 = await pg.evaluate(() => MS.G.t);
  await pg.keyboard.press('b');
  await pg.waitForFunction(t0 => MS.G.pinFlash && MS.G.pinFlash.t >= t0, t0, { timeout: 10000 });
  await pg.evaluate(() => MS.hold(true));
  const during = await look(k);
  await pg.shot('survey-06-pinned-during-flash');
  const fade = await pg.evaluate(k => { MS.update(0.4); MS.r3Frame(); return MS.lensPresentation({ kind: 'door', k }, 3).bracketA; }, k);
  await pg.evaluate(() => MS.hold(false));
  await gameWait(pg, 1.3);
  await pg.evaluate(() => MS.hold(true));
  const after = await look(k);
  await pg.shot('survey-07-pinned-after');
  const memOnly = x => x.door.label === 'unlit' || x.door.label === 'unknown';
  assert(before.lens === 3 && !before.door.brackets && memOnly(before), 'before the beacon: no brackets, doorway shows memory only: ' + JSON.stringify(before));
  assert(during.pinned && during.dist > 150 && during.seenAgo > 0.1 && during.flashAgo < 1.2, 'setup: pinned, beyond the beacon light, unlit, inside the flash: ' + JSON.stringify(during));
  assert(during.door.brackets && memOnly(during), 'during the flash: brackets, and the doorway still shows memory only: ' + JSON.stringify(during));
  assert(during.pres.bracketA > fade && fade >= 0.55, 'the brackets fade with the flash: ' + during.pres.bracketA + ' then ' + fade);
  assert(during.sameIfFlipped && before.sameIfFlipped && after.sameIfFlipped, 'brackets are identical for an open and a shut doorway');
  assert(!after.door.brackets && after.seenAgo > 0.1 && after.flashAgo > 1.2 && memOnly(after), 'after the flash: no brackets on the unlit doorway: ' + JSON.stringify(after));
  for (const x of [before, during, after]) assert(x.chk.bad.length === 0, 'Survey matches the 2D rule: ' + JSON.stringify(x.chk));
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey E: with Survey up, unlit and walled-off entities give no signal in WebGL or on the overlay', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1, P = G.p, cv = document.getElementById('game'), c2 = cv.getContext('2d'), dpr = cv.width / innerWidth;
    const over = pts => pts.map(([x, y]) => Array.from(c2.getImageData(Math.round(x * dpr) - 1, Math.round(y * dpr) - 1, 3, 3).data).join(','));
    const rc = { x: ((east % Z.RW) * 9 + 5) * 32, y: (Math.floor(east / Z.RW) * 9 + 5) * 32 };
    MS.teleport(rc.x, rc.y - 96); G.debugAim = -Math.PI / 2;
    const hol = G.hollows[0], mimic = G.signals.find(s => !s.real), kinds = [...new Set(G.items.map(i => i.kind))], items = kinds.map(k => G.items.find(i => i.kind === k));
    G.hollows.slice(1).forEach(h => h.dead = true);
    G.escorts.push({ name: 'Test', trait: G.signals.find(s => s.real).trait, x: P.x, y: P.y, shaken: true, shakeT: 99, home: false, walk: 0, ang: 0 });
    const esc = G.escorts[G.escorts.length - 1];
    const ents = [['hollow', hol, 0.15], ['mimic', mimic, 0.35], ['escort', esc, 0.35], ...items.map(i => ['item:' + i.kind, i, { ember: 0.15, salvage: 0.08, relic: 0.32 }[i.kind] || 0.22])];
    MS.update(0.001); MS.r3Frame();
    const pk = [];
    for (let i = 0; i < Z.GW * Z.GH && pk.length < ents.length; i++) { const x = (i % Z.GW + 0.5) * 32, y = (Math.floor(i / Z.GW) + 0.5) * 32, p = MS.r3Project(x, y, 0); if (!Z.wall[i] && (p.x < -200 || p.y < -200 || p.x > innerWidth + 200 || p.y > innerHeight + 200) && !pk.some(q => Math.hypot(q.x - x, q.y - y) < 64)) pk.push({ x, y }); }
    ents.forEach(([, e], i) => { e.x = pk[i].x; e.y = pk[i].y; }); hol.emerge = 0;
    MS.update(0.001); MS.update(0.001); MS.r3Frame();
    const wallOn = (x1, y1) => { for (let s = 0; s <= 1; s += 1 / 64) { const x = P.x + (x1 - P.x) * s, y = P.y + (y1 - P.y) * s; if (Z.wall[Math.floor(x / 32) + Math.floor(y / 32) * Z.GW]) return true; } return false; };
    const cand = [];
    for (let ty = 0; ty < Z.GH; ty++) for (let tx = 0; tx < Z.GW; tx++) {
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32, p = MS.r3Project(x, y, 0);
      // the whole canvas less 10 px: WebGL readback is not covered by the HUD, and the overlay check below compares
      // the 2D layer at the same pixels with and without the entity, so HUD pixels compare equal
      if (p.behind || p.x < 10 || p.x > innerWidth - 10 || p.y < 10 || p.y > innerHeight - 10) continue;
      let m = 0; for (const dx of [-40, 0, 40]) for (const dy of [-40, 0, 40]) m = Math.max(m, MS.r3MaskAt(x + dx, y + dy));
      // strict: nothing at all in front of this floor, not even a remembered doorway's translucent glass or glow
      // (with doorway objects hidden, the two spots first picked here read 26 and 6.1 -> 0 and 0)
      if (m > 0.05 || !MS.r3FloorVisible(x, y, true).visible) continue;
      cand.push({ x, y, noEyes: Math.hypot(x - P.x, y - P.y) > 270 || wallOn(x, y) });
    }
    const spots = [], far = cand.find(c => c.noEyes);
    if (far) spots.push(far);
    for (const c of cand) if (spots.length < ents.length && !spots.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 40)) spots.push(c);   // 40 px: well clear of Hollow-escort contact (about 22 px)
    if (!far || spots.length < ents.length) return { spots: spots.length, need: ents.length };
    const pts = ents.map(([, , h], i) => { const p = MS.r3Project(spots[i].x, spots[i].y, h); return [p.x, p.y]; });
    const floor = MS.r3Read(pts); MS.r3Frame(); const floorO = over(pts);
    ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; }); hol.emerge = 0;
    MS.update(0.001); MS.update(0.001);
    ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; });
    const dark = MS.r3Read(pts); MS.r3Frame(); const darkO = over(pts);
    const darkVis = ents.map(([, e]) => !!e.vis && e !== esc);
    const provs = ents.map(([n, e]) => [n, n === 'hollow' ? MS.lensPresentation({ kind: 'hollow', i: G.hollows.indexOf(e) }, 3).provenance : n === 'mimic' ? MS.lensPresentation({ kind: 'voice', i: G.signals.indexOf(e) }, 3).provenance : n === 'escort' ? 'escort' : MS.lensPresentation({ kind: 'item', i: G.items.indexOf(e) }, 3).provenance]);
    const hi = MS.r3Entities().hollows[G.hollows.indexOf(hol)];
    // a Hollow behind a wall, inside eye range: nothing at all, and the wall in front of it reads the same
    let blocked = null;
    for (let ty = 0; ty < Z.GH && !blocked; ty++) for (let tx = 0; tx < Z.GW; tx++) {
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32, d = Math.hypot(x - P.x, y - P.y), p = MS.r3Project(x, y, 0.4);
      let m = 0; for (const dx of [-40, 0, 40]) for (const dy of [-40, 0, 40]) m = Math.max(m, MS.r3MaskAt(x + dx, y + dy));
      if (d > 120 && d < 230 && m <= 0.05 && wallOn(x, y) && !p.behind && p.x > 60 && p.x < innerWidth - 60 && p.y > 150 && p.y < innerHeight - 100) { blocked = { x, y, p: [p.x, p.y] }; break; }
    }
    let wall = null;
    if (blocked) {
      hol.x = pk[0].x; hol.y = pk[0].y; MS.update(0.001); hol.x = pk[0].x; hol.y = pk[0].y;
      const w0 = MS.r3Read([blocked.p])[0]; MS.r3Frame(); const o0 = over([blocked.p])[0];
      hol.x = blocked.x; hol.y = blocked.y; hol.emerge = 0; MS.update(0.001); hol.x = blocked.x; hol.y = blocked.y;
      const w1 = MS.r3Read([blocked.p])[0]; MS.r3Frame(); const o1 = over([blocked.p])[0];
      const e = MS.r3Entities().hollows[G.hollows.indexOf(hol)];
      wall = { w0, w1, sameOverlay: o0 === o1, eyes: e.eyes, body: e.body, simVis: e.simVis, prov: MS.lensPresentation({ kind: 'hollow', i: G.hollows.indexOf(hol) }, 3).provenance };
    }
    const E = MS.R3.E, roots = [E.warden, E.cone, E.sanct.g, MS.R3.survey.grid, ...[...E.hollows.values()].map(o => o.g), ...[...E.figs.values()].map(o => o.g), ...[...E.items.values()].map(o => o.g)];
    let casters = 0, reflective = 0;
    for (const root of roots) root.traverse(o => { if (o.castShadow) casters++; });
    MS.R3.scene.traverse(o => { for (const m of (o.material ? [].concat(o.material) : [])) if (m.envMap || m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) reflective++; });
    return { lens: P.lens, rows: ents.map(([n], i) => ({ n, floor: +floor[i].toFixed(1), dark: +dark[i].toFixed(1), sameOverlay: floorO[i] === darkO[i] })), darkVis, provs, hi, wall, casters, reflective, env: !!MS.R3.scene.environment, surveyOnly: MS.r3Survey().every(d => typeof d.k === 'number' && /^(OPEN|SHUT|PINNED)$/.test(d.tag)) };
  });
  assert(r.rows, 'enough dark floor on screen for every entity: ' + JSON.stringify(r));
  if (process.env.VERBOSE) console.log('      readback', JSON.stringify(r.rows), JSON.stringify(r.wall));
  assert(r.lens === 3, 'Survey is up');
  assert(!r.darkVis.some(Boolean), 'setup: the simulation counts them all unlit');
  for (const row of r.rows) assert(row.dark < 12 && Math.abs(row.dark - row.floor) <= 2 && row.sameOverlay, 'unlit ' + row.n + ' reads back at the unlit floor level, and the overlay is unchanged: ' + JSON.stringify(row));
  for (const [n, p] of r.provs) assert(p === 'unknown' || p === 'escort', 'presentation of unlit ' + n + ' is unknown: ' + p);
  assert(!r.hi.body && !r.hi.eyes, 'unlit Hollow beyond eye range: no body, no eyes: ' + JSON.stringify(r.hi));
  assert(r.wall, 'setup: a dark spot behind a wall within eye range, on screen');
  assert(!r.wall.simVis && !r.wall.body && !r.wall.eyes && r.wall.prov === 'unknown', 'behind a wall: no body, no eyes: ' + JSON.stringify(r.wall));
  assert(Math.abs(r.wall.w1 - r.wall.w0) <= 2 && r.wall.sameOverlay, 'behind a wall: the pixels in front of it are unchanged: ' + JSON.stringify(r.wall));
  assert(r.casters === 0 && r.reflective === 0 && !r.env, 'no shadow casters among entities or Survey marks, no reflective materials');
  assert(r.surveyOnly, 'Survey draws only doorway marks');
  await pg.shot('survey-04-entity-behind-wall');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey F: Survey rendering never calls Math.random, the adapter is pure, and the simulation is unchanged', async pg => {
  await r3ready(pg); await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const id = MS.G.node.id;
    let simCalls = 0, cosCalls = 0, adapterRng = 0, adapterWrites = 0, adapterCalls = 0;
    const fp = G => JSON.stringify({ t: G.t, seen: G.doorSeenT, mem: G.mem, open: G.Z.edges.map(e => e.open), p: [G.p.x, G.p.y, G.p.lens, G.p.aim], h: G.hollows.map(h => [h.x, h.y, h.vis, h.emerge]), s: G.signals.map(s => [s.x, s.y, s.vis]), it: G.items.map(i => [i.x, i.y, i.vis]), b: G.beacons.length, pin: G.pinFlash });
    const run = render => {
      const informed0 = MS.CH.exp.stats.lensInformed || 0;   // a chronicle counter: it carries over between runs
      MS.seed(77); MS.enterZone(id);
      const G = MS.G, Z = G.Z, east = Z.dockR + 1; G.debugAim = 0.6;
      MS.teleport(((east % Z.RW) * 9 + 5) * 32, (Math.floor(east / Z.RW) * 9 + 5) * 32);
      G.p.lens = 3;   // Survey up in both runs (setup: the lens changes the simulation, so both runs must have it)
      for (let i = 0; i < 900; i++) {
        MS.update(1 / 30);
        if (i % 120 === 60) MS.emit('flareBurst', { f: { x: G.p.x, y: G.p.y }, result: {} });
        if (!render) continue;
        const mr = Math.random, cr = MS.rng.cosmetic;
        Math.random = () => { simCalls++; return mr(); };
        MS.rng.cosmetic = () => { cosCalls++; return cr(); };
        try { MS.r3Frame(); } finally { Math.random = mr; MS.rng.cosmetic = cr; }
        if (i % 30 === 0) {   // the adapter: every doorway and entity, every lens; no random numbers, no writes
          const before = fp(G), saved = [Math.random, MS.rng.audio, MS.rng.visual, MS.rng.cosmetic], bump = f => () => { adapterRng++; return f(); };
          Math.random = bump(saved[0]); MS.rng.audio = bump(saved[1]); MS.rng.visual = bump(saved[2]); MS.rng.cosmetic = bump(saved[3]);
          try {
            for (let lens = 0; lens < 4; lens++) {
              G.Z.edges.forEach((e, k) => { MS.lensPresentation({ kind: 'door', k }, lens); adapterCalls++; });
              G.hollows.forEach((h, j) => { MS.lensPresentation({ kind: 'hollow', i: j }, lens); adapterCalls++; });
              G.signals.forEach((s, j) => { MS.lensPresentation({ kind: 'voice', i: j }, lens); adapterCalls++; });
              G.items.forEach((s, j) => { MS.lensPresentation({ kind: 'item', i: j }, lens); adapterCalls++; });
              G.beacons.forEach((s, j) => { MS.lensPresentation({ kind: 'beacon', i: j }, lens); adapterCalls++; });
            }
          } finally { [Math.random, MS.rng.audio, MS.rng.visual, MS.rng.cosmetic] = saved; }
          if (fp(G) !== before) adapterWrites++;
        }
      }
      return JSON.stringify({ doors: G.Z.edges.map(e => e.open ? 1 : 0).join(''), mem: G.mem.join(','), hollows: G.hollows.map(h => [Math.round(h.x), Math.round(h.y), h.kind]), sig: G.signals.map(s => [Math.round(s.x), Math.round(s.y)]), dim: G.dim.toFixed(4), shiftT: G.shiftT.toFixed(4), informed: (MS.CH.exp.stats.lensInformed || 0) - informed0 });
    };
    const off = run(false), on = run(true);
    return { same: off === on, off: off === on ? '' : off, on: off === on ? '' : on, simCalls, cosCalls, adapterRng, adapterWrites, adapterCalls, lens: MS.G.p.lens, drawn: MS.r3Survey().length };
  });
  assert(r.lens === 3 && r.drawn > 0, 'setup: Survey was up and drawing: ' + JSON.stringify(r));
  assert(r.cosCalls > 0, 'control: the 3D layer does draw from the cosmetic stream (Three.js object IDs): ' + JSON.stringify(r));
  assert(r.simCalls === 0, 'Survey rendering never calls the simulation\'s Math.random: ' + JSON.stringify(r));
  assert(r.adapterCalls > 1000 && r.adapterRng === 0 && r.adapterWrites === 0, 'getLensPresentation draws no random numbers and changes nothing: ' + JSON.stringify(r));
  assert(r.same, 'the same seed gives the same simulation with Survey rendered in 3D or not');
}, { query: '&r3d=1', seed: 23 });

await scenario('survey G: 600 rendered frames with Survey up; nothing unknown is ever shown', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => {
    const G = MS.G, bad = []; let frames = 0, drawnTotal = 0, bodies = 0;
    const memShown = m => m === 1 ? 'open' : m === 0 ? 'closed' : 'unknown';
    for (let i = 0; i < 600; i++) {
      G.debugAim = Math.sin(i / 70) * 2.2; G.debugFocus = i % 300 > 240;
      MS.update(1 / 30); MS.r3Frame(); frames++;
      const chk = surveyCheck(); drawnTotal += chk.n;
      if (chk.bad.length) bad.push({ i, survey: chk.bad[0] });
      MS.r3Doors().forEach(d => {
        const lit = G.t - G.doorSeenT[d.k] < 0.05;
        if (!lit && d.shown !== memShown(G.mem[d.k])) bad.push({ i, k: d.k, why: 'unlit doorway shows something other than memory', d });
        if (d.shown === 'unknown' && (d.slab || d.glow > 0)) bad.push({ i, k: d.k, why: 'unknown doorway drawn' });
      });
      const e = MS.r3Entities();
      e.hollows.forEach((h, k) => { if (!h) return; if (h.body) bodies++;
        if (h.body && !h.simVis) bad.push({ i, k, why: 'Hollow body while unlit' });
        if (h.eyes && !h.simVis && Math.hypot(h.x - G.p.x, h.y - G.p.y) >= 260) bad.push({ i, k, why: 'eyes beyond 260 px' }); });
      e.figs.forEach((f, k) => { if (f && k < G.signals.length && f.shown && !f.simVis) bad.push({ i, k, why: 'unlit voice shown' }); });
      e.items.forEach((it, k) => { if (it && it.shown && !it.simVis) bad.push({ i, k, why: 'unlit item shown' }); });
      if (G.p.lens !== 3) bad.push({ i, why: 'Survey dropped' });
    }
    return { frames, drawnTotal, bodies, nBad: bad.length, bad: bad.slice(0, 5) };
  });
  assert(r.frames === 600 && r.drawnTotal > 600, 'setup: 600 frames with Survey drawing: ' + JSON.stringify(r));
  assert(r.nBad === 0, 'no unknown state, hidden entity or out-of-reach mark in any frame: ' + JSON.stringify(r));
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey H: the Survey grid carries no layout; unlit walls and pillars do not show through it', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(control => {
    // a room far from the Sanctuary, lantern pressed against its north wall: most of the view is unlit
    const G = MS.G, Z = G.Z; let best = null;
    G.hollows.forEach(h => h.dead = true);
    for (let k = 0; k < Z.NR; k++) { const x = ((k % Z.RW) * 9 + 5) * 32, y = (Math.floor(k / Z.RW) * 9 + 5) * 32, d = Math.hypot(x - G.sanct.x, y - G.sanct.y); if (!best || d > best.d) best = { x, y, d, k }; }
    MS.teleport(best.x, Math.floor(best.k / Z.RW) * 288 + 54); G.debugAim = -Math.PI / 2;
    for (let i = 0; i < 4; i++) MS.update(1 / 30);
    if (control) { MS.R3.survey.mat.depthTest = true; MS.R3.survey.mat.needsUpdate = true; }   // the bug this guards against
    MS.r3Read([]);
    // screen points whose floor and surroundings (two tiles each way) are unlit: walls there are unlit too
    const pts = [];
    for (let sy = 20; sy < innerHeight - 20; sy += 14) for (let sx = 20; sx < innerWidth - 20; sx += 14) {
      const w = MS.r3ScreenToWorld(sx, sy); if (!w || w.x < 0 || w.y < 0 || w.x >= Z.GW * 32 || w.y >= Z.GH * 32) continue;
      if (Math.hypot(w.x - G.p.x, w.y - G.p.y) > 700) continue;   // inside the grid's 760 px reach
      let m = 0; for (const dx of [-64, -32, 0, 32, 64]) for (const dy of [-64, -32, 0, 32, 64]) m = Math.max(m, MS.r3MaskAt(w.x + dx, w.y + dy) ?? 1);
      if (m < 0.05) pts.push([sx, sy]);
    }
    // the grid's own contribution (grid on minus grid off) at each point, with the walls in place and with them removed:
    // a grid that carries no layout adds the same either way (unlit wall and unlit floor differ slightly by themselves)
    const walls = MS.R3.scene.children.filter(o => o.isInstancedMesh), grid = MS.R3.survey.grid;
    const contrib = () => { const on = MS.r3Read(pts); grid.material.visible = false; const off = MS.r3Read(pts); grid.material.visible = true; return on.map((v, i) => v - off[i]); };
    const withWalls = contrib();
    walls.forEach(o => o.visible = false);
    const noWalls = contrib();
    walls.forEach(o => o.visible = true);
    let worst = 0, at = null, gridSeen = 0;
    pts.forEach((p, i) => { gridSeen = Math.max(gridSeen, noWalls[i]); const d = Math.abs(withWalls[i] - noWalls[i]); if (d > worst) { worst = d; at = { p, withWalls: withWalls[i], noWalls: noWalls[i] }; } });
    if (control) { MS.R3.survey.mat.depthTest = false; MS.R3.survey.mat.needsUpdate = true; }
    return { n: pts.length, worst, at, gridSeen, wallMeshes: walls.length, depthTest: MS.R3.survey.mat.depthTest, gridOn: MS.R3.survey.grid.visible };
  }, !!process.env.SURVEY_GRID_CONTROL);
  if (process.env.VERBOSE) console.log('      grid', JSON.stringify(r));
  assert(r.n > 200 && r.wallMeshes > 0 && r.gridOn && r.gridSeen > 5, 'setup: many unlit screen points, and the grid is visibly drawn there: ' + JSON.stringify(r));
  assert(r.worst <= 1, 'the grid adds the same light with walls and pillars present or removed: it shows no layout: ' + JSON.stringify(r));
  await pg.shot('survey-H-grid-darkness');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey views: lantern edge and darkness, for review', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const a = await pg.evaluate(() => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1;
    G.hollows.forEach(h => h.dead = true);
    MS.teleport(((east % Z.RW) * 9 + 5) * 32 - 60, (Math.floor(east / Z.RW) * 9 + 5) * 32 + 40); G.debugAim = -0.5;
    for (let i = 0; i < 4; i++) MS.update(1 / 30);
    MS.r3Frame(); return surveyCheck();
  });
  assert(a.bad.length === 0, 'lantern edge: Survey follows the 2D rule: ' + JSON.stringify(a));
  await pg.shot('survey-02-lantern-edge');
  const d = await pg.evaluate(() => {
    // a room far from the Sanctuary, lantern pressed against a wall: almost nothing is lit
    const G = MS.G, Z = G.Z;
    let best = null;
    for (let r = 0; r < Z.NR; r++) { const x = ((r % Z.RW) * 9 + 5) * 32, y = (Math.floor(r / Z.RW) * 9 + 5) * 32, dd = Math.hypot(x - G.sanct.x, y - G.sanct.y); if (!best || dd > best.dd) best = { x, y, dd, r }; }
    const ry = Math.floor(best.r / Z.RW) * 9 * 32;
    MS.teleport(best.x, ry + 32 + 22); G.debugAim = -Math.PI / 2;
    for (let i = 0; i < 4; i++) MS.update(1 / 30);
    MS.r3Frame(); return surveyCheck();
  });
  assert(d.bad.length === 0, 'darkness: Survey follows the 2D rule: ' + JSON.stringify(d));
  await pg.shot('survey-03-darkness');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey reduced motion: Survey is unchanged and still follows the 2D rule', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => { MS.r3Frame(); return { motion: MS.S.motion, lens: MS.G.p.lens, chk: surveyCheck() }; });
  assert(r.motion === false && r.lens === 3 && r.chk.n > 0 && r.chk.bad.length === 0, 'reduced motion with Survey up: ' + JSON.stringify(r));
  await pg.shot('survey-11-reduced-motion');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11, reducedMotion: 'reduce' });

await scenario('survey high contrast: set from Settings; Survey still follows the 2D rule', async pg => {
  await r3ready(pg);
  await pg.click('#btnSettings');
  await pg.click('[data-toggle="contrast"]');
  await pg.reload(); await pg.waitForFunction(() => window.MS && MS.state === 'title');
  await pg.evaluate(() => MS.seed(11));
  await r3ready(pg); await beginFirstPlace(pg); await defineSurveyCheck(pg);
  await pg.keyboard.press('4');
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => { MS.r3Frame(); return { hc: document.documentElement.classList.contains('hc'), contrast: MS.S.contrast, lens: MS.G.p.lens, chk: surveyCheck() }; });
  assert(r.hc && r.contrast && r.lens === 3 && r.chk.n > 0 && r.chk.bad.length === 0, 'high contrast with Survey up: ' + JSON.stringify(r));
  await pg.shot('survey-10-high-contrast');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await scenario('survey touch: on a phone, the LENS button raises Survey in 3D; controls stay clear of the lens bar', async pg => {
  await r3ready(pg);
  await pg.tap('#btnBegin'); await pg.tap('.rnode.avail'); await pg.tap('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  await defineSurveyCheck(pg);
  for (let i = 0; i < 3; i++) { await pg.tap('#tLens'); await gameWait(pg, 0.1); }
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => {
    MS.r3Frame();
    return { lens: MS.G.p.lens, three: document.documentElement.classList.contains('r3d'), chk: surveyCheck(), touch: !document.getElementById('touchUi').hidden,
      sizes: [...document.querySelectorAll('.tbtn')].map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.width), Math.round(r.bottom)]; }), lensTop: innerHeight - 14 - 34 };
  });
  assert(r.three && r.touch && r.lens === 3, 'three taps on LENS reach Survey, in 3D, with touch controls: ' + JSON.stringify(r));
  assert(r.chk.bad.length === 0, 'Survey follows the 2D rule on a phone: ' + JSON.stringify(r.chk));
  for (const [id, w, bottom] of r.sizes) assert(w >= 44 && bottom < r.lensTop - 4, id + ' is large enough and clear of the lens bar');
  await pg.shot('survey-12-phone');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11, viewport: { width: 390, height: 844 }, touch: true });

/* ---------- Step 5B: the Ember and Echo lenses in 3D ---------- */
// What 3D drew (after MS.r3Frame) against the 2D rule computed from raw state (drawEmberLens, drawEchoLens).
const defineLensCheck = pg => pg.evaluate(() => {
  const onS = (p, m) => !p.behind && p.x > -m && p.y > -m && p.x < innerWidth + m && p.y < innerHeight + m;
  window.emberCheck = () => {
    const G = MS.G, Z = G.Z, d = MS.r3Lens(), bad = [];
    if (!d || !d.items) return { bad: ['nothing drawn'], n: 0 };
    const got = new Map(d.items.map(x => [x.i, x]));
    G.items.forEach((it, i) => {
      const want = onS(MS.r3Project(it.x, it.y, 0.02), 60), g = got.get(i);
      const label = it.kind === 'ember' ? String(it.amt) : it.kind === 'salvage' ? it.amt + ' salvage' : it.kind === 'relic' ? 'relic' : 'your pack';
      if (want !== !!g) bad.push({ i, want, got: !!g });
      else if (g && (g.label !== label || g.provenance !== 'ledgerEarned')) bad.push({ i, label, g });
    });
    const tot = new Array(Z.NR).fill(0); for (const it of G.items) if (it.kind === 'ember') tot[Math.floor(it.y / 288) * Z.RW + Math.floor(it.x / 288)] += it.amt;
    const rooms = new Map(d.rooms.map(r => [r.k, r.total]));
    for (let k = 0; k < Z.NR; k++) {
      const p = MS.r3Project(((k % Z.RW) * 9 + 5) * 32, (Math.floor(k / Z.RW) * 9 + 5) * 32, 0.02), want = tot[k] > 0 && onS(p, 40);
      if (want !== rooms.has(k) || (want && rooms.get(k) !== tot[k])) bad.push({ room: k, want: tot[k], got: rooms.get(k) });
    }
    return { n: d.items.length, rooms: d.rooms.length, bad };
  };
  window.echoCheck = () => {
    const G = MS.G, P = G.p, d = MS.r3Lens(), bad = [];
    if (!d || !d.hollows) return { bad: ['nothing drawn'], n: 0 };
    const got = new Map(d.hollows.map(x => [x.i, x])), arrows = new Set(d.arrows);
    G.hollows.forEach((h, i) => {
      const on = onS(MS.r3Project(h.x, h.y, 0.02), 40), live = !h.frozen && h.emerge <= 0, g = got.get(i);
      const status = h.emerge > 0 ? 'FORMING' : h.kind !== 'plain' ? h.kind.toUpperCase() : h.frozen ? 'HELD' : 'MOVING';
      if (on !== !!g) bad.push({ i, on, got: !!g });
      else if (g && (g.status !== status || g.provenance !== 'ledgerEarned')) bad.push({ i, status, g });
      if (!on && arrows.has(i) !== (live && Math.hypot(h.x - P.x, h.y - P.y) < 700)) bad.push({ i, arrow: arrows.has(i) });
    });
    const vs = new Map(d.voices.map(x => [x.i, x]));
    G.signals.forEach((s, i) => {
      const on = onS(MS.r3Project(s.x, s.y, 0.02), 60), g = vs.get(i);
      if (on !== !!g || (!on && !arrows.has('v' + i))) { bad.push({ voice: i, on, got: !!g }); return; }
      if (!g) return;
      const chips = [];
      if (s.vis || s.heard) { if (s.verified) chips.push('✓ VERIFIED'); if (s.clues.pulse === 'off') chips.push('♥ OFF-BEAT'); else if (s.clues.pulse === 'in') chips.push('♥ IN TIME'); if (s.clues.moved) chips.push('↝ MOVED'); }
      if (g.label !== (s.heard ? s.name : 'voice') || g.chips.join() !== chips.join()) bad.push({ voice: i, heard: s.heard, g, chips });
    });
    return { n: d.hollows.length + d.voices.length + d.arrows.length + d.escorts + (d.heart ? 1 : 0), voices: d.voices.length, bad };   // n: every Echo mark
  };
});

const lensNormal = (name, key, lens, check, shot) => scenario(`${name} A: normal input raises the lens, crosses into the next room with it up, and lowers it`, async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineLensCheck(pg);
  await pg.mouse.move(1080, 350);
  await pg.keyboard.press(key);
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const a = await pg.evaluate(c => { MS.r3Frame(); return { lens: MS.G.p.lens, chk: window[c](), room: MS.R3.room }; }, check);
  assert(a.lens === lens && a.chk.n > 0 && a.chk.bad.length === 0, `key ${key} raises the lens and it follows the 2D rule: ` + JSON.stringify(a));
  await pg.shot(shot + '-01-full-light');
  await pg.evaluate(() => MS.hold(false));
  await pg.keyboard.down('d');
  try { await pg.waitForFunction(r0 => MS.R3.room !== r0, a.room, { timeout: 30000 }); } finally { await pg.keyboard.up('d'); }
  await gameWait(pg, 0.2);
  await pg.evaluate(() => MS.hold(true));
  const b = await pg.evaluate(c => { MS.r3Frame(); const G = MS.G, P = G.p, Z = G.Z; return { lens: P.lens, room: MS.R3.room, simRoom: Math.floor(P.y / 288) * Z.RW + Math.floor(P.x / 288), chk: window[c]() }; }, check);
  assert(b.lens === lens && b.room !== a.room && b.room === b.simRoom && b.chk.bad.length === 0, 'the lens stays up and correct across the camera move: ' + JSON.stringify(b));
  await pg.evaluate(() => MS.hold(false));
  await pg.keyboard.press(key);
  await gameWait(pg, 0.2);
  await pg.evaluate(() => MS.hold(true));
  const c = await pg.evaluate(() => { MS.r3Frame(); return { lens: MS.G.p.lens, drawn: MS.r3Lens() }; });
  assert(c.lens === 0 && c.drawn === null, `key ${key} again lowers it and its marks go: ` + JSON.stringify(c));
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await lensNormal('ember', '2', 1, 'emberCheck', 'ember');
await lensNormal('echo', '3', 2, 'echoCheck', 'echo');

// Hidden entities and world layout with a lens up: WebGL readback at the entity equals bare floor, the 2D layer is
// unchanged by things the lens may not show, and neither layer changes when walls and pillars are removed.
// Each check runs a control that does the forbidden thing and must be detected.
const lensLeak = (name, key, lens, shot) => scenario(`${name} B: hidden entities and layout give no signal with the lens up (with failing controls)`, async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineLensCheck(pg);
  await pg.keyboard.press(key);
  await gameWait(pg, 0.4);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(lens => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1, P = G.p, cv = document.getElementById('game'), c2 = cv.getContext('2d'), dpr = cv.width / innerWidth;
    const over = (pts, n = 40) => pts.map(([x, y]) => Array.from(c2.getImageData(Math.round(x * dpr) - n, Math.round(y * dpr) - n, 2 * n + 1, 2 * n + 1).data).join(','));
    const rc = { x: ((east % Z.RW) * 9 + 5) * 32, y: (Math.floor(east / Z.RW) * 9 + 5) * 32 };
    MS.teleport(rc.x, rc.y - 96); G.debugAim = -Math.PI / 2;
    const hol = G.hollows[0], mimic = G.signals.find(s => !s.real), item = G.items.find(i => i.kind === 'salvage') || G.items[0];
    G.hollows.slice(1).forEach(h => h.dead = true);
    const ents = [['hollow', hol, 0.15], ['mimic', mimic, 0.35], ['item', item, 0.08]];
    MS.update(0.001); MS.r3Frame();
    const pk = [];
    for (let i = 0; i < Z.GW * Z.GH && pk.length < 3; i++) { const x = (i % Z.GW + 0.5) * 32, y = (Math.floor(i / Z.GW) + 0.5) * 32, p = MS.r3Project(x, y, 0); if (!Z.wall[i] && (p.x < -300 || p.y < -300 || p.x > innerWidth + 300 || p.y > innerHeight + 300) && !pk.some(q => Math.hypot(q.x - x, q.y - y) < 64)) pk.push({ x, y }); }
    const park = () => { ents.forEach(([, e], i) => { e.x = pk[i].x; e.y = pk[i].y; }); hol.emerge = 0; MS.update(0.001); ents.forEach(([, e], i) => { e.x = pk[i].x; e.y = pk[i].y; }); };
    park(); MS.r3Frame();
    const t0 = G.t;   // every read below is at this same instant, so the sweep, pulses and heat rings stand still
    // dark spots: the whole neighbourhood unlit, nothing at all in front of the floor, beyond eye range or walled off
    const wallOn = (x1, y1) => { for (let s = 0; s <= 1; s += 1 / 64) { const x = P.x + (x1 - P.x) * s, y = P.y + (y1 - P.y) * s; if (Z.wall[Math.floor(x / 32) + Math.floor(y / 32) * Z.GW]) return true; } return false; };
    const spots = [], cand = [];
    for (let ty = 0; ty < Z.GH; ty++) for (let tx = 0; tx < Z.GW; tx++) {
      if (Z.wall[tx + ty * Z.GW]) continue;
      const x = (tx + 0.5) * 32, y = (ty + 0.5) * 32, p = MS.r3Project(x, y, 0);
      if (p.behind || p.x < 70 || p.x > innerWidth - 70 || p.y < 70 || p.y > innerHeight - 70) continue;   // WebGL is not under the HUD; the 2D layer is compared at the same pixels
      let m = 0; for (const dx of [-40, 0, 40]) for (const dy of [-40, 0, 40]) m = Math.max(m, MS.r3MaskAt(x + dx, y + dy));
      if (m > 0.05 || !MS.r3FloorVisible(x, y, true).visible) continue;
      cand.push({ x, y, p, walled: wallOn(x, y), noEyes: Math.hypot(x - P.x, y - P.y) > 270 || wallOn(x, y) });
    }
    // the Hollow's spot out of eye range (eyes in the dark are allowed there); all three far apart on screen, so one
    // entity's marks miss the others' pixels
    const first = cand.find(c => c.noEyes); if (first) spots.push(first);
    for (const c of cand) if (spots.length < 3 && !spots.some(s => Math.hypot(s.p.x - c.p.x, s.p.y - c.p.y) < 130)) spots.push(c);
    if (spots.length < 3) return { spots: spots.length, cand: cand.length };
    const pts = ents.map(([, , h], i) => { const p = MS.r3Project(spots[i].x, spots[i].y, h); return [p.x, p.y]; });
    G.t = t0; const floorGL = MS.r3Read(pts); MS.r3Frame(); const floorO = over(pts);
    const place = () => { ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; }); hol.emerge = 0; MS.update(0.001); ents.forEach(([, e], i) => { e.x = spots[i].x; e.y = spots[i].y; }); G.t = t0; };
    place();
    const vis = ents.map(([, e]) => !!e.vis);
    const darkGL = MS.r3Read(pts); MS.r3Frame(); const darkO = over(pts);
    const drawn = MS.r3Lens();
    // controls: (1) the forbidden 3D leak, each hidden mesh forced visible, must change its pixel;
    // (2) the forbidden overlay leak, the other lens's marks for these entities, must change the 2D layer
    const E = MS.R3.E, objs = [E.hollows.get(hol).bodyG, E.figs.get(mimic).g, E.items.get(item).g];
    // a leaking lens would draw the hidden entity highlighted, past the light mask: show each mesh with an unmasked colour
    const swaps = [], hi = new MS.R3.T.MeshBasicMaterial({ color: 0x6fe3d2 });
    objs.forEach(o => { o.visible = true; o.traverse(m => { if (m.isMesh) { swaps.push([m, m.material]); m.material = hi; } }); });
    MS.R3.renderer.render(MS.R3.scene, MS.R3.camera);
    const gl = MS.R3.renderer.getContext(), cvs = MS.R3.canvas, sx = cvs.width / innerWidth, sy = cvs.height / innerHeight, px = new Uint8Array(36);
    const leakGL = pts.map(([x, y]) => { gl.readPixels(Math.round(x * sx) - 1, cvs.height - Math.round(y * sy) - 2, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, px); let s = 0; for (let i = 0; i < 36; i += 4) s += (px[i] + px[i + 1] + px[i + 2]) / 3; return s / 9; });
    swaps.forEach(([m, mat]) => m.material = mat); objs.forEach(o => o.visible = false);
    const keep = P.lens; P.lens = lens === 1 ? 2 : 1; MS.r3Frame(); const otherO = over(pts); P.lens = keep; MS.r3Frame();
    // layout: with walls and pillars removed, the 2D layer reads the same, and the lens adds nothing to the 3D layer
    const walls = MS.R3.scene.children.filter(o => o.isInstancedMesh);
    const all = []; for (let y = 30; y < innerHeight - 30; y += 37) for (let x = 30; x < innerWidth - 30; x += 37) all.push([x, y]);
    MS.r3Frame(); const oWalls = over(all, 1);
    walls.forEach(o => o.visible = false); MS.r3Frame(); const oNoWalls = over(all, 1); walls.forEach(o => o.visible = true);
    // in unlit regions only: the lantern cone's size follows the lens-shrunk reach, which is the lantern, not a lens mark
    const darkPts = all.filter(([x, y]) => { const w = MS.r3ScreenToWorld(x, y); if (!w) return false; let m = 0; for (const dx of [-64, 0, 64]) for (const dy of [-64, 0, 64]) m = Math.max(m, MS.r3MaskAt(w.x + dx, w.y + dy) ?? 1); return m < 0.05; });
    const glLens = MS.r3Read(darkPts); P.lens = 0; const glNoLens = MS.r3Read(darkPts); P.lens = keep; MS.r3Frame();
    let glDiff = 0; darkPts.forEach((p, i) => glDiff = Math.max(glDiff, Math.abs(glLens[i] - glNoLens[i])));
    return { lens: P.lens, vis, walled: spots.map(s => s.walled), drawn,
      rows: ents.map(([n], i) => ({ n, floor: +floorGL[i].toFixed(1), dark: +darkGL[i].toFixed(1), leak: +leakGL[i].toFixed(1), overlaySame: floorO[i] === darkO[i], otherLensDiffers: otherO[i] !== darkO[i] })),
      layoutSame: oWalls.every((v, i) => v === oNoWalls[i]), layoutN: all.length, glDiff, glN: darkPts.length };
  }, lens);
  assert(r.rows, 'setup: enough far-apart dark spots on screen: ' + JSON.stringify(r));
  if (process.env.VERBOSE) console.log('      ' + name, JSON.stringify(r.rows), 'glDiff', r.glDiff);
  assert(r.lens === lens && !r.vis.some(Boolean), 'setup: the lens is up and the simulation counts every entity unlit: ' + JSON.stringify(r.vis));
  for (const row of r.rows) {
    assert(row.dark < 12 && Math.abs(row.dark - row.floor) <= 2, `unlit ${row.n}: WebGL reads bare floor: ` + JSON.stringify(row));
    assert(row.leak > row.dark + 12, `control: drawing the hidden ${row.n} highlighted is detected: ` + JSON.stringify(row));
  }
  // what each lens may show of these hidden entities, by the 2D rule: Ember marks items only; Echo marks Hollows and voices only
  const allowed = lens === 1 ? ['item'] : ['hollow', 'mimic'];
  for (const row of r.rows) {
    if (allowed.includes(row.n)) assert(!row.overlaySame, `${row.n}: the lens marks it, as 2D does: ` + JSON.stringify(row));
    else {
      assert(row.overlaySame, `${row.n}: the lens adds nothing for it on the 2D layer: ` + JSON.stringify(row));
      assert(row.otherLensDiffers, `control: the other lens's mark for the ${row.n} would be detected here: ` + JSON.stringify(row));
    }
  }
  assert(r.layoutSame, 'the 2D layer is identical with walls and pillars removed: the lens draws no layout');
  assert(r.glN > 50 && r.glDiff <= 1, 'in the dark, the lens adds nothing to the 3D layer (max difference ' + r.glDiff + ' over ' + r.glN + ' points)');
  await pg.shot(shot + '-04-behind-wall');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await lensLeak('ember', '2', 1, 'ember');
await lensLeak('echo', '3', 2, 'echo');

await scenario('echo C: voices: never heard shows only "voice"; a drifted mimic shows where it is now, with no clue it has not earned', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineLensCheck(pg);
  await pg.keyboard.press('3');
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(() => {
    const G = MS.G, P = G.p, mimic = G.signals.find(s => !s.real), real = G.signals.find(s => s.real);
    G.hollows.forEach(h => h.dead = true); MS.update(0.001);
    const at = s => { MS.r3Frame(); const k = G.signals.indexOf(s), v = MS.r3Lens().voices.find(x => x.i === k); return { v, pres: MS.lensPresentation({ kind: 'voice', i: k }, 2).echo, chk: echoCheck() }; };
    // never heard, unlit: the pulse only, no name, no clues
    Object.assign(mimic, { heard: false, vis: false, verified: false, clues: { pulse: null, moved: false } });
    mimic.x = P.x + 90; mimic.y = P.y + 40;
    const unheard = at(mimic);
    // it drifts while unseen: Echo follows its current pulse; the MOVED clue is not shown until the ledger has it
    mimic.x += 60; mimic.y += 30;
    const drifted = at(mimic);
    // heard, with the clues the ledger holds: name and those chips
    Object.assign(mimic, { heard: true, clues: { pulse: 'off', moved: true } });
    const heard = at(mimic);
    return { unheard, drifted, heard, pos: [mimic.x, mimic.y], name: mimic.name, realChk: at(real).chk };
  });
  assert(r.unheard.v && r.unheard.v.label === 'voice' && !r.unheard.v.named && r.unheard.v.chips.length === 0 && r.unheard.pres.provenance === 'ledgerEarned', 'never heard: a pulse labelled "voice", no name, no clues: ' + JSON.stringify(r.unheard));
  assert(r.drifted.v && r.drifted.v.chips.length === 0 && r.drifted.chk.bad.length === 0, 'drifted unseen: current pulse, still no clue: ' + JSON.stringify(r.drifted));
  assert(r.heard.v.label === r.name && r.heard.v.chips.join() === '♥ OFF-BEAT,↝ MOVED', 'heard: its name and the clues in its ledger: ' + JSON.stringify(r.heard));
  for (const x of [r.unheard, r.drifted, r.heard]) assert(x.chk.bad.length === 0, 'Echo matches the 2D rule: ' + JSON.stringify(x.chk));
  await pg.shot('echo-voices');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

const lensStable = (name, key, lens, check) => scenario(`${name} G: 600 rendered frames with the lens up; nothing hidden is ever drawn`, async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineLensCheck(pg);
  await pg.keyboard.press(key);
  await gameWait(pg, 0.3);
  await pg.evaluate(() => MS.hold(true));
  const r = await pg.evaluate(([c, lens]) => {
    const G = MS.G, bad = []; let frames = 0, marks = 0;
    for (let i = 0; i < 600; i++) {
      G.debugAim = Math.sin(i / 70) * 2.2; G.debugFocus = i % 300 > 240;
      MS.update(1 / 30); MS.r3Frame(); frames++;
      const chk = window[c](); marks += chk.n;
      if (chk.bad.length) bad.push({ i, lens: chk.bad[0] });
      const e = MS.r3Entities();
      e.hollows.forEach((h, k) => { if (h && h.body && !h.simVis) bad.push({ i, k, why: 'Hollow body while unlit' }); if (h && h.eyes && !h.simVis && Math.hypot(h.x - G.p.x, h.y - G.p.y) >= 260) bad.push({ i, k, why: 'eyes beyond 260 px' }); });
      e.figs.forEach((f, k) => { if (f && k < G.signals.length && f.shown && !f.simVis) bad.push({ i, k, why: 'unlit voice shown' }); });
      e.items.forEach((it, k) => { if (it && it.shown && !it.simVis) bad.push({ i, k, why: 'unlit item shown' }); });
      if (G.p.lens !== lens) bad.push({ i, why: 'lens dropped' });
    }
    return { frames, marks, nBad: bad.length, bad: bad.slice(0, 5) };
  }, [check, lens]);
  assert(r.frames === 600 && r.marks > 0, 'setup: 600 frames with lens marks: ' + JSON.stringify(r));
  assert(r.nBad === 0, 'in every frame the lens follows the 2D rule and no hidden mesh is shown: ' + JSON.stringify(r));
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

await lensStable('ember', '2', 1, 'emberCheck');
await lensStable('echo', '3', 2, 'echoCheck');

await scenario('ember+echo F: lens rendering never calls Math.random, the adapter is pure, and the simulation is unchanged', async pg => {
  await r3ready(pg); await beginFirstPlace(pg);
  const r = await pg.evaluate(() => {
    const id = MS.G.node.id;
    let simCalls = 0, cosCalls = 0, adapterRng = 0, adapterWrites = 0, adapterCalls = 0, drawnE = 0, drawnH = 0;
    const fp = G => JSON.stringify({ t: G.t, seen: G.doorSeenT, mem: G.mem, p: [G.p.x, G.p.y, G.p.lens, G.p.lensT, G.p.aim], h: G.hollows.map(h => [h.x, h.y, h.vis, h.emerge, h.ping]), s: G.signals.map(s => [s.x, s.y, s.vis, s.heard, s.seenEchoT]), it: G.items.map(i => [i.x, i.y, i.vis, i.amt]) });
    const run = render => {
      MS.seed(77); MS.enterZone(id);
      const G = MS.G, Z = G.Z, east = Z.dockR + 1; G.debugAim = 0.6;
      MS.teleport(((east % Z.RW) * 9 + 5) * 32, (Math.floor(east / Z.RW) * 9 + 5) * 32);
      for (let i = 0; i < 900; i++) {
        G.p.lens = i < 450 ? 1 : 2; if (i === 450) G.p.lensT = G.t;   // Ember, then Echo (setup: the same in both runs)
        MS.update(1 / 30);
        if (i % 120 === 60) MS.emit('flareBurst', { f: { x: G.p.x, y: G.p.y }, result: {} });
        if (!render) continue;
        const mr = Math.random, cr = MS.rng.cosmetic;
        Math.random = () => { simCalls++; return mr(); };
        MS.rng.cosmetic = () => { cosCalls++; return cr(); };
        try { MS.r3Frame(); } finally { Math.random = mr; MS.rng.cosmetic = cr; }
        const d = MS.r3Lens(); if (d && d.items) drawnE += d.items.length; if (d && d.hollows) drawnH += d.hollows.length + d.voices.length;
        if (i % 30 === 0) {
          const before = fp(G), saved = [Math.random, MS.rng.audio, MS.rng.visual, MS.rng.cosmetic], bump = f => () => { adapterRng++; return f(); };
          Math.random = bump(saved[0]); MS.rng.audio = bump(saved[1]); MS.rng.visual = bump(saved[2]); MS.rng.cosmetic = bump(saved[3]);
          try {
            for (let lens = 0; lens < 4; lens++) {
              G.hollows.forEach((h, j) => { MS.lensPresentation({ kind: 'hollow', i: j }, lens); adapterCalls++; });
              G.signals.forEach((s, j) => { MS.lensPresentation({ kind: 'voice', i: j }, lens); adapterCalls++; });
              G.escorts.forEach((s, j) => { MS.lensPresentation({ kind: 'escort', i: j }, lens); adapterCalls++; });
              G.items.forEach((s, j) => { MS.lensPresentation({ kind: 'item', i: j }, lens); adapterCalls++; });
              for (let k = 0; k < Z.NR; k++) { MS.lensPresentation({ kind: 'room', k }, lens); adapterCalls++; }
              MS.lensPresentation({ kind: 'sanctuary' }, lens); adapterCalls++;
            }
          } finally { [Math.random, MS.rng.audio, MS.rng.visual, MS.rng.cosmetic] = saved; }
          if (fp(G) !== before) adapterWrites++;
        }
      }
      return JSON.stringify({ doors: G.Z.edges.map(e => e.open ? 1 : 0).join(''), mem: G.mem.join(','), hollows: G.hollows.map(h => [Math.round(h.x), Math.round(h.y), h.kind, h.ping ?? null]), sig: G.signals.map(s => [Math.round(s.x), Math.round(s.y), s.heard, +s.seenEchoT.toFixed(3), s.clues.pulse]), dim: G.dim.toFixed(4), shiftT: G.shiftT.toFixed(4) });
    };
    const off = run(false), on = run(true);
    return { same: off === on, off: off === on ? '' : off, on: off === on ? '' : on, simCalls, cosCalls, adapterRng, adapterWrites, adapterCalls, drawnE, drawnH };
  });
  assert(r.drawnE > 0 && r.drawnH > 0, 'setup: both lenses drew marks: ' + JSON.stringify(r));
  assert(r.cosCalls > 0, 'control: the 3D layer does draw from the cosmetic stream: ' + JSON.stringify(r));
  assert(r.simCalls === 0, 'Ember and Echo rendering never call the simulation\'s Math.random: ' + JSON.stringify(r));
  assert(r.adapterCalls > 1000 && r.adapterRng === 0 && r.adapterWrites === 0, 'getLensPresentation draws no random numbers and changes nothing: ' + JSON.stringify(r));
  assert(r.same, 'the same seed gives the same simulation (including Hollow ping state) with the lenses rendered in 3D or not: ' + JSON.stringify(r));
}, { query: '&r3d=1', seed: 23 });

await scenario('ember+echo views: lantern edge and darkness, for review', async pg => {
  await r3ready(pg); await beginFirstPlace(pg); await defineLensCheck(pg);
  await pg.evaluate(() => MS.hold(true));
  const place = which => pg.evaluate(which => {
    const G = MS.G, Z = G.Z, east = Z.dockR + 1;
    G.hollows.forEach((h, i) => { if (i) h.dead = true; });
    if (which === 'edge') { MS.teleport(((east % Z.RW) * 9 + 5) * 32 - 60, (Math.floor(east / Z.RW) * 9 + 5) * 32 + 40); G.debugAim = -0.5; }
    else { let best = null; for (let r = 0; r < Z.NR; r++) { const x = ((r % Z.RW) * 9 + 5) * 32, y = (Math.floor(r / Z.RW) * 9 + 5) * 32, dd = Math.hypot(x - G.sanct.x, y - G.sanct.y); if (!best || dd > best.dd) best = { x, y, dd, r }; } MS.teleport(best.x, Math.floor(best.r / Z.RW) * 288 + 54); G.debugAim = -Math.PI / 2; }
    for (let i = 0; i < 4; i++) MS.update(1 / 30);
  }, which);
  const look = async (lens, check, file) => {
    const r = await pg.evaluate(([lens, c]) => { MS.G.p.lens = lens; MS.G.p.lensT = MS.G.t - 0.5; MS.r3Frame(); return window[c](); }, [lens, check]);
    assert(r.bad.length === 0, file + ': follows the 2D rule: ' + JSON.stringify(r));
    await pg.shot(file);
  };
  await place('edge'); await look(1, 'emberCheck', 'ember-02-lantern-edge'); await look(2, 'echoCheck', 'echo-02-lantern-edge');
  await place('dark'); await look(1, 'emberCheck', 'ember-03-darkness'); await look(2, 'echoCheck', 'echo-03-darkness');
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11 });

for (const [label, opts, prep] of [
  ['reduced motion', { reducedMotion: 'reduce' }, null],
  ['high contrast', {}, async pg => { await pg.click('#btnSettings'); await pg.click('[data-toggle="contrast"]'); await pg.reload(); await pg.waitForFunction(() => window.MS && MS.state === 'title'); await pg.evaluate(() => MS.seed(11)); }],
]) {
  await scenario(`ember+echo ${label}: both lenses still follow the 2D rule`, async pg => {
    await r3ready(pg); if (prep) { await prep(pg); await r3ready(pg); }
    await beginFirstPlace(pg); await defineLensCheck(pg);
    const tag = label === 'reduced motion' ? '11-reduced-motion' : '10-high-contrast';
    for (const [key, lens, check, file] of [['2', 1, 'emberCheck', 'ember'], ['3', 2, 'echoCheck', 'echo']]) {
      await pg.evaluate(() => MS.hold(false));
      await pg.keyboard.press(key); await gameWait(pg, 0.4);
      await pg.evaluate(() => MS.hold(true));
      const r = await pg.evaluate(([lens, c]) => { MS.r3Frame(); return { lens: MS.G.p.lens, motion: MS.S.motion, hc: document.documentElement.classList.contains('hc'), chk: window[c]() }; }, [lens, check]);
      assert(r.lens === lens && r.chk.bad.length === 0 && (label === 'reduced motion' ? r.motion === false : r.hc), `${file} with ${label}: ` + JSON.stringify(r));
      await pg.shot(`${file}-${tag}`);
    }
    noThreeWarnings(pg);
  }, Object.assign({ query: '&r3d=1', seed: 11 }, opts));
}

await scenario('ember+echo touch: on a phone, the LENS button reaches Ember then Echo in 3D', async pg => {
  await r3ready(pg);
  await pg.tap('#btnBegin'); await pg.tap('.rnode.avail'); await pg.tap('#goBtn');
  await pg.waitForFunction(() => MS.state === 'zone');
  await defineLensCheck(pg);
  for (const [lens, check, file] of [[1, 'emberCheck', 'ember'], [2, 'echoCheck', 'echo']]) {
    await pg.evaluate(() => MS.hold(false));
    await pg.tap('#tLens'); await gameWait(pg, 0.3);
    await pg.evaluate(() => MS.hold(true));
    const r = await pg.evaluate(([lens, c]) => { MS.r3Frame(); return { lens: MS.G.p.lens, three: document.documentElement.classList.contains('r3d'), chk: window[c]() }; }, [lens, check]);
    assert(r.three && r.lens === lens && r.chk.bad.length === 0, `LENS tap reaches ${file} and it follows the 2D rule: ` + JSON.stringify(r));
    await pg.shot(`${file}-12-phone`);
  }
  noThreeWarnings(pg);
}, { query: '&r3d=1', seed: 11, viewport: { width: 390, height: 844 }, touch: true });

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
