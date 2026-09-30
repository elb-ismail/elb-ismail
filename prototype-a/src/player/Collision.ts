import type { LevelData, PropShape, Point } from '../data/levelTypes';

export type Collider =
  | { kind: 'box'; id: string; x0: number; x1: number; n0: number; n1: number }
  | { kind: 'circle'; id: string; x: number; n: number; r: number };

/** The three posts of a railing: start, bent middle, end. Shared by collision and rendering. */
export function railingPolyline(s: Extract<PropShape, { kind: 'railing' }>): Point[] {
  return [{ x: s.x, n: s.n0 }, { x: s.x + s.bend, n: (s.n0 + s.n1) / 2 }, { x: s.x, n: s.n1 }];
}

function propColliders(id: string, s: PropShape): Collider[] {
  if (s.kind === 'fill') return [{ kind: 'box', id, ...s.rect }];
  if (s.kind === 'railing') {
    const pts = railingPolyline(s), out: Collider[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.n - a.n), steps = Math.ceil(len / 0.2);
      for (let k = 0; k <= steps; k++) out.push({ kind: 'circle', id: `${id}.${i}.${k}`, x: a.x + (b.x - a.x) * k / steps, n: a.n + (b.n - a.n) * k / steps, r: 0.08 });
    }
    return out;
  }
  return [];
}

/** Every collider for a given set of visible props, plus any extra circles (set dressing). */
export function levelColliders(level: LevelData, visibleProps: readonly string[], extra: readonly Collider[] = []): Collider[] {
  const out: Collider[] = [];
  for (const b of level.solids) out.push({ kind: 'box', id: b.id, x0: b.x0, x1: b.x1, n0: b.n0, n1: b.n1 });
  const s = level.sanctuary;
  out.push({ kind: 'box', id: 'sanctuary', x0: s.x0, x1: s.x1, n0: s.n0, n1: s.n1 });
  for (const c of level.circles) out.push({ kind: 'circle', id: c.id, x: c.x, n: c.n, r: c.r });
  for (const id of visibleProps) {
    const p = level.props.find(q => q.id === id);
    if (p?.solid) out.push(...propColliders(p.id, p.shape));
  }
  out.push(...extra);
  return out;
}

/** Push a circle of radius r out of all colliders. A few passes settle corners. */
export function pushOut(x: number, n: number, r: number, colliders: readonly Collider[]): { x: number; n: number } {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const c of colliders) {
      if (c.kind === 'box') {
        const cx = Math.max(c.x0, Math.min(x, c.x1)), cn = Math.max(c.n0, Math.min(n, c.n1));
        const dx = x - cx, dn = n - cn, d = Math.hypot(dx, dn);
        if (d > 1e-6 && d < r) { x = cx + dx / d * r; n = cn + dn / d * r; moved = true; }
        else if (d <= 1e-6) {
          // centre inside the box: leave along the shallowest face
          const opts = [[x - c.x0 + r, -1, 0], [c.x1 - x + r, 1, 0], [n - c.n0 + r, 0, -1], [c.n1 - n + r, 0, 1]].sort((a, b) => a[0] - b[0]);
          const [depth, sx, sn] = opts[0];
          x += sx * depth; n += sn * depth; moved = true;
        }
      } else {
        const dx = x - c.x, dn = n - c.n, d = Math.hypot(dx, dn), min = r + c.r;
        if (d < min) {
          if (d > 1e-6) { x = c.x + dx / d * min; n = c.n + dn / d * min; } else { x += min; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return { x, n };
}

export function blocked(x: number, n: number, r: number, colliders: readonly Collider[]): boolean {
  for (const c of colliders) {
    if (c.kind === 'box') {
      const cx = Math.max(c.x0, Math.min(x, c.x1)), cn = Math.max(c.n0, Math.min(n, c.n1));
      if (Math.hypot(x - cx, n - cn) < r) return true;
    } else if (Math.hypot(x - c.x, n - c.n) < r + c.r) return true;
  }
  return false;
}
