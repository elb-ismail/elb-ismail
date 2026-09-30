import { describe, expect, it } from 'vitest';
import type { LevelData } from '../data/levelTypes';
import { EventBus } from '../core/EventBus';
import { createRng } from '../core/Rng';
import { DoorwaySystem } from '../simulation/DoorwaySystem';
import { createWorldState } from '../simulation/WorldState';
import { BEFORE_SHOT, CHUTE_IN, CHUTE_OUT, CRADLE_SPOT, GATE_IN, HOME, MARKER, doorwayVisibleDense, level, newGame } from './helpers';

describe('doorway rule: the six conditions, one at a time', () => {
  const ready = () => {
    const bus = new EventBus(), sys = new DoorwaySystem(level, bus);
    const ws = createWorldState(level, createRng(1, 'world'));
    ws.doorway.seenCurrent = level.rules.seenSeconds + 0.1;
    ws.doorway.unobservedFor = level.rules.unobservedSeconds + 0.1;
    ws.doorway.cutAfterSeen = true;
    ws.player.x = 0; ws.player.n = 42;          // in the yard, far from the doorway
    return { bus, sys, ws };
  };
  const unseen = { observed: false, screenFraction: 0, cut: false };
  const dt = 1 / 60;

  it('changes when every condition holds, and records the evidence props', () => {
    const { sys, ws, bus } = ready();
    expect(sys.update(ws, unseen, dt, false)).toBe(true);
    expect(ws.doorway.state).toBe('B');
    expect(ws.visibleProps).toEqual(expect.arrayContaining(['gateFresh', 'signFaceDown', 'dragGate1', 'railingWest']));
    expect(bus.log.map(e => e.type)).toEqual(['doorwayChanged']);
  });

  it('1: not seen long enough', () => {
    const { sys, ws } = ready(); ws.doorway.seenCurrent = level.rules.seenSeconds - 0.5;
    expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.seen).toBe(false);
  });

  it('1: seen only as a speck does not count as seen', () => {
    const { sys, ws } = ready(); ws.doorway.seenCurrent = 0;
    for (let i = 0; i < 600; i++) sys.update(ws, { observed: true, screenFraction: level.rules.minScreenFraction / 3, cut: false }, dt, false);
    expect(ws.doorway.seenCurrent).toBe(0);
  });

  it('2: currently in view, or left view too recently', () => {
    const a = ready();
    expect(a.sys.update(a.ws, { observed: true, screenFraction: 0.05, cut: false }, dt, false)).toBe(false);
    const b = ready(); b.ws.doorway.unobservedFor = 0;
    expect(b.sys.update(b.ws, unseen, dt, false)).toBe(false);
    expect(b.ws.doorway.check.leftView).toBe(false);
  });

  it('3: player too close', () => {
    const { sys, ws } = ready(); ws.player.n = 30.3 + level.rules.minDistance - 0.5;
    expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.distance).toBe(false);
  });

  it('4: no camera cut after it was seen', () => {
    const { sys, ws } = ready(); ws.doorway.cutAfterSeen = false;
    expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.cutCrossed).toBe(false);
  });

  it('5: protected by a planted beacon (reported once as "held")', () => {
    const { sys, ws, bus } = ready();
    for (let i = 0; i < 120; i++) expect(sys.update(ws, unseen, dt, true)).toBe(false);
    expect(ws.doorway.state).toBe('A');
    expect(bus.log.filter(e => e.type === 'doorwayHeld')).toHaveLength(1);
  });

  it('6: a swap that would cut the way home is vetoed', () => {
    // A variant where state B also bricks the chute: nothing would connect the yard to the street.
    const trap: LevelData = structuredClone(level);
    trap.doorway.states.B.changed = [...trap.doorway.states.B.changed, 'chuteOld'];
    const bus = new EventBus(), sys = new DoorwaySystem(trap, bus);
    const ws = createWorldState(trap, createRng(1, 'world'));
    Object.assign(ws.doorway, { seenCurrent: 5, unobservedFor: 5, cutAfterSeen: true });
    ws.player.x = 0; ws.player.n = 42;
    expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.routeOk).toBe(false);
    expect(ws.doorway.state).toBe('A');
    expect(bus.log.map(e => e.type)).toEqual(['doorwayRouteVeto']);
  });

  it('4: a cut before the state was fully seen does not count', () => {
    const { sys, ws } = ready();
    Object.assign(ws.doorway, { seenCurrent: 1, cutAfterSeen: false });
    sys.update(ws, { observed: false, screenFraction: 0, cut: true }, dt, false);
    for (let i = 0; i < 240; i++) sys.update(ws, { observed: true, screenFraction: 0.05, cut: false }, dt, false); // now seen for 5 s
    for (let i = 0; i < 240; i++) expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.cutCrossed).toBe(false);
  });

  it('pacing: one change per trip from the Sanctuary', () => {
    const { sys, ws } = ready(); ws.doorway.changesThisTrip = 1;
    expect(sys.update(ws, unseen, dt, false)).toBe(false);
    expect(ws.doorway.check.budget).toBe(false);
  });

  it('after a change, the new state must itself be seen before it can change again', () => {
    const { sys, ws } = ready();
    sys.update(ws, unseen, dt, false);
    expect(ws.doorway.seenCurrent).toBe(0);
    for (let i = 0; i < 600; i++) expect(sys.update(ws, unseen, dt, false)).toBe(false);
  });
});

describe('doorway rule: scripted play through the real camera', () => {
  it('first trip: seen from the street, changes only after the cut into the yard, and never on screen', () => {
    const g = newGame();
    let visibleAtChange: boolean | null = null, obsAtChange: boolean | null = null, distAtChange = 0;
    g.bus.on(e => { if (e.type === 'doorwayChanged') { visibleAtChange = doorwayVisibleDense(g); obsAtChange = g.lastObservation.observed; distAtChange = g.ws.doorway.distance; } });

    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n);
    expect(g.ws.doorway.seenCurrent).toBeGreaterThanOrEqual(level.rules.seenSeconds);
    expect(g.ws.doorway.state).toBe('A');

    g.walkTo(GATE_IN.x, GATE_IN.n);
    expect(g.ws.camera.active).toBe('yard');
    expect(g.ws.doorway.state).toBe('A');          // still close: no change yet

    g.walkTo(MARKER.x, MARKER.n);
    g.idle(120);
    expect(g.ws.objective.phase).toBe('return');
    expect(g.ws.doorway.state).toBe('B');
    expect(g.ws.doorway.changes).toBe(1);
    expect(obsAtChange).toBe(false);
    expect(visibleAtChange).toBe(false);          // dense independent check: nothing of the doorway was on screen
    expect(distAtChange).toBeGreaterThanOrEqual(level.rules.minDistance);

    // return: the gate is bricked; the chute is open and leads back to the street
    expect(g.walkTo(GATE_IN.x, 29, 60 * 8)).toBe(60 * 8);  // blocked by the new brickwork
    g.walkTo(CHUTE_IN.x, CHUTE_IN.n);
    g.walkTo(CHUTE_OUT.x, CHUTE_OUT.n);
    expect(g.ws.camera.active).toBe('street');
    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n);
    expect(g.lastObservation.observed).toBe(true);  // the altered state is seen from the same composition as the before shot
    g.walkTo(HOME.x, HOME.n);
    expect(g.ws.objective.trips).toBe(1);
    expect(g.bus.log.filter(e => e.type === 'doorwayChanged')).toHaveLength(1);
  });

  it('second trip without a beacon: it can change back, but only after the new state was seen', () => {
    const g = newGame();
    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n); g.walkTo(GATE_IN.x, GATE_IN.n); g.walkTo(MARKER.x, MARKER.n); g.idle(120);
    g.walkTo(CHUTE_IN.x, CHUTE_IN.n); g.walkTo(CHUTE_OUT.x, CHUTE_OUT.n); g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n); g.walkTo(HOME.x, HOME.n);
    expect(g.ws.doorway.state).toBe('B');
    g.walkTo(BEFORE_SHOT.x, BEFORE_SHOT.n); g.walkTo(CHUTE_OUT.x, CHUTE_OUT.n); g.walkTo(CHUTE_IN.x, CHUTE_IN.n); g.walkTo(MARKER.x, MARKER.n); g.idle(120);
    expect(g.ws.doorway.state).toBe('A');
    expect(g.ws.visibleProps).toEqual(expect.arrayContaining(['chuteFresh', 'signCrooked', 'dragChute1', 'railingEast']));
  });

  it('with the beacon planted, the doorway holds and the player walks home the way they came', () => {
    const g = newGame();
    g.walkTo(CRADLE_SPOT.x, CRADLE_SPOT.n);
    g.step({ moveX: 0, moveY: 0, plant: true });
    expect(g.ws.beacon.planted).toBe(true);
    g.walkTo(GATE_IN.x, GATE_IN.n); g.walkTo(MARKER.x, MARKER.n); g.idle(300);
    expect(g.ws.doorway.state).toBe('A');
    expect(g.bus.log.filter(e => e.type === 'doorwayHeld')).toHaveLength(1);
    g.walkTo(GATE_IN.x, GATE_IN.n); g.walkTo(GATE_IN.x, 28); g.walkTo(HOME.x, HOME.n);
    expect(g.ws.objective.trips).toBe(1);
  });

  it('the beacon can be planted only at the cradle', () => {
    const g = newGame();
    g.walkTo(BEFORE_SHOT.x + 3, BEFORE_SHOT.n);
    g.step({ moveX: 0, moveY: 0, plant: true });
    expect(g.ws.beacon.planted).toBe(false);
  });

  it('random wandering (test RNG): every change happens off screen, far away, after a cut, with a way home', () => {
    const targets = [BEFORE_SHOT, GATE_IN, CHUTE_IN, CHUTE_OUT, MARKER, HOME, { x: 5, n: 38 }, { x: -6, n: 44 }, { x: 0, n: 12 }, CRADLE_SPOT];
    let changes = 0;
    for (let run = 0; run < 12; run++) {
      const g = newGame(1000 + run), rng = g.rng.test;
      const bad: string[] = [];
      g.bus.on(e => {
        if (e.type !== 'doorwayChanged') return;
        changes++;
        if (doorwayVisibleDense(g)) bad.push('visible');
        if (g.ws.doorway.distance < level.rules.minDistance) bad.push('close');
      });
      for (let leg = 0; leg < 14; leg++) {
        const t = targets[rng.int(targets.length)];
        g.walkTo(t.x + rng.range(-0.5, 0.5), t.n + rng.range(-0.5, 0.5), 60 * 12);
        if (rng.next() < 0.3) g.idle(rng.int(120));
      }
      expect(bad).toEqual([]);
    }
    expect(changes).toBeGreaterThan(0);
  });
});
