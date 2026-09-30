import type { LevelData, Point, Rect } from '../data/levelTypes';
import { blocked, levelColliders, type Collider } from '../player/Collision';

// Walkability check on the real collision geometry: a grid flood fill, with cells blocked where the
// player's capsule would not fit. Used before every doorway change to prove the way home survives it.

export interface NavGrid { cols: number; rows: number; cell: number; x0: number; n0: number; free: Uint8Array }

export function buildNavGrid(level: LevelData, colliders: readonly Collider[]): NavGrid {
  const { bounds: b, navCell: cell } = level, r = level.player.radius;
  const cols = Math.round((b.x1 - b.x0) / cell), rows = Math.round((b.n1 - b.n0) / cell);
  const free = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = b.x0 + (i + 0.5) * cell, n = b.n0 + (j + 0.5) * cell;
    free[j * cols + i] = blocked(x, n, r, colliders) ? 0 : 1;
  }
  return { cols, rows, cell, x0: b.x0, n0: b.n0, free };
}

const inRect = (p: Point, r: Rect) => p.x >= r.x0 && p.x <= r.x1 && p.n >= r.n0 && p.n <= r.n1;

/** Cells reachable from a point (4-connected). Starts from the nearest free cell if the point sits on a blocked one. */
export function reachableFrom(g: NavGrid, from: Point): Uint8Array {
  const seen = new Uint8Array(g.cols * g.rows);
  let si = Math.floor((from.x - g.x0) / g.cell), sj = Math.floor((from.n - g.n0) / g.cell);
  si = Math.max(0, Math.min(g.cols - 1, si)); sj = Math.max(0, Math.min(g.rows - 1, sj));
  let start = sj * g.cols + si;
  if (!g.free[start]) {
    let best = -1, bestD = Infinity;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const i = si + di, j = sj + dj;
      if (i < 0 || j < 0 || i >= g.cols || j >= g.rows || !g.free[j * g.cols + i]) continue;
      const d = di * di + dj * dj;
      if (d < bestD) { bestD = d; best = j * g.cols + i; }
    }
    if (best < 0) return seen;
    start = best;
  }
  const queue = [start]; seen[start] = 1;
  while (queue.length) {
    const c = queue.pop()!, i = c % g.cols, j = (c - i) / g.cols;
    const nb = [i > 0 ? c - 1 : -1, i < g.cols - 1 ? c + 1 : -1, j > 0 ? c - g.cols : -1, j < g.rows - 1 ? c + g.cols : -1];
    for (const k of nb) if (k >= 0 && g.free[k] && !seen[k]) { seen[k] = 1; queue.push(k); }
  }
  return seen;
}

export function rectReachable(g: NavGrid, seen: Uint8Array, target: Rect): boolean {
  for (let j = 0; j < g.rows; j++) for (let i = 0; i < g.cols; i++) {
    const k = j * g.cols + i;
    if (seen[k] && inRect({ x: g.x0 + (i + 0.5) * g.cell, n: g.n0 + (j + 0.5) * g.cell }, target)) return true;
  }
  return false;
}

/** Can a player standing at `from` walk home, given these visible props? */
export function homeReachable(level: LevelData, visibleProps: readonly string[], from: Point, extra: readonly Collider[] = []): boolean {
  const g = buildNavGrid(level, levelColliders(level, visibleProps, extra));
  return rectReachable(g, reachableFrom(g, from), level.home);
}
