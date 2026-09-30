import { Game } from './core/Game';
import { FixedStepLoop } from './core/FixedStepLoop';
import { PlaceholderAudio } from './core/PlaceholderAudio';
import { prototypeA } from './data/prototypeA';
import type { InputFrame } from './player/PlayerController';
import { buildScene } from './scene/SceneBuilder';
import { GrayboxLevel } from './scene/GrayboxLevel';
import { OcclusionDebug } from './scene/OcclusionDebug';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud } from './ui/Hud';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);

const game = new Game(prototypeA, aspect(), params.has('seed') ? Number(params.get('seed')) : prototypeA.seed);
const built = buildScene(canvas, prototypeA);
const gray = new GrayboxLevel(built.scene, prototypeA);
const occl = new OcclusionDebug(built.scene, prototypeA, built.occluders, gray);
const hud = new Hud(game);
const dbg = new DebugOverlay(game);
const audio = new PlaceholderAudio(game.bus, game.rng.audio);

gray.sync(game.ws);
game.bus.on(e => { if (e.type === 'doorwayChanged') gray.showProps(game.ws.visibleProps); });

function setDebug(on: boolean) { dbg.visible = on; occl.debug.visible = on; }
setDebug(params.get('debug') === '1');

// ---- input: keyboard, camera-relative ----
const keys = new Set<string>();
let plantLatched = false;
const MOVE: Record<string, [number, number]> = {
  w: [0, 1], arrowup: [0, 1], s: [0, -1], arrowdown: [0, -1], a: [-1, 0], arrowleft: [-1, 0], d: [1, 0], arrowright: [1, 0],
};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  audio.unlock();
  if (k in MOVE || k === ' ') e.preventDefault();
  if (e.repeat) return;
  if (k === 'e' || k === ' ') plantLatched = true;
  else if (k === 'r') restart();
  else if (k === 'f3' || k === '`') { e.preventDefault(); setDebug(!dbg.visible); }
  keys.add(k);
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

function readInput(): InputFrame {
  let x = 0, y = 0;
  for (const k of keys) { const m = MOVE[k]; if (m) { x += m[0]; y += m[1]; } }
  const plant = plantLatched; plantLatched = false;
  return { moveX: Math.sign(x), moveY: Math.sign(y), plant };
}

function restart() {
  game.reset(game.rng.seed);
  gray.sync(game.ws);
}

// ---- loop ----
function resize() {
  built.renderer.setSize(window.innerWidth, window.innerHeight, false);
  game.setAspect(aspect());
}
addEventListener('resize', resize);
resize();

const loop = new FixedStepLoop(prototypeA.rules.stepHz, () => game.step(readInput()), (alpha, secs) => {
  gray.update(game.ws, alpha, game.rng.visual);
  occl.update(game);
  hud.update();
  built.renderer.render(built.scene, game.camera.camera);
  dbg.update(secs, occl.fadedCount, built.renderer.info.render);
});
loop.start();

// ---- hooks for automated screenshots and playtest debugging (only with ?hooks or ?debug=1) ----
if (params.has('hooks') || params.get('debug') === '1') {
  Object.assign(window, {
    __proto: {
      game, restart, setDebug,
      walkTo: (x: number, n: number, max?: number) => game.walkTo(x, n, max),
      idle: (steps: number) => game.idle(steps),
      plant: () => game.step({ moveX: 0, moveY: 0, plant: true }),
      state: () => ({ ...game.ws, check: game.ws.doorway.check, observed: game.lastObservation.observed }),
      events: () => game.bus.log,
    },
  });
}
