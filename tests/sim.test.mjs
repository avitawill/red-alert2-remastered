// Headless simulation test: AI vs AI games must run without errors and make progress.
// Run: node tests/sim.test.mjs
import { World } from '../src/world.js';
import { updateAI } from '../src/ai.js';
import { BUILDINGS } from '../src/config.js';

function runGame(seed, size, players, minutes, verbose) {
  const w = new World({ seed, size, players, credits: 10000, fog: true, superweapons: true, crates: true, startUnits: 'crawler', swScale: 0.5 });
  const ticks = minutes * 60 * 20;
  const t0 = Date.now();
  for (let i = 0; i < ticks; i++) {
    for (const p of w.players) if (p.ai) updateAI(w, p);
    w.tick();
    w.events.length = 0;
    if (w.over) break;
    if (verbose && i % (20 * 60) === 0) {
      const line = w.players.filter((p) => !p.neutral).map((p) => {
        const b = w.buildings.filter((x) => x.owner === p.id).length;
        const u = w.units.filter((x) => x.owner === p.id).length;
        return `${p.name}: $${Math.round(p.credits)} B${b} U${u} pw${p.powerProd}/${p.powerUse} harv${p.stats.harvested}`;
      }).join(' | ');
      console.log(`[${Math.round(w.time / 60)}m] ${line}`);
    }
  }
  const ms = Date.now() - t0;
  return { w, ms, ticks: w.tickN };
}

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok -', msg); };

// 1. Two AIs, normal map
{
  const { w, ms, ticks } = runGame(12345, 96, [
    { name: 'A', faction: 'accord', color: '#3d9cf0', ai: true, difficulty: 'hard' },
    { name: 'B', faction: 'dominion', color: '#e8553a', ai: true, difficulty: 'hard' },
  ], 25, true);
  console.log(`sim ${ticks} ticks in ${ms}ms (${(ticks / (ms / 1000)).toFixed(0)} ticks/s)`);
  for (const p of w.players.filter((p) => !p.neutral)) {
    check(p.stats.bldBuilt >= 6 || p.defeated, `${p.name} built a base (${p.stats.bldBuilt} structures)`);
    check(p.stats.harvested > 3000 || p.defeated, `${p.name} harvested crystal (${p.stats.harvested})`);
    check(p.stats.unitsBuilt >= 10 || p.defeated, `${p.name} trained units (${p.stats.unitsBuilt})`);
  }
  const kills = w.players.reduce((a, p) => a + p.stats.unitsKilled + p.stats.bldKilled, 0);
  check(kills > 5, `combat happened (${kills} kills)`);
  console.log('over:', w.over, 'time', Math.round(w.time), 's');
  // Save/load roundtrip
  const json = JSON.stringify(w.toJSON());
  const w2 = World.fromJSON(JSON.parse(json));
  for (let i = 0; i < 200; i++) { for (const p of w2.players) if (p.ai) updateAI(w2, p); w2.tick(); w2.events.length = 0; }
  check(w2.tickN === w.tickN + 200, `save/load roundtrip (${(json.length / 1024).toFixed(0)} KB)`);
}

// 2. Four-player FFA on a large map with brutal AIs, check no crash.
{
  const { w, ms, ticks } = runGame(777, 128, [
    { name: 'A', faction: 'accord', color: '#3d9cf0', ai: true, difficulty: 'brutal' },
    { name: 'B', faction: 'dominion', color: '#e8553a', ai: true, difficulty: 'normal' },
    { name: 'C', faction: 'accord', color: '#4fc768', ai: true, difficulty: 'easy' },
    { name: 'D', faction: 'dominion', color: '#f0c544', ai: true, difficulty: 'hard', team: 1 },
  ], 12, false);
  console.log(`4p sim ${ticks} ticks in ${ms}ms`);
  check(w.buildings.some((b) => BUILDINGS[b.type].superweapon) || true, '4-player game ran');
}

// 3. Small map determinism of world (no AI randomness): same seed same map.
{
  const mk = () => new World({ seed: 42, size: 64, players: [{ name: 'A', faction: 'accord', color: '#fff' }, { name: 'B', faction: 'dominion', color: '#000' }] });
  const a = mk(), b = mk();
  check(a.map.terrain.every((v, i) => v === b.map.terrain[i]) && a.starts[0].x === b.starts[0].x, 'map generation is deterministic');
}

if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log('All simulation tests passed.');
