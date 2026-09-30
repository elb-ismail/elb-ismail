# The Moving Sanctuary

A single-player browser game built from the two design briefs, *The Shmaikel Pass* and *High-Retention Video Game Patterns*. It implements their top-ranked concept, "The Moving Sanctuary", together with the "Moving House" rule: **the world rearranges wherever no light falls.**

You tend a walking refuge across a persistent world of shifting places. In each place you go out with a lantern to gather ember and salvage, find survivors, and read relics. Then you decide when to leave. Everything you do is written into a chronicle that the next crossing inherits.

It is one file, `index.html`, with no build step and no dependencies.

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly in a browser also works.

## How a crossing plays

1. **Route.** Choose the next place on a branching map. Readings are estimates, including ember ranges, how many voices can be heard, and the place's history. Every journey costs ember, and the cost grows with the size of your crew.
2. **Place.** Explore a procedurally recombined set of rooms in the dark:
   - **Unlit doorways change.** A doorway can open or close only while no light touches it (lantern, beacon, flare, Sanctuary). Doorways in a beacon's room or within its reach are pinned. A doorway that just changed settles for 18 seconds, so looking away and back cannot reroll it. Changes favour doorways near you, and settling stone can wake a Hollow nearby. Your map remembers what you last saw, and it can be wrong.
   - **Hollows move only in darkness.** Lantern, beacon, flare and Sanctuary light freeze them, and a focused lantern burns them. They come from where you are not looking.
   - **Only what reaches the Sanctuary is safe.** Carried ember, salvage and survivors must be brought back into its light.
   - **The dark rises and the place thins out.** Every minute you stay, yield drops and danger climbs.
3. **Dock.** At the Sanctuary you resupply and see exactly what leaving now would cost. That includes voices you heard but did not reach, beacons you would leave burning, and how the Hollows are reading your tactics. Time stops while you decide.
4. **Debrief.** After six journeys, or if you run out of ember, or if the Warden falls with no one left to carry them home, you get a summary of your decisions and their consequences.

## Controls

| Action | Keyboard + mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows | Left stick | Drag on the left half |
| Aim lantern | Mouse | Right stick | Drag on the right half |
| Focus and burn | Hold left click or Shift | RT / LT | Push the aim stick fully |
| Flare | F or right click | B | FLARE |
| Beacon | B | X | BEACON |
| Use, hold to gather | E or Space | A | USE |
| Lenses | 1 2 3 4, Q or Tab to cycle | Y, LB, RB | LENS, or tap the lens bar |
| Field guide | H | — | from the pause menu |
| Pause | Esc / P | Start | II (under the minimap) |

The letter keys and Shift can be rebound in Settings; the arrows, Space, Tab, Esc and P always work as well. The on-screen guide and the Field Guide always name the keys and input you are actually using.

## The first place

Crossing 1 opens on a staged first place, set up by the generator rather than a script: the corridor east of the dock is always open, one voice is a mimic two rooms away, a real survivor is at least three rooms out, a relic is nearby, and the dark and Hollows rise slowly. The on-screen guide gives one short tip at a time, based on what you have actually done. It acknowledges things you did early (a beacon before being told, a flare before any lens), points back to a dropped pack after a fall, and says nothing that assumes a fixed order. Tips you have learned are remembered, so a later crossing is not a tutorial. Everything the guide has said is in the Field Guide (H, or from the pause menu).

## Art direction

A drowned, impossible city: wet flagstones laid on a different grid in every room, standing water that glints only where light falls, mineral drips and oxidised bands on walls. The Sanctuary is a walking reliquary with crew lanterns, patched scars from each fall, and the fragments you have found. The rules are drawn, not decorated:

- **Light is truth.** Only lit things are drawn. A doorway shows its true state only while lit; elsewhere you see your memory of it, which fades.
- **Pinned ground** shows as hex territory around beacons, and brackets on each doorway a beacon holds.
- **Lenses have distinct visual grammars.** Ember uses heat contours and room totals, Echo a sonar sweep with pulse traces, and Survey a blueprint with PINNED, OPEN, SHUT and when each doorway was last lit.
- **Flares** strike, burst and leave an afterimage; a mimic's reveal quotes the clues you had noticed.
- The menus share one interface language: brass and smoked-glass cards, a route map on chart paper, and wax-seal nodes.

All art is drawn in code at runtime. No image, font or sound files are imported, apart from web fonts loaded from Google Fonts, with system fallbacks.

## Sound

Everything is synthesised with Web Audio at runtime, and nothing plays before your first click, key or tap. There are separate buses for music, ambience, effects and voices, each with its own volume and a master volume. The score is eight layers (Sanctuary pulse, warmth, exploration, instability, low warmth, danger, suspicion, rescue). They follow the game's heartbeat and change at bar boundaries, driven by what is happening (dark level, nearby Hollows, heard voices, carried survivors). Voices are nonverbal murmurs with their words as text; the game does not attempt synthesised speech. Sound is never the only carrier of information: speech appears as a bubble on screen, off-screen voices and important sounds get captions with direction, and ambient captions can be turned off separately. Audio suspends when the tab is hidden. Whether the music and sound are *good* has not been judged by a human listener.

## Accessibility and settings

- Volumes per bus, captions and ambient captions, high contrast, reduced motion (defaults to your system setting), flash reduction, a more readable font, and key rebinding. Settings are stored on this device and merged with defaults, so older saved settings keep working.
- Touch controls are at least 44 px and do not cover the lens bar or the guide. Keyboard, mouse, gamepad and touch all work, and on-screen text follows the input you last used.
- If frames run long, the darkness mask drops to half resolution once, for the rest of the session.

## Saves

The chronicle is stored in `localStorage` under `moving-sanctuary.chronicle.v1` and settings under `moving-sanctuary.settings.v1`. The save format is unchanged from before this upgrade. New fields are optional and take defaults, and loading a save does not rewrite it. A real save from the earlier build is kept in `tests/fixtures/pre-upgrade-v1.json` and is played, saved and reloaded by the tests. Generation is deterministic for a given seed, but the first place of crossing 1 is now staged, so it differs from what the earlier build generated for that seed.

## Tests

The tests use Playwright (a global install is fine) and the page's debug hook.

```sh
node tests/scenarios.mjs              # all behaviour scenarios; pass part of a name to filter
node tests/visual.mjs all             # screenshot tour, desktop and phone, into tests/out/visual/
node tests/visual.mjs desktop contrast
node tests/visual.mjs desktop reduced
```

The scenarios cover the staged first place; that unlit loot and Hollows are not drawn (pixel check); the doorway rule, pinning and settling; looking away; six different orders of play (leave at once, ignore the voice, flare first, beacon early, fall, return in a later crossing); audio start, buses, mute, node cleanup and caption parity; reduced motion, contrast, rebinding and volume persistence; phone layout and touch controls; the comparison toggles, questionnaire and JSON export; the performance fallback; and the pre-upgrade save. The audio tests check that sounds start, stop, route and clean up. They cannot tell whether anything sounds good.

The source is kept as one file on purpose. `index.html` is what you edit and what you ship.

## How the briefs map onto the game

| Brief requirement | Where it lives |
| --- | --- |
| Patch-leaving tension (marginal value theorem) | Each place has finite ember, richer the deeper you go, while the dark rises. The Ember lens and the dock show what is left, your gathering pace, and the time until blackout. Leaving costs ember, and you cannot go back. |
| Asymmetric information (solo fallback: role switching) | Four lenses you can hold only one at a time: Lantern, Ember (yield through walls), Echo (Hollows and voice pulses), Survey (true doorways nearby). Any lens shrinks your lantern, so information costs safety. |
| Fair misdirection | Mimics sit closer and call louder than real survivors, the plausible false lead. Every mimic carries all its clues: its pulse drifts off the Sanctuary's heartbeat (read in the Echo lens, or by watching it long enough), it wanders when unwatched, its words repeat, and flares expose it. What you have actually noticed is written into a clue ledger under the figure; the ledger is the only source for the chips, sounds and reveal text, so nothing claims a clue you did not see. Essential clues are always text and shape, never only a sound, a tiny sprite detail or an effect that low settings drop. |
| Orientation attacks with readable counterplay | If one tactic dominates a place (focused lantern, flares or beacons), the Hollows adapt: Veiled, Hushed or Gnawers. At most one new adaptation per place, each with a visible signature and a stated counter, shown before it takes effect. It fades after three places if you change tactics. |
| Consequence ledger / legacy persistence | Places remember what you took (regrowth), beacons you left (still lit next crossing), and voices you abandoned (the dark reuses their names). Crew carry scars from rescuing you. Everything is in the Chronicle's ledger. |
| Promise, pursuit, payoff, propagation | Eight relic fragments explain why the world moves. Each one answers something and raises a new question, and the last one is read only at the Far Shore. |
| Selective loss, not total loss | When the Warden falls, a crew member carries them home. The pack and any escorts stay where you fell, so you can go back for them. The crossing ends only when no one is left to carry you. |
| Rhythm: tension and relief | The dark, the whispers of moving Hollows, and the drone rise with the dark. The Sanctuary's heartbeat, the quiet route screen, and the paused dock provide relief. |
| Ethical retention | No streaks, timers, daily rewards, purchases or missable power. There is a save and a clean stopping point at every route screen ("Rest here"). Challenge settings are visible and yours to change. |
| Measure it | See Playtesting below. |

### Out of scope in this build

- **Co-op and ritual synchrony.** The briefs' strongest ideas include one to four players with different information, and coordinated rituals. This build is the solo fallback the briefs suggest: one player switching perception roles. Networked co-op and a synchrony mechanic would need a server and a separate design pass.
- **Real playtests and listening.** The briefs' pass and kill thresholds need human players, and the sound and music need human ears. The game includes tooling for playtests (below), but no playtest or listening results exist yet.
- **Screens with less polish.** The golden path, in-place HUD, route, dock, title, guide, captions, settings and Field Guide have had the full art and interface pass. The debrief, chronicle, pause and relic-reading screens use the shared styles but have not had a dedicated pass.

## Playtesting

- **Variants for ablation tests.** In Settings, "Playtest variants" switch off one system at a time: doorways never move, Hollows never adapt, no memory between crossings, no mimics. This lets you compare the full loop with each ablation, as the briefs' decisive tests require.
- **Notes.** The debrief has optional 1–7 questions about wanting to replay, pressure, agency, fairness of surprises, and ability to stop. They are saved with decision metrics: time, decisions per minute, when and why you left each place, lens use, doorway surprises, time to the first doorway change, doorways that changed while you were deliberately looking away, reads informed by a lens, what each flare did, packs recovered or left behind, long idle pauses, mimic clues seen, rescues and abandonments. "Copy all notes" exports them as JSON. Nothing leaves the device.
- **Debug hook.** Opening the page with `?debug=1` or `#debug` exposes the game state as `window.MS`, for automated tests.

## Prototype A (3D, separate project)

`prototype-a/` holds a graybox Three.js/TypeScript/Vite prototype for the fixed-camera 3D direction. It tests only the camera, the beacon and the changed-doorway rule. It is separate from the single-file game above. See `prototype-a/README.md`.

## History

The first version in this repository was **Voidlight**, a twin-stick arena shooter. It is still in the git history (`fa76913`). It was replaced because it did not follow the design briefs above.
