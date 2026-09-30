import type { DoorwayStateId, LevelData, Point } from '../data/levelTypes';
import type { Collider } from '../player/Collision';
import type { Rng } from '../core/Rng';

export interface DoorwayCheck {
  seen: boolean;          // 1. current state seen >= seenSeconds in a stable composition
  leftView: boolean;      // 2. out of the camera's view for unobservedSeconds
  distance: boolean;      // 3. player >= minDistance away
  cutCrossed: boolean;    // 4. a camera cut after condition 1 was met
  notProtected: boolean;  // 5. no beacon holds it
  budget: boolean;        // pacing: fewer than maxChangesPerTrip changes on this trip
  routeOk: boolean | null;// 6. the way home survives the swap (null = not evaluated this step)
}

export interface WorldState {
  step: number;
  time: number;
  player: { x: number; n: number; prevX: number; prevN: number; vx: number; vn: number; facing: number };
  doorway: {
    state: DoorwayStateId;
    enteredByChange: boolean;
    changes: number;
    changesThisTrip: number;
    seenCurrent: number;
    unobservedFor: number;
    observed: boolean;
    screenFraction: number;
    cutAfterSeen: boolean;
    distance: number;
    check: DoorwayCheck;
    heldNotified: boolean;
    vetoCooldown: number;
  };
  beacon: { planted: boolean };
  camera: { active: string; cuts: number };
  objective: { phase: 'outbound' | 'return'; trips: number };
  visibleProps: string[];
  dressing: Array<Point & { r: number; id: string }>;
}

export function visiblePropsFor(level: LevelData, state: DoorwayStateId, enteredByChange: boolean): string[] {
  const s = level.doorway.states[state];
  return [...s.always, ...(enteredByChange ? s.changed : s.initial)];
}

/** Set dressing chosen by the world RNG: crates along the street walls, away from the doorway and cradle. */
function placeDressing(world: Rng): WorldState['dressing'] {
  const out: WorldState['dressing'] = [];
  for (let i = 0; i < 5; i++) {
    const west = i % 2 === 0;
    out.push({ id: `crate${i}`, x: west ? world.range(-3.6, -3.3) : world.range(3.3, 3.6), n: 2 + i * 4 + world.range(0, 2.5), r: 0.4 });
  }
  return out;
}

export function dressingColliders(ws: WorldState): Collider[] {
  return ws.dressing.map(d => ({ kind: 'circle' as const, id: d.id, x: d.x, n: d.n, r: d.r }));
}

export function createWorldState(level: LevelData, world: Rng): WorldState {
  const st = level.player.start, init = level.doorway.initial;
  return {
    step: 0,
    time: 0,
    player: { x: st.x, n: st.n, prevX: st.x, prevN: st.n, vx: 0, vn: 0, facing: 0 },
    doorway: {
      state: init, enteredByChange: false, changes: 0, changesThisTrip: 0, seenCurrent: 0, unobservedFor: 0, observed: false, screenFraction: 0,
      cutAfterSeen: false, distance: 0, heldNotified: false, vetoCooldown: 0,
      check: { seen: false, leftView: false, distance: false, cutCrossed: false, notProtected: true, budget: true, routeOk: null },
    },
    beacon: { planted: false },
    camera: { active: level.cameras[0].id, cuts: 0 },
    objective: { phase: 'outbound', trips: 0 },
    visibleProps: visiblePropsFor(level, init, false),
    dressing: placeDressing(world),
  };
}

/** Compact hash of everything the simulation decides, for determinism tests. */
export function stateHash(ws: WorldState): string {
  const p = ws.player, d = ws.doorway;
  const parts = [ws.step, p.x.toFixed(4), p.n.toFixed(4), p.vx.toFixed(4), p.vn.toFixed(4), d.state, d.changes, d.seenCurrent.toFixed(3),
    ws.beacon.planted ? 1 : 0, ws.camera.active, ws.camera.cuts, ws.objective.phase, ws.objective.trips,
    ws.dressing.map(c => c.x.toFixed(3) + ',' + c.n.toFixed(3)).join(';')];
  let h = 2166136261;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
