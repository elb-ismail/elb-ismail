import * as THREE from 'three';
import type { LevelData } from '../data/levelTypes';
import type { Game } from '../core/Game';
import { toWorldZ } from '../core/Space';
import type { GrayboxLevel } from './GrayboxLevel';

// Readability helpers:
//   - foreground fade: occluders the simulation marked as between camera and player (game.fadedIds) fade to 30 %.
//     The simulation treats the same set as see-through when deciding whether the doorway is observed.
//   - silhouette: if the player is still hidden, a flat cream silhouette is drawn through geometry
//   - debug layer (F3): camera volumes and hysteresis band, the doorway's observation samples
//     (green = on screen and unoccluded), its 8 m "far enough" circle, and the beacon's protected radius

export class OcclusionDebug {
  readonly debug = new THREE.Group();
  private sampleDots: THREE.Mesh[] = [];
  private silhouette: THREE.Mesh;
  private faded = new Set<THREE.Mesh>();

  constructor(scene: THREE.Scene, level: LevelData, private occluders: THREE.Mesh[], private gray: GrayboxLevel) {
    for (const m of occluders) {
      const mat = m.material as THREE.MeshLambertMaterial;
      mat.transparent = true; mat.opacity = 1;
    }
    this.silhouette = new THREE.Mesh(gray.playerBody.geometry, new THREE.MeshBasicMaterial({
      color: 0xf1e9d8, transparent: true, opacity: 0.55, depthFunc: THREE.GreaterDepth, depthWrite: false,
    }));
    // slightly larger than the body, so its surface sits in front of the body's own depth and it only
    // appears where other geometry hides the player (identical geometry would z-fight into stripes)
    this.silhouette.scale.setScalar(1.04);
    this.silhouette.renderOrder = 10;
    scene.add(this.silhouette);

    const line = (pts: Array<[number, number]>, color: number, y = 0.05) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, n]) => new THREE.Vector3(x, y, toWorldZ(n))));
      return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color }));
    };
    const circle = (x: number, n: number, r: number, color: number) =>
      line(Array.from({ length: 64 }, (_, i) => [x + r * Math.cos(i / 64 * Math.PI * 2), n + r * Math.sin(i / 64 * Math.PI * 2)] as [number, number]), color, 0.06);
    const colors = [0x4fc3f7, 0xba68c8];
    level.cameras.forEach((c, i) => {
      const v = c.volume, inset = level.rules.volumeInset;
      this.debug.add(line([[v.x0, v.n0], [v.x1, v.n0], [v.x1, v.n1], [v.x0, v.n1]], colors[i % 2], 0.05 + i * 0.01));
      // hysteresis band edges: the camera switches only past these
      for (const n of [v.n0 - inset, v.n1 + inset]) this.debug.add(line([[v.x0 + 0.5, n], [v.x1 - 0.5, n]], colors[i % 2], 0.07));
    });
    const d = level.doorway;
    this.debug.add(circle(d.center.x, d.center.n, level.rules.minDistance, 0xffffff));
    const b = level.beacon;
    this.debug.add(circle(b.cradle.x, b.cradle.n, b.radius, 0xff7043));
    for (const s of d.samples) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff5252, depthTest: false }));
      dot.position.set(s.x, s.y, toWorldZ(s.n)); dot.renderOrder = 11;
      this.sampleDots.push(dot); this.debug.add(dot);
    }
    this.debug.visible = false;
    scene.add(this.debug);
  }

  update(game: Game): void {
    const p = this.gray.player.position;
    // foreground fade, driven by the simulation's set so rendering and observation agree
    for (const m of this.occluders) {
      const mat = m.material as THREE.MeshLambertMaterial, on = game.fadedIds.has(m.name), want = on ? 0.3 : 1;
      mat.opacity += (want - mat.opacity) * 0.25;
      mat.depthWrite = mat.opacity > 0.95;
      if (on) this.faded.add(m); else if (mat.opacity > 0.99) this.faded.delete(m);
    }
    this.silhouette.position.copy(p).add(this.gray.playerBody.position);
    // debug dots
    const vis = game.lastObservation.visibleSamples;
    this.sampleDots.forEach((d, i) => (d.material as THREE.MeshBasicMaterial).color.setHex(vis[i] ? 0x66ff66 : 0xff5252));
  }

  get fadedCount(): number { return this.faded.size; }
}
