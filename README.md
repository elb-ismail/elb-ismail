# Voidlight

A twin-stick arena shooter with roguelite upgrades. It runs in any modern browser from a single file (`index.html`) and needs no build step or dependencies.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## Controls

| Action | Keyboard + mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrow keys | Left stick | Drag on the left half of the screen |
| Aim + fire | Mouse, hold left button | Right stick | Drag on the right half (auto-aims when idle) |
| Dash (invulnerable) | Space / Shift / right click | A / bumpers | DASH button |
| Pause | Esc / P | Start | Pause button |
| Toggle auto-fire | F | | |
| Mute | M | | |

## Features

- **Waves:** endless waves with a budget-based spawner. Enemies warp in behind telegraphed portals, so spawns are always fair.
- **Enemies:** seven types. Drones, weavers, gunners (ranged), chargers (telegraphed rams), splitters (burst into mites) and brutes.
- **Bosses:** one every 5th wave (Sentinel, Hydra-9, Monolith, Eclipse, The Warden). Each has ring, spiral, aimed-burst and summon patterns, plus an enraged second phase.
- **Roguelite progression:** 15 upgrades across offense, defense and utility. Examples: split shot, piercing, ricochet, seeker rounds, orbital blades, nova dash, regeneration.
- **Scoring:** a kill-chain multiplier (up to ×5), wave-clear bonuses, and a best score and furthest wave saved locally.
- **Game feel:** hit-stop, screen shake, particles, additive glow, dash afterimages and damage flashes.
- **Audio:** fully synthesized with the Web Audio API. It has sound effects and an adaptive soundtrack that intensifies in combat and boss fights.
- **Accessibility:** toggles for sound, music, screen shake and auto-fire. Respects `prefers-reduced-motion`. Menus are fully keyboard- and gamepad-navigable.
