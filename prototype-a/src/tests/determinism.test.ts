import { describe, expect, it } from 'vitest';
import { stateHash } from '../simulation/WorldState';
import { BEFORE_SHOT, CHUTE_IN, CHUTE_OUT, GATE_IN, HOME, MARKER, newGame } from './helpers';

function script(consumeOtherStreams: boolean) {
  const g = newGame(), hashes: string[] = [];
  for (const t of [BEFORE_SHOT, GATE_IN, MARKER, CHUTE_IN, CHUTE_OUT, HOME]) {
    g.walkTo(t.x, t.n);
    if (consumeOtherStreams) for (let i = 0; i < 97; i++) { g.rng.visual.next(); g.rng.audio.next(); }
    g.idle(90);
    hashes.push(stateHash(g.ws));
  }
  return { hashes, log: g.bus.log.map(e => `${e.step}:${e.type}`) };
}

describe('determinism and stream separation', () => {
  it('same seed and inputs give the same simulation, step for step', () => {
    expect(script(false)).toEqual(script(false));
  });
  it('consuming the visual and audio streams never changes the simulation', () => {
    expect(script(true)).toEqual(script(false));
  });
  it('different seeds change the world-RNG set dressing but not the rules', () => {
    const a = newGame(1).ws.dressing, b = newGame(2).ws.dressing;
    expect(a).not.toEqual(b);
  });
});
