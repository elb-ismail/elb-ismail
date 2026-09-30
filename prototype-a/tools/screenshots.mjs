// Screenshot tour of Prototype A, driven through the page's ?hooks API. Builds, serves with `vite preview`,
// captures the before and after compositions, the beacon run, and the occlusion fallback.
// Usage: npm run shots   (outputs to tools/out/)
import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const OUT = path.join(here, 'out'); mkdirSync(OUT, { recursive: true });
let chromium;
try { ({ chromium } = await import('playwright')); } catch { const req = createRequire(import.meta.url); ({ chromium } = req(path.join(execSync('npm root -g').toString().trim(), 'playwright'))); }

execSync('npx vite build', { cwd: root, stdio: 'ignore' });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: root, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] })
  .catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader'] }));
const errors = [];
try {
  for (const [tag, viewport] of [['16x9', { width: 1280, height: 720 }], ['21x9', { width: 1680, height: 720 }]]) {
    const pg = await browser.newPage({ viewport });
    pg.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
    pg.on('console', m => { if (m.type() === 'error') errors.push(`${tag}: ${m.text()}`); });
    await pg.goto('http://localhost:4173/?hooks');
    await pg.waitForFunction(() => window.__proto);
    const P = (fn, ...a) => pg.evaluate(fn, ...a);
    const frame = () => pg.waitForTimeout(250);
    const shot = async (name, debug = false) => { await P(d => __proto.setDebug(d), debug); await frame(); await pg.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) }); };
    const walk = (x, n) => P(([x, n]) => __proto.walkTo(x, n), [x, n]);

    await frame(); await shot('01-start');
    if (tag === '21x9') { await walk(-1.6, 24); await P(() => __proto.idle(30)); await shot('02-before-shot'); await pg.close(); continue; }
    await walk(-1.6, 24); await P(() => __proto.idle(30)); await shot('02-before-shot'); await shot('02b-before-shot-debug', true);
    await walk(-1.6, 32); await P(() => __proto.idle(20)); await shot('03-yard-entry');
    await walk(0, 41.7); await P(() => __proto.idle(120)); await shot('04-at-marker-changed-debug', true);
    await walk(0.5, 35.5); await P(() => __proto.idle(30)); await shot('05-yard-return-sees-wall-top');
    await walk(1.6, 32); await walk(1.6, 28); await walk(-1.6, 24); await P(() => __proto.idle(30)); await shot('06-after-shot'); await shot('06b-after-shot-debug', true);
    await walk(-1.5, -6); await P(() => __proto.idle(30)); await shot('07-home');
    // beacon run
    await P(() => __proto.restart()); await frame();
    await walk(-1.6, 26.5); await P(() => __proto.plant()); await P(() => __proto.idle(30)); await shot('08-beacon-planted');
    await walk(-1.6, 32); await walk(0, 41.7); await P(() => __proto.idle(200)); await shot('09-beacon-held-debug', true);
    await walk(-1.6, 32); await walk(-1.6, 24); await P(() => __proto.idle(30)); await shot('10-beacon-held-after');
    // occlusion fallback: hugging the doorway wall on the yard side
    await walk(-1.6, 32); await walk(-5, 31.1); await P(() => __proto.idle(30)); await shot('11-silhouette-behind-wall');
    const st = await P(() => { const s = __proto.state(); return { changes: s.doorway.changes, state: s.doorway.state, planted: s.beacon.planted }; });
    console.log('beacon run end state', JSON.stringify(st));
    await pg.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
