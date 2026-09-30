import * as THREE from 'three';
import type { LevelData } from '../data/levelTypes';
import { toWorldZ } from '../core/Space';

// Renderer, lights and the static graybox: ground, water, blocks, posts, the crude Sanctuary.
// Flat Lambert colours only. This is an engine test, not art.

export const AMBER = 0xffb347;

export function lambert(color: number, extra: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, ...extra });
}

/** A box spanning plan x0..x1, n0..n1, y0..y1. */
export function planBox(x0: number, x1: number, n0: number, n1: number, y0: number, y1: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, n1 - n0), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, toWorldZ((n0 + n1) / 2));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export interface BuiltScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Meshes that may hide the player; OcclusionDebug fades them. */
  occluders: THREE.Mesh[];
}

export function buildScene(canvas: HTMLCanvasElement, level: LevelData): BuiltScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1418);

  // Cold, even light so the graybox reads; amber is reserved for the Sanctuary and the beacon.
  scene.add(new THREE.HemisphereLight(0x9fb1c4, 0x1b2530, 1.7));
  const moon = new THREE.DirectionalLight(0xc2cfdc, 1.4);
  moon.position.set(-14, 30, toWorldZ(30));
  moon.target.position.set(0, 0, toWorldZ(18));
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  Object.assign(moon.shadow.camera, { left: -30, right: 30, top: 40, bottom: -40, near: 1, far: 120 });
  moon.shadow.bias = -0.0005;
  moon.shadow.normalBias = 0.05;
  scene.add(moon, moon.target);

  // water beyond the quay
  const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 90), lambert(0x10201c));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.3, toWorldZ(-55));
  scene.add(water);
  // dark ground skirt everywhere else, so nothing floats in the void
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), lambert(0x15191d));
  skirt.rotation.x = -Math.PI / 2; skirt.position.set(0, -0.02, toWorldZ(50));
  skirt.receiveShadow = true;
  scene.add(skirt);

  for (const g of level.ground) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(g.x1 - g.x0, g.n1 - g.n0), lambert(g.color));
    m.rotation.x = -Math.PI / 2; m.position.set((g.x0 + g.x1) / 2, 0, toWorldZ((g.n0 + g.n1) / 2));
    m.receiveShadow = true;
    scene.add(m);
  }

  const occluders: THREE.Mesh[] = [];
  for (const b of level.solids) {
    const m = planBox(b.x0, b.x1, b.n0, b.n1, 0, b.h, lambert(b.color));
    m.name = b.id;
    scene.add(m);
    if ((b.fade ?? b.h > 1.5) && b.occludes !== false) occluders.push(m);
  }
  for (const c of level.circles) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(c.r, c.r, c.h, 12), lambert(c.color));
    m.position.set(c.x, c.h / 2, toWorldZ(c.n)); m.castShadow = true; m.name = c.id;
    scene.add(m);
  }

  occluders.push(...buildSanctuary(scene, level));
  return { renderer, scene, occluders };
}

/** Crude silhouette: a narrow, crooked three-storey block on short legs, lit windows, chimney, tank. */
function buildSanctuary(scene: THREE.Scene, level: LevelData): THREE.Mesh[] {
  const s = level.sanctuary, wood = lambert(0x3a2c22), dark = lambert(0x221a15);
  const g = new THREE.Group(); g.name = 'sanctuary';
  const legY = 1.1, cx = (s.x0 + s.x1) / 2, cn = (s.n0 + s.n1) / 2;
  const parts: THREE.Mesh[] = [];
  for (const [x, n] of [[s.x0 + 0.5, s.n0 + 0.5], [s.x1 - 0.5, s.n0 + 0.5], [s.x0 + 0.5, s.n1 - 0.5], [s.x1 - 0.5, s.n1 - 0.5]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, legY, 8), dark);
    leg.position.set(x, legY / 2, toWorldZ(n)); leg.castShadow = true; g.add(leg);
  }
  const lower = planBox(s.x0, s.x1, s.n0, s.n1, legY, legY + 3.2, wood);
  const middle = planBox(s.x0 + 0.3, s.x1 - 0.2, s.n0 + 0.4, s.n1 - 0.1, legY + 3.2, legY + 6.0, wood);
  middle.rotation.y = 0.03;                              // a little crooked
  const top = planBox(s.x0 + 0.8, s.x1 - 0.5, s.n0 + 0.8, s.n1 - 0.6, legY + 6.0, legY + 8.0, wood);
  top.rotation.y = -0.04;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.0, 2.2, 4), lambert(0x2a2f36));
  roof.position.set(cx + 0.1, legY + 9.1, toWorldZ(cn)); roof.rotation.y = Math.PI / 4; roof.castShadow = true;
  const chimney = planBox(s.x0 + 1.0, s.x0 + 1.7, s.n0 + 1.2, s.n0 + 1.9, legY + 7.5, legY + 11.2, lambert(0x4a3a33));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 12), lambert(0x4f5a60));
  tank.position.set(s.x1 - 0.9, legY + 9.0, toWorldZ(s.n1 - 1.4)); tank.castShadow = true;
  g.add(lower, middle, top, roof, chimney, tank);
  for (const m of [lower, middle, top, chimney]) { m.name = 'sanctuary'; parts.push(m); }

  // lit windows on the north and east faces, and the door on the east face facing home
  const glow = new THREE.MeshBasicMaterial({ color: AMBER });
  const win = (w: number, h: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow);
  for (const [x, y] of [[s.x0 + 1.2, legY + 1.8], [s.x0 + 3.2, legY + 1.8], [s.x0 + 2.2, legY + 4.6], [s.x0 + 1.9, legY + 7.0]]) {
    const m = win(0.8, 1.0); m.position.set(x, y, toWorldZ(s.n1) - 0.02); m.rotation.y = Math.PI; g.add(m);
  }
  for (const [n, y, w, h] of [[s.n0 + 1.5, legY + 4.6, 0.8, 1.0], [s.n0 + 4.0, legY + 4.6, 0.8, 1.0], [cn, legY + 7.0, 0.7, 0.9], [s.n0 + 3.0, legY + 1.3, 1.1, 2.0]]) {
    const m = win(w, h); m.position.set(s.x1 + 0.02, y, toWorldZ(n)); m.rotation.y = Math.PI / 2; g.add(m);
  }
  const warm = new THREE.PointLight(AMBER, 26, 11, 2);
  warm.position.set(s.x1 + 1.4, 2.4, toWorldZ(s.n0 + 3.0));
  g.add(warm);
  // gangway plank from the door to the home area
  g.add(planBox(s.x1, s.x1 + 2.2, s.n0 + 2.4, s.n0 + 3.6, 0.02, 0.12, lambert(0x5a4636)));
  scene.add(g);
  return parts;
}
