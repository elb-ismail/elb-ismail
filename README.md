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
   - **Unlit doorways change.** A doorway can open or close only while no light touches it. Your map remembers what you last saw, and it can be wrong.
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
| Lenses | 1 2 3 4, Q to cycle | Y, LB, RB | LENS, or tap the lens bar |
| Pause | Esc / P | Start | II |

## How the briefs map onto the game

| Brief requirement | Where it lives |
| --- | --- |
| Patch-leaving tension (marginal value theorem) | Each place has finite ember, richer the deeper you go, while the dark rises. The Ember lens and the dock show what is left, your gathering pace, and the time until blackout. Leaving costs ember, and you cannot go back. |
| Asymmetric information (solo fallback: role switching) | Four lenses you can hold only one at a time: Lantern, Ember (yield through walls), Echo (Hollows and voice pulses), Survey (true doorways nearby). Any lens shrinks your lantern, so information costs safety. |
| Fair misdirection | Mimics sit closer and call louder than real survivors, the plausible false lead. Every mimic carries all its clues: its pulse drifts off the Sanctuary's heartbeat (seen in Echo and heard as chimes), it wanders when unwatched, its words repeat, and it flinches from flares. The reveal lists which clues you saw, and the debrief records whether you checked them. |
| Orientation attacks with readable counterplay | If one tactic dominates a place (focused lantern, flares or beacons), the Hollows adapt: Veiled, Hushed or Gnawers. At most one new adaptation per place, each with a visible signature and a stated counter, shown before it takes effect. It fades after three places if you change tactics. |
| Consequence ledger / legacy persistence | Places remember what you took (regrowth), beacons you left (still lit next crossing), and voices you abandoned (the dark reuses their names). Crew carry scars from rescuing you. Everything is in the Chronicle's ledger. |
| Promise, pursuit, payoff, propagation | Eight relic fragments explain why the world moves. Each one answers something and raises a new question, and the last one is read only at the Far Shore. |
| Selective loss, not total loss | When the Warden falls, a crew member carries them home. The pack and any escorts stay where you fell, so you can go back for them. The crossing ends only when no one is left to carry you. |
| Rhythm: tension and relief | The dark, the whispers of moving Hollows, and the drone rise with the dark. The Sanctuary's heartbeat, the quiet route screen, and the paused dock provide relief. |
| Ethical retention | No streaks, timers, daily rewards, purchases or missable power. There is a save and a clean stopping point at every route screen ("Rest here"). Challenge settings are visible and yours to change. |
| Measure it | See Playtesting below. |

### Out of scope in this build

- **Co-op and ritual synchrony.** The briefs' strongest ideas include one to four players with different information, and coordinated rituals. This build is the solo fallback the briefs suggest: one player switching perception roles. Networked co-op and a synchrony mechanic would need a server and a separate design pass.
- **Real playtests.** The briefs' pass and kill thresholds need human players. The game includes tooling for them (below), but no results exist yet.

## Playtesting

- **Variants for ablation tests.** In Settings, "Playtest variants" switch off one system at a time: doorways never move, Hollows never adapt, no memory between crossings, no mimics. This lets you compare the full loop with each ablation, as the briefs' decisive tests require.
- **Notes.** The debrief has optional 1–7 questions about wanting to replay, pressure, agency, fairness of surprises, and ability to stop. They are saved with decision metrics: time, decisions per minute, when and why you left each place, lens use, doorway surprises, mimic clues seen, rescues and abandonments. "Copy all notes" exports them as JSON. Nothing leaves the device.
- **Debug hook.** Opening the page with `#debug` exposes the game state as `window.MS`, for automated tests.

## History

The first version in this repository was **Voidlight**, a twin-stick arena shooter. It is still in the git history (`fa76913`). It was replaced because it did not follow the design briefs above.
