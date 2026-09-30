import type { LevelData, PropDef } from './levelTypes';

// Prototype A: one 54 m graybox street.
//
//   n=46 ┌──────── yard north wall ────────┐
//        │         far marker (n 43)        │   YARD camera (from the south-west, looking north-east)
//   n=31 │                                   │
//   n=30 ╞══wall══[ GATE ]═╡ ╞[CHUTE]══wall══╡   doorway anchor "Pellow's gate / coal chute"
//        │  cradle ●  ash patch  │ railing   │
//        │                        │  coal pit │   STREET camera (from the south-east, looking north)
//        │         Kiln Street    │           │
//   n=0  └───┐                          ┌─────┘
//            │  Sanctuary ▓  home       │
//   n=-10 ~~~~~~~~~~~~~ water ~~~~~~~~~~~~~~~
//
// Gate opening x -2.6..-0.6, chute opening x 0.8..2.4, wall n 30..30.6, wall height 3 m, no lintels,
// so an open or bricked opening reads as a gap or a filled patch in the wall top from the high yard camera.

const COLORS = {
  lotGround: 0x33383d, street: 0x3b4046, yard: 0x373b40,
  blockWest: 0x4a4f57, blockEast: 0x50555c, shed: 0x464a50, stack: 0x3a3632, lowWall: 0x4b4e53, brickWall: 0x5b4a42,
  ash: 0x262729, drag: 0x6a655e, pit: 0x0c0d0e, lamp: 0x2a2d31, cradle: 0x2b2b2b, marker: 0x9fb4c8, water: 0x10201c,
};

const OPEN_GATE = { x0: -2.6, x1: -0.6 };
const CHUTE = { x0: 0.8, x1: 2.4 };
const WALL_N0 = 30, WALL_N1 = 30.6, WALL_H = 3;

const props: PropDef[] = [
  // Always present: the wet ash patch in front of both openings, and the coal pit the railing guards.
  { id: 'ash', shape: { kind: 'decal', x: -0.4, n: 27.9, w: 6.4, l: 4.2, rotY: 0, color: COLORS.ash } },
  { id: 'pit', shape: { kind: 'decal', x: 3.55, n: 27.4, w: 0.9, l: 4.8, rotY: 0, color: COLORS.pit } },

  // State A: iron gate standing open (leaves swung back against the wall, toward the street), chute bricked.
  { id: 'gateLeaves', shape: { kind: 'bars', x: OPEN_GATE.x0 - 0.12, n0: 28.9, n1: 29.95, h: 2.5 } },
  { id: 'gateLeaves2', shape: { kind: 'bars', x: OPEN_GATE.x1 + 0.12, n0: 28.9, n1: 29.95, h: 2.5 } },
  { id: 'signHanging', shape: { kind: 'sign', x: -1.6, n: 29.82, y: 2.95, w: 2.6, tall: 0.75, rotY: 0, tilt: 0, faceDown: false, text: 'PELLOW' } },
  { id: 'chuteOld', solid: true, shape: { kind: 'fill', rect: { ...CHUTE, n0: WALL_N0, n1: WALL_N1 }, h: WALL_H, fresh: false } },
  { id: 'railingEast', solid: true, shape: { kind: 'railing', x: 3.0, n0: 25.0, n1: 29.8, bend: 0.6 } },

  // Evidence when A is re-entered after a change.
  { id: 'signCrooked', shape: { kind: 'sign', x: -1.6, n: 29.82, y: 2.85, w: 2.6, tall: 0.75, rotY: 0, tilt: 0.22, faceDown: false, text: 'PELLOW' } },
  { id: 'chuteFresh', solid: true, shape: { kind: 'fill', rect: { ...CHUTE, n0: WALL_N0, n1: WALL_N1 }, h: WALL_H, fresh: true, floodLine: 0.8 } },
  { id: 'dragChute1', shape: { kind: 'decal', x: 1.2, n: 27.9, w: 0.34, l: 3.6, rotY: 0.10, color: COLORS.drag } },
  { id: 'dragChute2', shape: { kind: 'decal', x: 1.7, n: 27.9, w: 0.34, l: 3.6, rotY: 0.0, color: COLORS.drag } },
  { id: 'dragChute3', shape: { kind: 'decal', x: 2.2, n: 27.9, w: 0.34, l: 3.6, rotY: -0.10, color: COLORS.drag } },

  // State B: gate bricked with fresh mortar and a flood line, chute open, sign face-down, railing bent the other way.
  { id: 'gateOld', solid: true, shape: { kind: 'fill', rect: { ...OPEN_GATE, n0: WALL_N0, n1: WALL_N1 }, h: WALL_H, fresh: false } },
  { id: 'gateFresh', solid: true, shape: { kind: 'fill', rect: { ...OPEN_GATE, n0: WALL_N0, n1: WALL_N1 }, h: WALL_H, fresh: true, floodLine: 0.8 } },
  { id: 'signFaceDown', shape: { kind: 'sign', x: -1.3, n: 27.6, y: 0.04, w: 2.6, tall: 0.75, rotY: 0.35, tilt: 0, faceDown: true, text: 'PELLOW' } },
  { id: 'dragGate1', shape: { kind: 'decal', x: -2.2, n: 27.9, w: 0.34, l: 3.6, rotY: 0.10, color: COLORS.drag } },
  { id: 'dragGate2', shape: { kind: 'decal', x: -1.6, n: 27.9, w: 0.34, l: 3.6, rotY: 0.0, color: COLORS.drag } },
  { id: 'dragGate3', shape: { kind: 'decal', x: -1.0, n: 27.9, w: 0.34, l: 3.6, rotY: -0.10, color: COLORS.drag } },
  { id: 'railingWest', solid: true, shape: { kind: 'railing', x: 3.0, n0: 25.0, n1: 29.8, bend: -0.6 } },
];

export const prototypeA: LevelData = {
  name: 'Prototype A: camera, beacon, changed doorway',
  seed: 20260930,
  rules: {
    stepHz: 60,
    seenSeconds: 3,
    minScreenFraction: 0.015,
    unobservedSeconds: 1.5,
    minDistance: 8,
    maxChangesPerTrip: 1,
    frustumMargin: 0.1,
    volumeInset: 1.0,   // volumes meet at the wall line; switch only 1 m past it either way (2 m band)
    minDwellSeconds: 1.2,
    holdMaxSeconds: 2.0,
    holdBreakDegrees: 35,
    holdReleaseSeconds: 0.2,
    followHalfLife: 0.3,
  },
  bounds: { x0: -12, x1: 12, n0: -12, n1: 48 },
  navCell: 0.5,
  player: { start: { x: -1.2, n: -2.5 }, radius: 0.35, height: 1.75, speed: 3.4, accel: 12 },
  home: { x0: -3, x1: 0, n0: -8, n1: -4.5 },
  sanctuary: { x0: -8, x1: -3, n0: -9.5, n1: -3.5, h: 9 },
  objective: { x: 0, n: 43, r: 1.6 },
  beacon: { cradle: { x: -3.0, n: 26.5 }, radius: 6, plantRange: 1.8 },
  ground: [
    { x0: -9, x1: 6, n0: -10, n1: 0, color: COLORS.lotGround },
    { x0: -4, x1: 4, n0: 0, n1: 30, color: COLORS.street },
    { x0: -12, x1: 12, n0: 30, n1: 30.6, color: COLORS.street },
    { x0: -8, x1: 8, n0: 30.6, n1: 46, color: COLORS.yard },
  ],
  solids: [
    { id: 'waterEdge', x0: -12, x1: 12, n0: -12, n1: -10, h: 0.25, color: COLORS.water, occludes: false },
    { id: 'lotWest', x0: -12, x1: -9, n0: -10, n1: 0, h: 2.5, color: COLORS.lowWall },
    { id: 'lotEast', x0: 6, x1: 12, n0: -10, n1: 0, h: 2.5, color: COLORS.lowWall },
    // Street buildings are tall for most of the street and drop to low kiln sheds for the last 6 m, so the
    // doorway reads as an opening in the composition and the yard camera can see over them.
    { id: 'blockWest', x0: -12, x1: -4, n0: 0, n1: 24, h: 8, color: COLORS.blockWest },
    { id: 'blockEast', x0: 4, x1: 12, n0: 0, n1: 24, h: 7, color: COLORS.blockEast },
    { id: 'shedWest', x0: -12, x1: -4, n0: 24, n1: 30, h: 3.5, color: COLORS.shed },
    { id: 'shedEast', x0: 4, x1: 12, n0: 24, n1: 30, h: 3.5, color: COLORS.shed },
    // Low mooring stack: closes the pocket behind the Sanctuary that the street camera cannot see into.
    { id: 'mooringStack', x0: -9, x1: -3, n0: -3.5, n1: 0, h: 1.2, color: COLORS.stack, occludes: false },
    { id: 'wallWest', fade: false, x0: -12, x1: OPEN_GATE.x0, n0: WALL_N0, n1: WALL_N1, h: WALL_H, color: COLORS.brickWall },
    { id: 'wallMid', fade: false, x0: OPEN_GATE.x1, x1: CHUTE.x0, n0: WALL_N0, n1: WALL_N1, h: WALL_H, color: COLORS.brickWall },
    { id: 'wallEast', fade: false, x0: CHUTE.x1, x1: 12, n0: WALL_N0, n1: WALL_N1, h: WALL_H, color: COLORS.brickWall },
    { id: 'yardWest', x0: -12, x1: -8, n0: WALL_N1, n1: 48, h: 5, color: COLORS.lowWall },
    { id: 'yardEast', x0: 8, x1: 12, n0: WALL_N1, n1: 48, h: 5, color: COLORS.lowWall },
    { id: 'yardNorth', x0: -8, x1: 8, n0: 46, n1: 48, h: 5, color: COLORS.lowWall },
  ],
  circles: [
    { id: 'lamp1', x: -3.5, n: 6, r: 0.15, h: 4, color: COLORS.lamp },
    { id: 'lamp2', x: 3.5, n: 14, r: 0.15, h: 4, color: COLORS.lamp },
    { id: 'lamp3', x: -3.5, n: 20, r: 0.15, h: 4, color: COLORS.lamp },
    { id: 'cradle', x: -3.0, n: 26.5, r: 0.3, h: 1.1, color: COLORS.cradle },
    { id: 'marker', x: 0, n: 43, r: 0.3, h: 1.3, color: COLORS.marker },
  ],
  props,
  doorway: {
    id: 'pellow',
    name: "Pellow's gate / coal chute",
    center: { x: -0.1, n: 30.3 },
    bounds: { x0: -3.0, x1: 3.0, n0: 29.6, n1: 31.0, y0: 0, y1: 3.4 },
    samples: [
      // street face
      { x: -1.6, n: 29.85, y: 1.3 }, { x: 1.6, n: 29.85, y: 1.3 }, { x: -2.5, n: 29.85, y: 2.7 }, { x: 2.3, n: 29.85, y: 2.7 },
      // yard face
      { x: -1.6, n: 30.75, y: 1.3 }, { x: 1.6, n: 30.75, y: 1.3 }, { x: -2.5, n: 30.75, y: 2.7 }, { x: 2.3, n: 30.75, y: 2.7 },
      // wall top above each opening and between them (seen from the high cameras on either side)
      { x: -1.6, n: 30.3, y: 3.15 }, { x: 0.1, n: 30.3, y: 3.15 }, { x: 1.6, n: 30.3, y: 3.15 },
    ],
    initial: 'A',
    states: {
      A: {
        label: 'Gate open, chute bricked',
        always: ['ash', 'pit'],
        initial: ['gateLeaves', 'gateLeaves2', 'signHanging', 'chuteOld', 'railingEast'],
        changed: ['gateLeaves', 'gateLeaves2', 'signCrooked', 'chuteFresh', 'dragChute1', 'dragChute2', 'dragChute3', 'railingEast'],
      },
      B: {
        label: 'Gate bricked, chute open',
        always: ['ash', 'pit'],
        initial: ['gateOld', 'signFaceDown', 'railingWest'],
        changed: ['gateFresh', 'signFaceDown', 'dragGate1', 'dragGate2', 'dragGate3', 'railingWest'],
      },
    },
  },
  cameras: [
    {
      id: 'street', label: 'Street (rail, from the south-east)',
      volume: { x0: -12, x1: 12, n0: -12, n1: 30.3 },
      anchorX: 0, followX: 0.3, offX: 2.2, offY: 16.5, offN: -15, lookY: 1.0, lookN: 2.5,
      clampX: [-4, 5], clampN: [-21, 17], fov: 34,
    },
    {
      id: 'yard', label: 'Yard (bounded follow, from the south-west)',
      volume: { x0: -12, x1: 12, n0: 30.3, n1: 48 },
      anchorX: 0, followX: 0.4, offX: -3.5, offY: 18, offN: -13, lookY: 1.0, lookN: 2.5,
      clampX: [-8, 6], clampN: [22, 34], fov: 34,
    },
  ],
};
