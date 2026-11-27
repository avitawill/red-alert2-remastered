# Iron Meridian

An original real-time strategy game for **phones, tablets and PCs**. It runs in any modern browser and can be installed as an app (PWA). Plain HTML5 Canvas + JavaScript modules, no build step and no dependencies.

All names, factions, units, art (drawn in code), music (procedurally generated) and voice lines are original.

## Play

**Play online:** https://avitawill.github.io/red-alert2-remastered/ (on a phone, use *Add to Home Screen* for fullscreen, offline play).

Serve the folder with any static web server and open `index.html`, for example:

```sh
npx serve .            # or: python3 -m http.server
```

On a phone, open the page and use **Add to Home Screen** / **Install App** for fullscreen, offline play. GitHub Pages works as-is.

## Features

- **Two asymmetric factions.** Aegis Accord (beam weapons, Ranger sniper, Beam Spire, Orbital Lance) and Ember Dominion (Behemoth heavy tank, Juggernaut flame trooper, Siege Bastion, Seismic Silo).
- **Base building.** Deploy the Base Crawler into a Command Yard. Placement must be near your base, with a live green/red footprint preview. Construction is animated. You can build barrier walls, sell for a partial refund, repair, set rally points and choose a primary factory. The Command Yard can pack back up into a crawler.
- **Economy.** Harvesters mine amber ($1) and azure ($2) crystal and unload at Refineries (each comes with a free Harvester). Crystal spires regrow fields. Engineers can capture neutral Drill Rigs for steady income.
- **Power grid.** Low power halves production speed, turns off the minimap and disables powered defenses and the superweapon charge.
- **Production.** Four build tabs, unit queues (Shift-click queues 5), pause and cancel with refunds, faster production with more factories, and spending as you build. Capturing an enemy yard, barracks or factory unlocks its faction's items.
- **Combat.** Armor and warhead damage tables, turrets that fire while moving, splash damage, chained beams, artillery minimum range, homing rockets, and veterancy (Veteran / Elite, where Elite units self-repair). Engineers capture or repair buildings, and the Ranger plants demolition charges.
- **Fog of war.** Unexplored shroud plus fog. Last-seen enemy structures stay visible. The Uplink Array enables the tactical minimap.
- **Superweapons.** Charge timers, warnings to all players and big area strikes.
- **Bonus crates.** Money, repairs, promotion, map reveal or free reinforcements.
- **AI opponents.** Easy / Normal / Hard / Brutal. The AI builds to a plan, manages power, harvests, places defenses, captures rigs, repairs, defends its base, attacks in growing waves and fires superweapons.
- **Skirmish setup.** 1–3 AI players, teams, faction and color per player, map size (64/96/128), seeded procedural maps with preview, starting credits and forces, game speed, and toggles for fog, superweapons and crates.
- **Save / load, pause, surrender, restart,** and an end-of-battle statistics table.
- **2.5D view** (toggle in Settings): structures rise from their foundations with lit front walls and cast shadows, rocky plateaus with cliff faces, standing trees, hill-shaded terrain and deeper water, raised vehicles with elevated turrets, and airborne projectiles. Units are depth-sorted so they pass behind tall buildings.
- **Audio.** Synthesized weapon and UI sounds, a generative soundtrack, spoken announcer alerts and optional unit responses.

## Controls

**Touch:** tap to select, move or attack · one-finger drag to scroll · pinch to zoom · long-press then drag (or the **Box** button) to box-select · double-tap a unit to select all of its type · hold group buttons 1–5 to assign · hold a build icon to pause or cancel · tap the crawler again to deploy · when placing, tap to position, then ✓.

**Mouse & keyboard:** left-click selects and commands, drag to box-select, right-click deselects, right-drag or screen edge scrolls, wheel zooms (a "modern" right-click-to-command scheme is in Settings). `Ctrl+1-9` / `1-9` control groups · `A` attack-move · `S` stop · `G` guard · `D` deploy · `X` scatter · `Q` army · `E` same type · `H` base · `Space` last alert · `R` repair · `Z` sell · `Tab` build tab · `Esc` cancel / menu · `P` pause · `F1` help.

## Tests

```sh
node tests/sim.test.mjs                 # headless AI-vs-AI games, save/load round-trip, determinism
node tests/browser.smoke.cjs out/       # Playwright: desktop + phone landscape/portrait, screenshots, page errors
```

## Layout

| File | Purpose |
|---|---|
| `src/config.js` | All unit, structure, warhead, faction and difficulty data |
| `src/world.js` | Deterministic simulation (DOM-free) |
| `src/map.js`, `src/path.js` | Procedural maps, A* pathfinding |
| `src/ai.js` | Computer opponent |
| `src/render.js`, `src/sprites.js` | Canvas renderer and procedural art |
| `src/controller.js`, `src/ui.js` | Input (touch/mouse/keyboard) and HUD |
| `src/audio.js` | Synthesized SFX, music, speech |
| `src/main.js` | Menus, game loop, saves, PWA |
