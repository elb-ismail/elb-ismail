# Moving Sanctuary: Prototype A (camera, beacon, changed doorway)

A deliberately ugly, 2–3 day risk-reduction prototype. It is **not** the Kiln Street Crossing vertical slice. It exists to answer one question before any art, characters, Mimics, Hollows, interiors or narrative are built:

> Can a first-time player move comfortably in a fixed-camera 3D space, understand that a doorway changed only while it was unobserved, notice the physical evidence, understand that the beacon holds architecture stable, and still find a valid route back to the Sanctuary?

Everything is flat-coloured blocks, cylinders and debug text.

## Run it

```sh
cd prototype-a
npm install
npm run dev            # open the printed URL (http://localhost:5173)
```

| Key | Action |
| --- | --- |
| WASD / arrow keys | Move (relative to the screen: up is up) |
| E or Space | Plant the beacon (only at the cradle) |
| R | Restart |
| F3 or ` | Debug overlay |

URL options: `?debug=1` opens with the debug overlay; `?seed=123` changes the world-RNG seed; `?hooks` exposes `window.__proto` for scripted testing.

Other commands:

```sh
npm test               # 33 simulation, camera and determinism tests (Vitest, headless)
npm run typecheck
npm run build          # static build in dist/
npm run shots          # builds, serves, and saves a screenshot tour to tools/out/ (needs Playwright)
```

## The space (54 m)

```
  n=46 ┌──────── yard north wall ────────┐
       │         far marker (n 43)        │   YARD camera: bounded follow from the south-west
  n=31 │                                   │
  n=30 ╞══wall══[ GATE ]═╡ ╞[CHUTE]══wall══╡   doorway anchor: Pellow's gate / coal chute
       │  cradle ●  ash patch  │ railing   │   (low kiln sheds either side for the last 6 m)
       │         Kiln Street    │ coal pit  │   STREET camera: rail from the south-east
  n=0  └───┐                          ┌─────┘
           │  Sanctuary ▓  home pad    │
  n=-10 ~~~~~~~~~~~~~ water ~~~~~~~~~~~~~~
```

The objective is only "walk to the far marker in the yard, then return to the Sanctuary", and it repeats. The HUD never mentions the doorway, because noticing the change is what's being measured.

## The rules as implemented

### Doorway anchor
- **State A:** the iron gate stands open; the coal chute is bricked with old brick.
- **State B:** the gate is bricked with fresh brick; the chute is open.
- **Evidence when entering B by a change:**
  - the Pellow sign face-down on the ground
  - fresh pale brick with a black flood line at 0.8 m
  - three large drag marks in the wet ash
  - the adjacent railing kinked west instead of east
- **Evidence when changing back to A:** mirrored. The chute gets fresh brick, a flood line and drag marks, and the sign hangs crooked.

All states and props are data in `src/data/prototypeA.ts`.

### The doorway changes only when all of these hold (`simulation/DoorwaySystem.ts`)
1. **Seen:** its current state was on screen for at least 3 s while covering at least 1.5 % of the screen (a stable composition, not a speck).
2. **Out of view:** it has been off screen or occluded for at least 1.5 s.
3. **Far:** the player is at least 8 m away.
4. **Cut:** the player crossed a camera cut *after* condition 1 was met.
5. **Free:** no planted beacon protects it.
6. **Route:** after the swap, a flood fill over the real colliders still connects the player to the Sanctuary. Otherwise the swap is vetoed.

Two restrictions are added on top. Both only ever make changes rarer:
- **Pacing:** at most one change per trip out from the Sanctuary.
- **Home closes the excursion:** arriving home clears the cut earned on the way back, so the next change needs a fresh before-shot and cut on the next trip.

**What "observed" means.** Eleven sample points cover the anchor's street face, yard face and wall top. The anchor counts as observed if any one of them is inside the real render camera's frustum (with a 10 % margin) and not behind an occluder.
- The same `PerspectiveCamera` object is used for rendering and for this test.
- When a building fades because it stands between the camera and the player, the simulation picks that building and treats it as see-through. The renderer fades exactly that set, so "observed" stays equal to "on screen".
- The doorway wall itself never fades; a silhouette of the player shows through it instead.

### Beacon (`simulation/BeaconSystem.ts`)
- One beacon, plantable only at the cradle, within 1.8 m.
- It protects everything within 6 m. The doorway is 4.8 m away, so the beacon can hold it.
- Planted, it shows as an amber lamp and warm light, plus a faint amber ring on the ground marking the protected radius. A single toast reads: "Beacon lit. What stands in its light stays as it is."
- In debug mode the radius is also drawn as a thin orange line.

### Cameras (`camera/`)
- Two authored rigs, street and yard, with no player rotation. Each follows the player inside its volume with exponential smoothing (half-life 0.3 s).
- The volumes meet at the doorway wall. The camera switches only once the player is 1 m past that line, in either direction, which gives a 2 m hysteresis band, so dithering in the doorway causes no ping-pong.
- A switch is a hard cut. After a cut, input keeps using the previous camera's heading until the player changes direction by more than 35°, releases the keys for 0.2 s, or 2 s pass. Holding "up" through the doorway keeps walking straight.
- **Occlusion handling:**
  - authored first: low sheds by the doorway, a mooring stack closing the pocket behind the Sanctuary
  - then fading occluders between camera and player
  - then a cream silhouette drawn through geometry as a last resort

## Architecture

```
src/
  core/        Game (one fixed step: player, camera, beacon, observation, doorway, objective), FixedStepLoop,
               EventBus, Rng (4 streams), Space (plan <-> three.js coordinates), PlaceholderAudio
  simulation/  WorldState, DoorwaySystem, BeaconSystem, RouteGraph (walkability flood fill)
  camera/      CameraController (rigs, smoothing, cuts, frustum + occlusion observation), CameraVolume (hysteresis)
  player/      PlayerController (camera-relative movement, control-frame hold), Collision
  scene/       SceneBuilder (renderer, lights, static graybox), GrayboxLevel (props, player, beacon), OcclusionDebug
  ui/          Hud (objective, prompt, toast), DebugOverlay (the six conditions live)
  data/        levelTypes, prototypeA (all geometry, doorway states, evidence props, cameras, rules)
  tests/       doorway, route, camera, determinism
```

- The simulation runs at a fixed 60 Hz, independent of rendering; the renderer only reads state.
- `simulation/` never imports Three.js. The camera module uses Three.js maths so that observation uses the same camera as rendering.
- **Random streams:** `world` places set dressing, `visual` drives the beacon's slow light breathing, `audio` varies placeholder tone pitch, and `test` drives randomised test walks. A test proves that consuming the visual and audio streams never changes the simulation.

## What the tests cover (33, all passing)

- **Each doorway condition blocks a change on its own**, including a variant level whose swap would trap the player (vetoed) and a cut that came before the before shot (doesn't count).
- **Scripted play through the real camera:**
  - the first trip changes the doorway only after the cut into the yard, at 8 m or more
  - a dense independent visibility check (about 300 points over the doorway and its props, no margin) confirms nothing of it was on screen at the moment of change
  - the gate is then physically blocked, and the chute leads home
  - the altered state is seen from the same street composition as the before shot
- **Beacon:** it holds the doorway through a full trip, and it can only be planted at the cradle.
- **Random wandering:** 12 seeded runs of random walking. Every change was off screen, far away and after a cut.
- **Walkability:** home is reachable from street and yard in every state, and the check correctly fails when both openings are bricked.
- **Cameras:**
  - no ping-pong when dithering in the doorway, and exactly one cut each way
  - the control-frame hold keeps the heading through the cut
  - at every walkable point and at 16:9, 16:10 and 21:9, the player is inside the screen-safe zone at 7.1–9.2 % of screen height
- **Determinism:** the same seed and inputs give the same state, step for step.

## Playtest script (first-time players)

**Setup:**
- 5–8 players who haven't seen the project; keyboard; debug overlay **off**.
- Tell them only the controls and "Walk to the far marker, then get back to the house. Keep going until I stop you."
- Don't mention the doorway, the beacon's purpose, or that anything can change.
- Stop after two full trips, or 8 minutes.

**Watch for (note the time):**
- stops, reversals or confusion right after the camera cut
- whether they plant the beacon, and on which trip
- their reaction on returning to the bricked gate: pause, retrace, look at the props
- how long they take to find the chute
- whether they read the drag marks, sign, mortar or railing

For logs, open the page with `?hooks`, then run `copy(JSON.stringify(__proto.events()))` in the browser console afterwards.

**Ask afterwards (open questions, in this order):**
1. "How did moving around feel? Was there any moment you lost track of which way you were going?"
2. "Did anything about the place change while you were playing? When do you think it happened?"
3. "What made you think so?" (Do they cite the sign, mortar, flood line, drag marks or railing?)
4. "What did the lamp at the bracket do?" (Only if planted: "Did anything behave differently after you lit it?")
5. "Was there a moment you thought you couldn't get back? How did you find the way?"

**Pass (keep the mechanic and build on it):**
- At least 4 of 5 players move without camera-cut confusion.
- At least 3 of 5 say the doorway changed while they were away or out of sight.
- At least 3 of 5 cite at least one piece of physical evidence unprompted.
- Every player finds the chute within 60 s.
- Among players who planted the beacon, most connect it to "things stay put".

**Revise the mechanic before any other production if:**
- Most players think they misremembered, or think it's a bug.
- Nobody cites evidence.
- Players feel the change happened in front of them.
- Players get stuck.

## Known limits (not verified here)

- **No human has played this yet.** Everything above is verified by automated tests and by inspecting screenshots.
- **Performance is unmeasured on real GPUs.** Headless software rendering (SwiftShader) runs at about 7 fps at 85 draw calls. The debug overlay shows FPS, draw calls and triangles on a real machine.
- **Scope:** keyboard only. One doorway, one beacon, two cameras.
- **Rule 4 interpretation.** Its stricter form ("a cut since the anchor was last observed") never fired in this layout, because the high yard camera keeps the wall top in view for a few metres after the cut. It's implemented as "a cut after the state was seen", plus the pacing budget. If playtesters feel the change happened in front of them, revisit this first.
- **Route check scope.** It checks the path from the player's current position, not from every reachable point.
