import { Vector3 } from 'three';
import { Game } from '../core/Game';
import { toWorldZ } from '../core/Space';
import { prototypeA } from '../data/prototypeA';

export const level = prototypeA;
export const newGame = (seed = level.seed) => new Game(level, 16 / 9, seed);

// Scripted route points
export const BEFORE_SHOT = { x: -1.6, n: 24 };   // on the street, facing the doorway
export const CRADLE_SPOT = { x: -1.6, n: 26.5 }; // within plant range of the cradle
export const GATE_IN = { x: -1.6, n: 32 };        // just inside the yard through the gate
export const CHUTE_IN = { x: 1.6, n: 32 };        // just inside the yard through the chute
export const CHUTE_OUT = { x: 1.6, n: 28 };       // street side of the chute
export const MARKER = { x: 0, n: 41.7 };          // touching the far marker
export const HOME = { x: -1.5, n: -6 };

/**
 * Dense independent check of "can the player see the doorway geometry right now?": a grid of points over
 * both faces and the top of the doorway wall, with no NDC margin. Used to verify the sparse samples the
 * game uses are sufficient.
 */
export function doorwayVisibleDense(g: Game): boolean {
  const pts: Vector3[] = [];
  for (let x = -2.9; x <= 2.9; x += 0.4) for (let y = 0.2; y <= 3.3; y += 0.5) {
    pts.push(new Vector3(x, y, toWorldZ(29.8)), new Vector3(x, y, toWorldZ(30.8)));
  }
  for (let x = -2.9; x <= 2.9; x += 0.4) pts.push(new Vector3(x, 3.1, toWorldZ(30.3)));
  // props on the ground in front of the wall (sign, drag marks, railing)
  for (let x = -2.6; x <= 3.6; x += 0.6) for (let n = 25.2; n <= 29.6; n += 0.6) pts.push(new Vector3(x, 0.3, toWorldZ(n)));
  // faded occluders are see-through on screen, so they don't hide anything here either
  const solid = g.occluders.filter((_, i) => !g.fadedIds.has(g.occluderIds[i]));
  const o = g.camera.observe(pts, [], solid, 0);
  return o.observed;
}
