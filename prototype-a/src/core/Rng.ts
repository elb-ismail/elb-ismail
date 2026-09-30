// Deterministic random streams. Each stream is seeded from (level seed, stream name), so consuming
// numbers in one stream never shifts another. Simulation code may only use `world` (and `test` in tests);
// `visual` and `audio` must never feed back into the simulation.

export interface Rng {
  next(): number;              // [0, 1)
  range(a: number, b: number): number;
  int(n: number): number;      // [0, n)
  snapshot(): number[];
}

function hashSeed(seed: number, name: string): number[] {
  // cyrb128: four 32-bit words from a string and a numeric seed.
  let h1 = 1779033703 ^ seed, h2 = 3144134277 ^ seed, h3 = 1013904242 ^ seed, h4 = 2773480762 ^ seed;
  for (let i = 0; i < name.length; i++) {
    const k = name.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

export function createRng(seed: number, name: string): Rng {
  let [a, b, c, d] = hashSeed(seed, name);
  const next = () => {
    // sfc32
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: n => Math.floor(next() * n),
    snapshot: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}

export type StreamName = 'world' | 'visual' | 'audio' | 'test';

export class RngStreams {
  readonly world: Rng;
  readonly visual: Rng;
  readonly audio: Rng;
  readonly test: Rng;
  constructor(readonly seed: number) {
    this.world = createRng(seed, 'world');
    this.visual = createRng(seed, 'visual');
    this.audio = createRng(seed, 'audio');
    this.test = createRng(seed, 'test');
  }
}
