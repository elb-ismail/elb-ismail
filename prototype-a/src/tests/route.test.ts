import { describe, expect, it } from 'vitest';
import { levelColliders } from '../player/Collision';
import { buildNavGrid, homeReachable, reachableFrom, rectReachable } from '../simulation/RouteGraph';
import { dressingColliders, visiblePropsFor } from '../simulation/WorldState';
import { CHUTE_IN, GATE_IN, MARKER, level, newGame } from './helpers';

describe('walkability check (flood fill on the real colliders)', () => {
  const dressing = dressingColliders(newGame().ws);
  const yard = MARKER, street = { x: 0, n: 15 };

  for (const state of ['A', 'B'] as const) for (const changed of [false, true]) {
    it(`state ${state}${changed ? ' (after a change)' : ''}: home reachable from the yard and the street`, () => {
      const props = visiblePropsFor(level, state, changed);
      expect(homeReachable(level, props, yard, dressing)).toBe(true);
      expect(homeReachable(level, props, street, dressing)).toBe(true);
    });
  }

  it('state A: only the gate connects street and yard; state B: only the chute', () => {
    for (const [state, open, shut] of [['A', GATE_IN, CHUTE_IN], ['B', CHUTE_IN, GATE_IN]] as const) {
      const g = buildNavGrid(level, levelColliders(level, visiblePropsFor(level, state, true), dressing));
      const fromStreet = reachableFrom(g, street);
      const cell = (p: { x: number; n: number }) => Math.floor((p.n - g.n0) / g.cell) * g.cols + Math.floor((p.x - g.x0) / g.cell);
      // just inside the doorway wall on the yard side, in line with each opening
      expect(fromStreet[cell({ x: open.x, n: 31.2 })]).toBe(1);
      expect(g.free[cell({ x: shut.x, n: 30.3 })]).toBe(0);
    }
  });

  it('the check can fail: with both openings bricked, the yard is cut off', () => {
    const props = [...visiblePropsFor(level, 'A', false), 'gateOld'];
    expect(homeReachable(level, props, yard, dressing)).toBe(false);
    expect(homeReachable(level, props, street, dressing)).toBe(true);
  });

  it('the player start, the marker approach and the home rectangle are all walkable', () => {
    const g = buildNavGrid(level, levelColliders(level, visiblePropsFor(level, 'A', false), dressing));
    const seen = reachableFrom(g, level.player.start);
    expect(rectReachable(g, seen, level.home)).toBe(true);
    const m = level.objective;
    expect(rectReachable(g, seen, { x0: m.x - m.r, x1: m.x + m.r, n0: m.n - m.r, n1: m.n + m.r })).toBe(true);
  });
});
