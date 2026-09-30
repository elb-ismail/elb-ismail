import { Box3, Ray, Vector3 } from 'three';
import type { LevelData } from '../data/levelTypes';
import { EventBus } from './EventBus';
import { RngStreams } from './Rng';
import { toWorldZ } from './Space';
import { CameraController, type Observation } from '../camera/CameraController';
import { PlayerController, type InputFrame } from '../player/PlayerController';
import { levelColliders, type Collider } from '../player/Collision';
import { BeaconSystem } from '../simulation/BeaconSystem';
import { DoorwaySystem } from '../simulation/DoorwaySystem';
import { createWorldState, dressingColliders, type WorldState } from '../simulation/WorldState';

// One fixed simulation step, in order:
//   1 move the player (input read in the held or current camera frame)
//   2 update the camera; note a cut
//   3 beacon planting
//   4 observe the doorway anchor through the real camera, then run the doorway rule
//   5 objective progress
// Runs headless (tests) or under the renderer (main.ts). Rendering only reads `ws` and `camera`.

export const NO_INPUT: InputFrame = { moveX: 0, moveY: 0, plant: false };

export class Game {
  readonly bus = new EventBus();
  rng!: RngStreams;
  ws!: WorldState;
  readonly camera: CameraController;
  readonly player: PlayerController;
  readonly beacon: BeaconSystem;
  readonly doorway: DoorwaySystem;
  readonly dt: number;
  lastObservation: Observation = { observed: false, screenFraction: 0, visibleSamples: [] };
  colliders: Collider[] = [];
  occluders: Box3[] = [];
  occluderIds: string[] = [];
  private fadeable: boolean[] = [];
  /** Occluders currently faded because they stand between camera and player. Rendering fades the same set,
   *  and observation treats them as see-through, so "observed" stays equal to "visible on screen". */
  fadedIds = new Set<string>();
  private samples: Vector3[];
  private corners: Vector3[];

  constructor(readonly level: LevelData, aspect = 16 / 9, seed = level.seed) {
    this.dt = 1 / level.rules.stepHz;
    this.camera = new CameraController(level, aspect);
    this.player = new PlayerController(level);
    this.beacon = new BeaconSystem(level, this.bus);
    this.doorway = new DoorwaySystem(level, this.bus);
    const d = level.doorway, b = d.bounds;
    this.samples = d.samples.map(s => new Vector3(s.x, s.y, toWorldZ(s.n)));
    this.corners = [];
    for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const n of [b.n0, b.n1]) this.corners.push(new Vector3(x, y, toWorldZ(n)));
    this.bus.on(e => { if (e.type === 'doorwayChanged') this.rebuildGeometry(); });
    this.reset(seed);
  }

  reset(seed = this.level.seed): void {
    this.rng = new RngStreams(seed);
    this.ws = createWorldState(this.level, this.rng.world);
    this.bus.log.length = 0;
    this.player.reset();
    this.camera.reset(this.ws.player);
    this.ws.camera.active = this.camera.activeId;
    this.rebuildGeometry();
  }

  /** Colliders and view occluders depend on which doorway props are present. */
  rebuildGeometry(): void {
    const L = this.level;
    this.colliders = levelColliders(L, this.ws.visibleProps, dressingColliders(this.ws));
    const box = (x0: number, x1: number, n0: number, n1: number, y0: number, y1: number) =>
      new Box3(new Vector3(x0, y0, toWorldZ(n1)), new Vector3(x1, y1, toWorldZ(n0)));
    this.occluders = []; this.occluderIds = []; this.fadeable = [];
    const add = (id: string, b: Box3, fade: boolean) => { this.occluders.push(b); this.occluderIds.push(id); this.fadeable.push(fade); };
    for (const o of L.solids) if (o.occludes !== false) add(o.id, box(o.x0, o.x1, o.n0, o.n1, 0, o.h), o.fade ?? o.h > 1.5);
    const s = L.sanctuary;
    add('sanctuary', box(s.x0, s.x1, s.n0, s.n1, 0, s.h), true);
    for (const id of this.ws.visibleProps) {
      const p = L.props.find(q => q.id === id);
      if (p?.shape.kind === 'fill') { const r = p.shape.rect; add(id, box(r.x0, r.x1, r.n0, r.n1, 0, p.shape.h), false); }
    }
  }

  private updateFade(): void {
    const cam = this.camera.camera.position, p = this.ws.player, ray = new Ray(), hit = new Vector3();
    this.fadedIds.clear();
    for (const y of [0.9, 1.6]) {
      const target = new Vector3(p.x, y, toWorldZ(p.n)), dist = cam.distanceTo(target);
      ray.set(cam, target.clone().sub(cam).normalize());
      this.occluders.forEach((b, i) => {
        if (this.fadeable[i] && ray.intersectBox(b, hit) && cam.distanceTo(hit) < dist - 0.3) this.fadedIds.add(this.occluderIds[i]);
      });
    }
  }

  setAspect(aspect: number): void { this.camera.setAspect(aspect); }

  step(input: InputFrame): void {
    const ws = this.ws, dt = this.dt;
    const yawBefore = this.camera.yaw();

    this.player.update(ws, input, yawBefore, this.colliders, dt);

    const cutFrom = this.camera.update(dt, ws.player);
    if (cutFrom) {
      this.player.onCut(yawBefore, input);
      ws.camera.active = this.camera.activeId;
      ws.camera.cuts++;
      this.bus.emit({ type: 'cameraCut', from: cutFrom, to: this.camera.activeId }, ws.step, ws.time);
    }

    this.beacon.update(ws, input.plant);

    this.updateFade();
    const solid = this.occluders.filter((_, i) => !this.fadedIds.has(this.occluderIds[i]));
    this.lastObservation = this.camera.observe(this.samples, this.corners, solid, this.level.rules.frustumMargin);
    this.doorway.update(ws, { observed: this.lastObservation.observed, screenFraction: this.lastObservation.screenFraction, cut: cutFrom !== null },
      dt, this.beacon.protects(ws, this.level.doorway.center));

    const o = ws.objective, m = this.level.objective, h = this.level.home, p = ws.player;
    if (o.phase === 'outbound' && Math.hypot(p.x - m.x, p.n - m.n) <= m.r) {
      o.phase = 'return';
      this.bus.emit({ type: 'objectiveReached', trip: o.trips + 1 }, ws.step, ws.time);
    } else if (o.phase === 'return' && p.x >= h.x0 && p.x <= h.x1 && p.n >= h.n0 && p.n <= h.n1) {
      o.phase = 'outbound';
      o.trips++;
      // returning home closes the excursion: the next change needs a new before-shot-then-cut on the next trip
      ws.doorway.changesThisTrip = 0;
      ws.doorway.cutAfterSeen = false;
      this.bus.emit({ type: 'homeReached', trip: o.trips }, ws.step, ws.time);
    }

    ws.step++;
    ws.time += dt;
  }

  /** Test/debug helper: steer toward a point in the current camera frame for up to maxSteps; returns steps used. */
  walkTo(x: number, n: number, maxSteps = 60 * 30, tolerance = 0.4, extra: Partial<InputFrame> = {}): number {
    for (let i = 0; i < maxSteps; i++) {
      const p = this.ws.player, dx = x - p.x, dn = n - p.n;
      if (Math.hypot(dx, dn) <= tolerance) return i;
      const yaw = this.player.inputYaw(this.camera.yaw());
      // invert the camera-relative mapping: world direction -> screen input
      const fx = Math.sin(yaw), fn = Math.cos(yaw), rx = fn, rn = -fx, len = Math.hypot(dx, dn);
      this.step({ moveX: (dx * rx + dn * rn) / len, moveY: (dx * fx + dn * fn) / len, plant: false, ...extra });
    }
    return maxSteps;
  }

  idle(steps: number): void { for (let i = 0; i < steps; i++) this.step(NO_INPUT); }
}
