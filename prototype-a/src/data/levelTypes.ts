// Plan coordinates used by all level data: x = metres east, n = metres north, y = metres up.
// Three.js world space is (x, y, -n); the conversion lives in one place (toWorld in scene/SceneBuilder).

export interface Rect { x0: number; x1: number; n0: number; n1: number }
export interface Point { x: number; n: number }

export interface SolidBox extends Rect {
  id: string;
  h: number;
  color: number;
  /** Blocks the camera's view of the doorway anchor (used by the observation test). Default true. */
  occludes?: boolean;
  /** May fade out when it stands between the camera and the player. Default: true if taller than 1.5 m. */
  fade?: boolean;
}

export interface SolidCircle extends Point { id: string; r: number; h: number; color: number }

export type PropShape =
  | { kind: 'fill'; rect: Rect; h: number; fresh: boolean; floodLine?: number }
  | { kind: 'bars'; x: number; n0: number; n1: number; h: number }
  | { kind: 'sign'; x: number; n: number; y: number; w: number; tall: number; rotY: number; tilt: number; faceDown: boolean; text: string }
  | { kind: 'decal'; x: number; n: number; w: number; l: number; rotY: number; color: number }
  | { kind: 'railing'; x: number; n0: number; n1: number; bend: number };

export interface PropDef {
  id: string;
  shape: PropShape;
  /** Solid props collide and occlude. Fills and railings are solid; decals and signs are not. */
  solid?: boolean;
}

export type DoorwayStateId = 'A' | 'B';

export interface DoorwayStateDef {
  label: string;
  /** Props present whenever this state is active. */
  always: string[];
  /** Props when the level starts in this state (no change has happened yet). */
  initial: string[];
  /** Props when this state was entered by an unobserved change: the physical evidence. */
  changed: string[];
}

export interface DoorwayDef {
  id: string;
  name: string;
  center: Point;
  /** Screen-coverage box used for the "seen in a stable composition" check. */
  bounds: Rect & { y0: number; y1: number };
  /** Points on both faces of the wall; the anchor counts as observed if any is visible. */
  samples: Array<Point & { y: number }>;
  initial: DoorwayStateId;
  states: Record<DoorwayStateId, DoorwayStateDef>;
}

export interface CameraRigDef {
  id: string;
  label: string;
  /** Authored volume the rig owns. */
  volume: Rect;
  /** Camera position = (anchorX + (px - anchorX) * followX + offX, offY, pn + offN), then clamped. */
  anchorX: number;
  followX: number;
  offX: number;
  offY: number;
  offN: number;
  /** Look-at = player + (0, lookY, lookN). */
  lookY: number;
  lookN: number;
  clampX: [number, number];
  clampN: [number, number];
  fov: number;
}

export interface Rules {
  stepHz: number;
  seenSeconds: number;          // rule 1: original state seen this long, in a stable composition
  minScreenFraction: number;    // ...where "stable composition" means the anchor covers at least this share of the screen
  unobservedSeconds: number;    // rule 2: out of view continuously this long
  minDistance: number;          // rule 3
  maxChangesPerTrip: number;    // pacing budget on top of the six rules: changes per excursion from the Sanctuary
  frustumMargin: number;        // NDC margin: points slightly outside the frame still count as observed
  volumeInset: number;          // camera hysteresis: must be this far inside a new volume to switch
  minDwellSeconds: number;      // camera hysteresis: minimum time on a camera before switching back
  holdMaxSeconds: number;       // control-frame hold after a cut
  holdBreakDegrees: number;
  holdReleaseSeconds: number;
  followHalfLife: number;       // camera spring half-life, seconds
}

export interface LevelData {
  name: string;
  seed: number;
  rules: Rules;
  bounds: Rect;
  navCell: number;
  player: { start: Point; radius: number; height: number; speed: number; accel: number };
  home: Rect;
  sanctuary: Rect & { h: number };
  objective: Point & { r: number };
  beacon: { cradle: Point; radius: number; plantRange: number };
  solids: SolidBox[];
  circles: SolidCircle[];
  props: PropDef[];
  doorway: DoorwayDef;
  cameras: CameraRigDef[];
  ground: Array<Rect & { color: number }>;
}
