import type { CameraRigDef, Point, Rect } from '../data/levelTypes';

export function inVolume(v: Rect, p: Point, inset = 0): boolean {
  return p.x >= v.x0 + inset && p.x <= v.x1 - inset && p.n >= v.n0 + inset && p.n <= v.n1 - inset;
}

/**
 * Which rig should be active. Volumes are authored to meet edge to edge. Hysteresis: the active rig is kept
 * while the player stays within its volume grown by `inset` metres, so crossing a boundary switches only
 * once the player is `inset` past it, and stepping back switches only `inset` past it the other way.
 * `minDwell` additionally keeps a just-activated rig for a moment while the player is within 2 x inset.
 */
export function chooseRig(rigs: readonly CameraRigDef[], activeId: string, p: Point, activeFor: number, inset: number, minDwell: number): string {
  const active = rigs.find(r => r.id === activeId)!;
  if (inVolume(active.volume, p, -inset)) return activeId;
  if (activeFor < minDwell && inVolume(active.volume, p, -2 * inset)) return activeId;
  for (const r of rigs) if (r.id !== activeId && inVolume(r.volume, p)) return r.id;
  return activeId;
}
