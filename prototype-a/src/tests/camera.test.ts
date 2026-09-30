import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CameraController } from '../camera/CameraController';
import { chooseRig } from '../camera/CameraVolume';
import { toWorldZ } from '../core/Space';
import { levelColliders } from '../player/Collision';
import { buildNavGrid, reachableFrom } from '../simulation/RouteGraph';
import { dressingColliders, visiblePropsFor } from '../simulation/WorldState';
import { BEFORE_SHOT, GATE_IN, MARKER, level, newGame } from './helpers';

const ASPECTS = { '16:9': 16 / 9, '16:10': 16 / 10, '21:9': 21 / 9 };

describe('camera volumes', () => {
  it('hysteresis: dithering in the doorway does not ping-pong the camera', () => {
    const rigs = level.cameras;
    let active = 'street', t = 0, switches = 0;
    for (let i = 0; i < 600; i++) {
      const p = { x: -1.6, n: 30.3 + 0.6 * Math.sin(i / 20) };  // +-0.6 m around the wall line
      const next = chooseRig(rigs, active, p, t, level.rules.volumeInset, level.rules.minDwellSeconds);
      if (next !== active) { switches++; active = next; t = 0; } else t += 1 / 60;
    }
    expect(switches).toBe(0);
  });

  it('a real crossing produces exactly one cut each way', () => {
    const g = newGame();
    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n); g.walkTo(GATE_IN.x, GATE_IN.n); g.walkTo(GATE_IN.x, 35); g.walkTo(GATE_IN.x, 28);
    expect(g.bus.log.filter(e => e.type === 'cameraCut').map(e => (e as { to: string }).to)).toEqual(['yard', 'street']);
  });
});

describe('control-frame hold across the cut', () => {
  it('holding "up" through the cut keeps walking the same way; after release, input follows the new camera', () => {
    const g = newGame();
    g.walkTo(GATE_IN.x, 28);
    const headings: number[] = [];
    let cutAt = -1;
    for (let i = 0; i < 150; i++) {
      g.step({ moveX: 0, moveY: 1, plant: false });
      if (cutAt < 0 && g.ws.camera.active === 'yard') cutAt = i;
      headings.push(Math.atan2(g.ws.player.vx, g.ws.player.vn));
    }
    expect(cutAt).toBeGreaterThan(0);
    const before = headings[cutAt - 2], after = headings.slice(cutAt, cutAt + 60);
    for (const h of after) expect(Math.abs(h - before)).toBeLessThan(0.05);
    // the two cameras really do face differently, so without the hold "up" would have turned the player
    const streetYaw = (() => { const c = new CameraController(level, 16 / 9); c.reset({ x: -1.6, n: 28 }); return c.yaw(); })();
    const yardYaw = (() => { const c = new CameraController(level, 16 / 9); c.reset({ x: -1.6, n: 33 }); return c.yaw(); })();
    expect(Math.abs(yardYaw - streetYaw)).toBeGreaterThan(0.2);
    // release, press again: now "up" means up on the yard camera
    g.idle(20);
    g.step({ moveX: 0, moveY: 1, plant: false });
    expect(g.player.holdYaw).toBeNull();
  });
});

describe('readability sweep: every walkable point, both cameras, three aspect ratios', () => {
  const dressing = dressingColliders(newGame().ws);
  // walkable points = union of reachable cells in both doorway states, sampled every 1 m
  const pts: Array<{ x: number; n: number }> = [];
  for (const state of ['A', 'B'] as const) {
    const g = buildNavGrid(level, levelColliders(level, visiblePropsFor(level, state, true), dressing));
    const seen = reachableFrom(g, level.player.start);
    for (let j = 0; j < g.rows; j += 2) for (let i = 0; i < g.cols; i += 2) {
      if (seen[j * g.cols + i]) pts.push({ x: g.x0 + (i + 0.5) * g.cell, n: g.n0 + (j + 0.5) * g.cell });
    }
  }

  for (const [name, aspect] of Object.entries(ASPECTS)) {
    it(`${name}: player inside the safe zone, 7-16% of screen height, not hidden (${pts.length} points)`, () => {
      const g = newGame();
      const cam = new CameraController(level, aspect);
      const failures: string[] = [];
      let minH = 1, maxH = 0, occluded = 0;
      for (const p of pts) {
        cam.reset(p);
        const feet = cam.ndc(new Vector3(p.x, 0, toWorldZ(p.n)))!, head = cam.ndc(new Vector3(p.x, level.player.height, toWorldZ(p.n)))!;
        const cx = (feet.x + head.x) / 4 + 0.5, cy = 0.5 - (feet.y + head.y) / 4;    // screen 0..1, y down
        const hFrac = Math.abs(head.y - feet.y) / 2;
        minH = Math.min(minH, hFrac); maxH = Math.max(maxH, hFrac);
        if (cx < 0.25 || cx > 0.75 || cy < 0.30 || cy > 0.75) failures.push(`${cam.activeId} (${p.x.toFixed(1)},${p.n.toFixed(1)}) centre ${cx.toFixed(2)},${cy.toFixed(2)}`);
        if (hFrac < 0.07 || hFrac > 0.16) failures.push(`${cam.activeId} (${p.x.toFixed(1)},${p.n.toFixed(1)}) height ${(hFrac * 100).toFixed(1)}%`);
        const chest = new Vector3(p.x, 1.2, toWorldZ(p.n));
        if (!cam.observe([chest], [], g.occluders, 0).observed) occluded++;
      }
      console.log(`  ${name}: player height ${(minH * 100).toFixed(1)}-${(maxH * 100).toFixed(1)}% of screen; hidden behind geometry at ${occluded}/${pts.length} points (faded by OcclusionDebug)`);
      expect(failures.slice(0, 10)).toEqual([]);
      expect(occluded / pts.length).toBeLessThan(0.05);
    });
  }
});

describe('before shot and after', () => {
  it('the before shot shows the doorway as a stable composition; the far marker does not', () => {
    const g = newGame();
    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n); g.idle(60);
    expect(g.lastObservation.observed).toBe(true);
    expect(g.lastObservation.screenFraction).toBeGreaterThanOrEqual(level.rules.minScreenFraction);
    g.walkTo(GATE_IN.x, GATE_IN.n); g.walkTo(MARKER.x, MARKER.n); g.idle(60);
    expect(g.lastObservation.observed).toBe(false);
  });
});
