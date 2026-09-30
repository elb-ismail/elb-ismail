import type { LevelData } from '../data/levelTypes';
import type { WorldState } from '../simulation/WorldState';
import { pushOut, type Collider } from './Collision';

// Movement model: camera-relative. "Up" on the keyboard moves the player toward the top of the screen.
// Control-frame hold: after a camera cut, input keeps using the previous camera's heading until the
// player changes direction by more than holdBreakDegrees, releases the keys for holdReleaseSeconds,
// or holdMaxSeconds pass. Holding "up" through a cut therefore keeps walking the same way.

export interface InputFrame { moveX: number; moveY: number; plant: boolean }

const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class PlayerController {
  holdYaw: number | null = null;
  private holdT = 0;
  private holdInputAngle: number | null = null;
  private releaseT = 0;

  constructor(private level: LevelData) {}

  reset(): void { this.holdYaw = null; }

  onCut(previousYaw: number, input: InputFrame): void {
    this.holdYaw = previousYaw;
    this.holdT = 0;
    this.releaseT = 0;
    this.holdInputAngle = Math.hypot(input.moveX, input.moveY) > 0.1 ? Math.atan2(input.moveX, input.moveY) : null;
  }

  /** The heading used to interpret input this step. */
  inputYaw(cameraYaw: number): number { return this.holdYaw ?? cameraYaw; }

  update(ws: WorldState, input: InputFrame, cameraYaw: number, colliders: readonly Collider[], dt: number): void {
    const r = this.level.rules, pl = this.level.player, p = ws.player;
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));

    if (this.holdYaw !== null) {
      this.holdT += dt;
      if (mag < 0.1) this.releaseT += dt; else this.releaseT = 0;
      const a = mag >= 0.1 ? Math.atan2(input.moveX, input.moveY) : null;
      if (a !== null && this.holdInputAngle === null) this.holdInputAngle = a;
      const broke = a !== null && this.holdInputAngle !== null && angleDiff(a, this.holdInputAngle) > r.holdBreakDegrees * Math.PI / 180;
      if (broke || this.releaseT >= r.holdReleaseSeconds || this.holdT >= r.holdMaxSeconds) this.holdYaw = null;
    }

    const yaw = this.inputYaw(cameraYaw);
    // forward (screen up) and right (screen right) on the ground plane; plan heading 0 = north, +east
    const fx = Math.sin(yaw), fn = Math.cos(yaw), rx = fn, rn = -fx;
    let tx = 0, tn = 0;
    if (mag > 0.05) {
      const ix = input.moveX / Math.max(1, Math.hypot(input.moveX, input.moveY)), iy = input.moveY / Math.max(1, Math.hypot(input.moveX, input.moveY));
      tx = (rx * ix + fx * iy) * pl.speed;
      tn = (rn * ix + fn * iy) * pl.speed;
    }
    const k = Math.min(1, pl.accel * dt);
    p.vx += (tx - p.vx) * k;
    p.vn += (tn - p.vn) * k;
    p.prevX = p.x; p.prevN = p.n;
    const moved = pushOut(p.x + p.vx * dt, p.n + p.vn * dt, pl.radius, colliders);
    // velocity follows what actually happened, so sliding along walls doesn't store speed into them
    p.vx = (moved.x - p.x) / dt; p.vn = (moved.n - p.n) / dt;
    p.x = moved.x; p.n = moved.n;
    if (Math.hypot(p.vx, p.vn) > 0.3) p.facing = Math.atan2(p.vx, p.vn);
  }
}
