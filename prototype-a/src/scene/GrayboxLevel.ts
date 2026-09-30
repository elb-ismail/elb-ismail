import * as THREE from 'three';
import type { LevelData, PropShape } from '../data/levelTypes';
import type { WorldState } from '../simulation/WorldState';
import type { Rng } from '../core/Rng';
import { toWorldZ } from '../core/Space';
import { railingPolyline } from '../player/Collision';
import { AMBER, lambert, planBox } from './SceneBuilder';

// Everything that changes: the doorway props (built once, shown/hidden by id), the crates placed by the
// world RNG, the beacon, the objective and home markers, and the player.

const IRON = 0x6a737c, RAIL = 0x9aa0a6;

function signTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 148;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a3a2c'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#d8d2c4'; g.lineWidth = 8; g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#e8e0cf'; g.font = 'bold 92px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Brick courses, so a bricked opening can never be mistaken for a dark open doorway. */
function brickTexture(brick: string, mortar: string, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = mortar; g.fillRect(0, 0, 128, 64);
  g.fillStyle = brick;
  for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
    const x = col * 64 + (row % 2 ? 32 : 0);
    g.fillRect(x + 3, row * 16 + 3, 58, 11);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 0.9, h / 0.3);   // one tile = two 0.45 m bricks wide, four 0.075 m courses tall
  return t;
}

function buildProp(s: PropShape): THREE.Object3D {
  const g = new THREE.Group();
  switch (s.kind) {
    case 'fill': {
      const r = s.rect;
      const w = r.x1 - r.x0;
      if (!s.fresh) {
        // old bricking: weathered courses, same darkness family as the wall but visibly laid brick
        g.add(planBox(r.x0, r.x1, r.n0, r.n1, 0, s.h, new THREE.MeshLambertMaterial({ map: brickTexture('#5a4238', '#2a211d', w, s.h) })));
        break;
      }
      // fresh bricking: pale new brick and mortar, with a dark water stain below a crisp flood line
      const line = s.floodLine ?? 0.8;
      g.add(planBox(r.x0, r.x1, r.n0, r.n1, 0, line, new THREE.MeshLambertMaterial({ map: brickTexture('#5e5248', '#4a4038', w, line) })));
      g.add(planBox(r.x0, r.x1, r.n0 - 0.03, r.n1 + 0.03, line, line + 0.12, lambert(0x0f0e0d)));
      g.add(planBox(r.x0, r.x1, r.n0, r.n1, line + 0.12, s.h, new THREE.MeshLambertMaterial({ map: brickTexture('#b3a491', '#d9d0c2', w, s.h - line) })));
      break;
    }
    case 'bars': {
      const mat = lambert(IRON), count = 6;
      for (let i = 0; i < count; i++) {
        const n = s.n0 + (s.n1 - s.n0) * (i + 0.5) / count;
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, s.h, 6), mat);
        bar.position.set(s.x, s.h / 2, toWorldZ(n)); bar.castShadow = true; g.add(bar);
      }
      for (const y of [0.15, s.h - 0.1]) g.add(planBox(s.x - 0.04, s.x + 0.04, s.n0, s.n1, y - 0.04, y + 0.04, mat));
      break;
    }
    case 'sign': {
      // red edges and a pale weathered back, so the sign lying face-down is recognisably the same sign
      const face = new THREE.MeshLambertMaterial({ map: signTexture(s.text) }), back = lambert(0x8a7560), edge = lambert(0x9a3f2e);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.tall, 0.1), [edge, edge, edge, edge, face, back]);
      m.rotation.order = 'YXZ';
      m.rotation.set(s.faceDown ? Math.PI / 2 : 0, s.rotY, s.tilt);
      m.position.set(s.x, s.faceDown ? s.y + 0.04 : s.y, toWorldZ(s.n));
      m.castShadow = true;
      g.add(m);
      break;
    }
    case 'decal': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.l), lambert(s.color));
      m.rotation.order = 'YXZ'; m.rotation.set(-Math.PI / 2, s.rotY, 0);
      // stack ground layers without z-fighting: larger decals sit lower
      m.position.set(s.x, 0.01 + 0.012 / Math.max(1, s.w * s.l), toWorldZ(s.n));
      m.receiveShadow = true;
      g.add(m);
      break;
    }
    case 'railing': {
      const mat = lambert(RAIL), pts = railingPolyline(s);
      for (const p of pts) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 6), mat);
        post.position.set(p.x, 0.55, toWorldZ(p.n)); post.castShadow = true; g.add(post);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], len = Math.hypot(b.x - a.x, b.n - a.n);
        for (const y of [0.55, 1.05]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, len), mat);
          rail.position.set((a.x + b.x) / 2, y, toWorldZ((a.n + b.n) / 2));
          rail.rotation.y = Math.atan2(b.x - a.x, -(b.n - a.n));   // align local z with the segment (world z = -n)
          rail.castShadow = true; g.add(rail);
        }
      }
      break;
    }
  }
  return g;
}

export class GrayboxLevel {
  readonly props = new Map<string, THREE.Object3D>();
  readonly player: THREE.Group;
  readonly playerBody: THREE.Mesh;
  readonly beacon: THREE.Group;
  readonly beaconLight: THREE.PointLight;
  readonly heldRing: THREE.Mesh;
  readonly objectiveRing: THREE.Mesh;
  readonly homePad: THREE.Mesh;
  private dressing = new THREE.Group();

  constructor(scene: THREE.Scene, level: LevelData) {
    for (const p of level.props) {
      const o = buildProp(p.shape); o.name = p.id; o.visible = false;
      this.props.set(p.id, o); scene.add(o);
    }
    scene.add(this.dressing);

    // player: cream capsule, dark hat brim, small amber lantern on the facing side
    this.player = new THREE.Group();
    const r = level.player.radius, h = level.player.height;
    this.playerBody = new THREE.Mesh(new THREE.CapsuleGeometry(r * 0.9, h - 2 * r * 0.9, 4, 12), lambert(0xd8d2c4));
    this.playerBody.position.y = h / 2; this.playerBody.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.06, 16), lambert(0x2a2522));
    brim.position.y = h - 0.12;
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: AMBER }));
    lantern.position.set(0.05, 0.95, -0.42);   // local -z = facing direction
    this.player.add(this.playerBody, brim, lantern);
    scene.add(this.player);

    // beacon: hidden until planted
    const c = level.beacon.cradle;
    this.beacon = new THREE.Group();
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshBasicMaterial({ color: AMBER }));
    lamp.position.set(c.x, 1.35, toWorldZ(c.n));
    this.beaconLight = new THREE.PointLight(AMBER, 30, 10, 1.6);
    this.beaconLight.position.set(c.x, 1.9, toWorldZ(c.n));
    this.heldRing = new THREE.Mesh(new THREE.RingGeometry(level.beacon.radius - 0.12, level.beacon.radius, 72),
      new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.45, depthWrite: false }));
    this.heldRing.rotation.x = -Math.PI / 2; this.heldRing.position.set(c.x, 0.03, toWorldZ(c.n));
    this.beacon.add(lamp, this.beaconLight, this.heldRing);
    scene.add(this.beacon);
    // empty cradle bracket, always visible
    const bracket = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 16), lambert(0x6f6a64));
    bracket.rotation.x = Math.PI / 2; bracket.position.set(c.x, 1.12, toWorldZ(c.n));
    scene.add(bracket);

    // far marker ring and home pad
    const o = level.objective;
    this.objectiveRing = new THREE.Mesh(new THREE.RingGeometry(o.r - 0.1, o.r, 48), new THREE.MeshBasicMaterial({ color: 0xcfe0ee, transparent: true, opacity: 0.8 }));
    this.objectiveRing.rotation.x = -Math.PI / 2; this.objectiveRing.position.set(o.x, 0.03, toWorldZ(o.n));
    scene.add(this.objectiveRing);
    const hm = level.home;
    this.homePad = new THREE.Mesh(new THREE.PlaneGeometry(hm.x1 - hm.x0, hm.n1 - hm.n0), new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.18, depthWrite: false }));
    this.homePad.rotation.x = -Math.PI / 2; this.homePad.position.set((hm.x0 + hm.x1) / 2, 0.02, toWorldZ((hm.n0 + hm.n1) / 2));
    scene.add(this.homePad);
  }

  /** Rebuild everything that depends on world state (after start or restart). */
  sync(ws: WorldState): void {
    this.showProps(ws.visibleProps);
    this.dressing.clear();
    const crate = lambert(0x4d4036);
    for (const d of ws.dressing) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.r * 2, 0.75, d.r * 2), crate);
      m.position.set(d.x, 0.375, toWorldZ(d.n)); m.castShadow = true; m.receiveShadow = true;
      this.dressing.add(m);
    }
    this.beacon.visible = ws.beacon.planted;
  }

  showProps(visible: readonly string[]): void {
    const set = new Set(visible);
    for (const [id, o] of this.props) o.visible = set.has(id);
  }

  update(ws: WorldState, alpha: number, visual: Rng): void {
    const p = ws.player;
    this.player.position.set(p.prevX + (p.x - p.prevX) * alpha, 0, toWorldZ(p.prevN + (p.n - p.prevN) * alpha));
    this.player.rotation.y = -p.facing;   // plan heading (0 = north, + east) to three.js yaw
    this.beacon.visible = ws.beacon.planted;
    // a barely perceptible, slow flame breath: < 4 % intensity, well under 3 Hz
    if (ws.beacon.planted) this.beaconLight.intensity = 30 * (1 + 0.03 * (visual.next() - 0.5));
    this.objectiveRing.visible = ws.objective.phase === 'outbound';
    (this.homePad.material as THREE.MeshBasicMaterial).opacity = ws.objective.phase === 'return' ? 0.32 : 0.14;
  }
}
