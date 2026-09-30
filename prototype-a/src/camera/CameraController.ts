import { Box3, PerspectiveCamera, Ray, Vector3 } from 'three';
import type { CameraRigDef, LevelData, Point } from '../data/levelTypes';
import { toWorldZ } from '../core/Space';
import { chooseRig } from './CameraVolume';

// Fixed/rail camera. The player never rotates it. Each rig computes a target pose from the player's
// position inside its authored volume; the camera follows that target with exponential smoothing and
// snaps (cuts) when the active rig changes. The same PerspectiveCamera is used for rendering and for
// the observation test, so "observed" means what is on screen.

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface Pose { pos: Vector3; look: Vector3 }
export interface Observation { observed: boolean; screenFraction: number; visibleSamples: boolean[] }

export class CameraController {
  readonly camera: PerspectiveCamera;
  activeId: string;
  activeFor = 0;
  private pos = new Vector3();
  private look = new Vector3();
  private ray = new Ray();
  private hit = new Vector3();

  constructor(private level: LevelData, aspect: number) {
    this.camera = new PerspectiveCamera(level.cameras[0].fov, aspect, 0.5, 400);
    this.activeId = level.cameras[0].id;
  }

  get rig(): CameraRigDef { return this.level.cameras.find(r => r.id === this.activeId)!; }

  setAspect(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  targetFor(rig: CameraRigDef, p: Point): Pose {
    const x = clamp(rig.anchorX + (p.x - rig.anchorX) * rig.followX + rig.offX, rig.clampX[0], rig.clampX[1]);
    const n = clamp(p.n + rig.offN, rig.clampN[0], rig.clampN[1]);
    return { pos: new Vector3(x, rig.offY, toWorldZ(n)), look: new Vector3(p.x, rig.lookY, toWorldZ(p.n + rig.lookN)) };
  }

  /** Place the camera on the right rig without smoothing (level start, restart). */
  reset(p: Point): void {
    this.activeId = chooseRig(this.level.cameras, this.level.cameras[0].id, p, Infinity, 0, 0);
    this.activeFor = 0;
    const t = this.targetFor(this.rig, p);
    this.pos.copy(t.pos); this.look.copy(t.look);
    this.apply();
  }

  /** Advance one simulation step. Returns the previous rig id if a cut happened. */
  update(dt: number, p: Point): string | null {
    const r = this.level.rules;
    this.activeFor += dt;
    const next = chooseRig(this.level.cameras, this.activeId, p, this.activeFor, r.volumeInset, r.minDwellSeconds);
    let cutFrom: string | null = null;
    if (next !== this.activeId) { cutFrom = this.activeId; this.activeId = next; this.activeFor = 0; }
    const t = this.targetFor(this.rig, p);
    if (cutFrom) { this.pos.copy(t.pos); this.look.copy(t.look); }
    else {
      const k = 1 - Math.pow(2, -dt / r.followHalfLife);
      this.pos.lerp(t.pos, k); this.look.lerp(t.look, k);
    }
    this.apply();
    return cutFrom;
  }

  private apply(): void {
    const c = this.camera;
    if (c.fov !== this.rig.fov) { c.fov = this.rig.fov; c.updateProjectionMatrix(); }
    c.position.copy(this.pos);
    c.lookAt(this.look);
    c.updateMatrixWorld(true);
  }

  /** Planar heading of the camera: 0 = looking north, positive = turned east (radians). */
  yaw(): number {
    const dx = this.look.x - this.pos.x, dn = -(this.look.z - this.pos.z);
    return Math.atan2(dx, dn);
  }

  /** Normalised device coordinates, or null if the point is behind the camera. */
  ndc(world: Vector3): Vector3 | null {
    const v = world.clone().applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -this.camera.near) return null;
    return v.applyMatrix4(this.camera.projectionMatrix);
  }

  /**
   * Is any sample point on screen (with an NDC margin, so points just outside the frame still count) and
   * not hidden behind an occluder? Also returns how much of the screen the anchor's box covers.
   */
  observe(samples: readonly Vector3[], corners: readonly Vector3[], occluders: readonly Box3[], margin: number): Observation {
    const origin = this.camera.position;
    const visibleSamples = samples.map(s => {
      const p = this.ndc(s);
      if (!p || Math.abs(p.x) > 1 + margin || Math.abs(p.y) > 1 + margin) return false;
      const dist = origin.distanceTo(s);
      this.ray.set(origin, s.clone().sub(origin).normalize());
      for (const b of occluders) {
        if (b.containsPoint(s)) continue;
        if (this.ray.intersectBox(b, this.hit) && origin.distanceTo(this.hit) < dist - 0.05) return false;
      }
      return true;
    });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const c of corners) {
      const p = this.ndc(c);
      if (!p) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)), h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0));
    return { observed: visibleSamples.some(Boolean), screenFraction: (w * h) / 4, visibleSamples };
  }
}
