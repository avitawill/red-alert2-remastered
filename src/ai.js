// Computer opponent. State lives on player.aiState so saves capture it.
import { TILE, UNITS, BUILDINGS, DIFFICULTY } from './config.js';
import { dist } from './util.js';

const tileOf = (p) => Math.floor(p / TILE);

export function updateAI(world, p) {
  if (p.defeated || !p.ai || world.over) return;
  const D = DIFFICULTY[p.difficulty] || DIFFICULTY.normal;
  if (!p.aiState) p.aiState = { next: 1 + Math.random(), waves: 0, wave: D.wave, rallyX: 0, rallyY: 0, attacking: [], lastDefend: -99, lastPlaceFail: 0 };
  const s = p.aiState;
  s.next -= 1 / 20;
  if (s.next > 0) return;
  s.next = D.think;
  think(world, p, s, D);
}

function myBuildings(w, pid) { return w.buildings.filter((b) => b.owner === pid && !b.dead); }
function myUnits(w, pid) { return w.units.filter((u) => u.owner === pid && !u.dead); }
function count(list, type) { return list.filter((e) => e.type === type).length; }

function think(w, p, s, D) {
  const blds = myBuildings(w, p.id);
  const units = myUnits(w, p.id);
  const hq = blds.find((b) => b.type === 'hq');
  const enemies = w.players.filter((o) => !o.neutral && !o.defeated && w.isEnemy(p.id, o.id));

  // Base center & rally toward nearest enemy start
  const base = hq || blds[0] || units[0];
  if (!base) return;
  const bx = base.x, by = base.y;
  const target = enemies.length ? enemies.reduce((a, o) => (dist(bx, by, o.startX * TILE, o.startY * TILE) < dist(bx, by, a.startX * TILE, a.startY * TILE) ? o : a)) : null;
  const ex = target ? target.startX * TILE : w.map.w * TILE / 2, ey = target ? target.startY * TILE : w.map.h * TILE / 2;
  const toE = Math.atan2(ey - by, ex - bx);
  s.rallyX = bx + Math.cos(toE) * TILE * 7; s.rallyY = by + Math.sin(toE) * TILE * 7;

  // 1) No construction yard: deploy crawler or build one.
  if (!hq) {
    const crawler = units.find((u) => u.type === 'crawler');
    if (crawler) {
      if (crawler.order.type === 'idle' && !crawler.moving) {
        if (!w.command(p.id, { type: 'deploy', ids: [crawler.id] })) {
          // move to an open spot
          const a = Math.random() * Math.PI * 2;
          w.command(p.id, { type: 'move', ids: [crawler.id], x: crawler.x + Math.cos(a) * TILE * 4, y: crawler.y + Math.sin(a) * TILE * 4 });
        }
      }
    } else if (w.canBuild(p.id, 'crawler') && !p.queues.vehicle.some((q) => q.type === 'crawler')) {
      w.command(p.id, { type: 'queue', item: 'crawler' });
    }
  }

  // 2) Place finished structures.
  for (const cat of ['building', 'defense']) {
    const r = p.ready[cat];
    if (!r) continue;
    if (BUILDINGS[r].wall) { w.command(p.id, { type: 'cancelPlace', cat }); continue; }
    const spot = findSpot(w, p, r, hq || base, toE);
    if (spot) w.command(p.id, { type: 'place', cat, item: r, tx: spot[0], ty: spot[1] });
    else if (++s.lastPlaceFail > 10) { s.lastPlaceFail = 0; w.command(p.id, { type: 'cancelPlace', cat }); }
  }

  // 3) Choose next structure.
  if (hq && !p.queues.building.length && !p.ready.building) {
    const next = nextBuilding(w, p, blds, D);
    if (next) w.command(p.id, { type: 'queue', item: next });
  }
  if (hq && !p.queues.defense.length && !p.ready.defense && w.time > 90) {
    const defs = blds.filter((b) => BUILDINGS[b.type].cat === 'defense').length;
    const want = Math.min(D.defenses, Math.floor(w.time / 120) + 1);
    if (defs < want && p.credits > 800 && !p.lowPower) {
      const opts = ['lancetower', 'bastion', 'turret', 'sentry'].filter((t) => w.canBuild(p.id, t));
      if (opts.length) w.command(p.id, { type: 'queue', item: defs % 3 === 2 && opts.includes('sentry') ? 'sentry' : opts[0] });
    }
  }

  // 4) Units.
  const refs = count(blds, 'refinery');
  const harvs = count(units, 'harvester');
  const wantHarv = Math.min(8, Math.round(refs * D.harvPerRef));
  const vq = p.queues.vehicle;
  if (harvs < wantHarv && w.canBuild(p.id, 'harvester') && !vq.some((q) => q.type === 'harvester')) w.command(p.id, { type: 'queue', item: 'harvester' });
  else if (vq.length < 2 && p.credits > D.reserve + 600 && w.producers(p.id, 'vehicle').length) {
    const opts = [];
    const add = (t, wt) => { if (w.canBuild(p.id, t)) for (let k = 0; k < wt; k++) opts.push(t); };
    add('tank', 5); add('raider', 2); add('artillery', 2); add('lancer', 3); add('behemoth', 3);
    if (opts.length) w.command(p.id, { type: 'queue', item: opts[Math.floor(Math.random() * opts.length)] });
  }
  const iq = p.queues.infantry;
  if (iq.length < 2 && p.credits > D.reserve + 200 && w.producers(p.id, 'infantry').length) {
    const opts = [];
    const add = (t, wt) => { if (w.canBuild(p.id, t)) for (let k = 0; k < wt; k++) opts.push(t); };
    add('rifle', 5); add('rocket', 4);
    const neutralRigs = w.buildings.some((b) => !b.dead && b.owner === w.neutralId);
    if (neutralRigs && count(units, 'engineer') < 1) add('engineer', 3);
    add('ranger', 1); add('juggernaut', 1);
    if (opts.length) w.command(p.id, { type: 'queue', item: opts[Math.floor(Math.random() * opts.length)] });
  }

  // 5) Repair damaged buildings.
  for (const b of blds) if (!b.repairing && b.hp < b.maxHp * 0.6 && p.credits > 600 && b.built >= 1) w.command(p.id, { type: 'repair', target: b.id, on: true });

  // 6) Engineers capture neutral rigs.
  for (const u of units) {
    if (u.type !== 'engineer' || u.order.type !== 'idle') continue;
    let best = null, bd = 1e18;
    for (const b of w.buildings) {
      if (b.dead || b.owner !== w.neutralId) continue;
      const d = dist(u.x, u.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) w.command(p.id, { type: 'attack', ids: [u.id], target: best.id });
  }

  // 7) Army: defend, gather, attack.
  const army = units.filter((u) => {
    const d = UNITS[u.type];
    return d.weapon && !d.harvester;
  });
  const idle = army.filter((u) => u.order.type === 'idle');
  const la = p.lastAttack;
  if (la && w.time - la.t < 6 && dist(la.x, la.y, bx, by) < TILE * 16 && w.time - s.lastDefend > 4) {
    s.lastDefend = w.time;
    const defenders = army.filter((u) => u.order.type === 'idle' || (u.order.type === 'move' && dist(u.x, u.y, bx, by) < TILE * 20) || u.order.type === 'attackmove' && dist(u.x, u.y, bx, by) < TILE * 14);
    if (defenders.length) w.command(p.id, { type: 'attackmove', ids: defenders.map((u) => u.id), x: la.x, y: la.y });
  }
  // gather idle units at rally
  const stray = idle.filter((u) => dist(u.x, u.y, s.rallyX, s.rallyY) > TILE * 6);
  if (stray.length) w.command(p.id, { type: 'move', ids: stray.map((u) => u.id), x: s.rallyX, y: s.rallyY });

  const atRally = army.filter((u) => u.order.type === 'idle' && dist(u.x, u.y, s.rallyX, s.rallyY) < TILE * 8);
  if (w.time >= D.firstAttack && atRally.length >= s.wave && target) {
    const tgt = pickAttackTarget(w, p, bx, by);
    if (tgt) {
      w.command(p.id, { type: 'attackmove', ids: atRally.map((u) => u.id), x: tgt.x, y: tgt.y });
      s.waves++;
      s.wave = Math.min(D.maxWave, s.wave + D.waveGrow);
    }
  }
  // units that finished an attack-move far from base: push to next target
  for (const u of idle) {
    if (dist(u.x, u.y, bx, by) > TILE * 18) {
      const tgt = pickAttackTarget(w, p, u.x, u.y);
      if (tgt) w.command(p.id, { type: 'attackmove', ids: [u.id], x: tgt.x, y: tgt.y });
      else w.command(p.id, { type: 'move', ids: [u.id], x: s.rallyX, y: s.rallyY });
    }
  }

  // 8) Superweapon.
  if (p.sw.ready) {
    let best = null, bv = 0;
    for (const b of w.buildings) {
      if (b.dead || !w.isEnemy(p.id, b.owner)) continue;
      let v = 0;
      for (const o of w.buildings) if (!o.dead && o.owner === b.owner && dist(o.x, o.y, b.x, b.y) < TILE * 4) v += BUILDINGS[o.type].cost;
      if (v > bv) { bv = v; best = b; }
    }
    if (best) w.command(p.id, { type: 'superweapon', x: best.x, y: best.y });
  }
}

function pickAttackTarget(w, p, x, y) {
  let best = null, bd = 1e18;
  for (const b of w.buildings) {
    if (b.dead || !w.isEnemy(p.id, b.owner) || BUILDINGS[b.type].wall) continue;
    const d = dist(x, y, b.x, b.y);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) return best;
  for (const u of w.units) {
    if (u.dead || !w.isEnemy(p.id, u.owner)) continue;
    const d = dist(x, y, u.x, u.y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function nextBuilding(w, p, blds, D) {
  const c = (t) => count(blds, t) + (p.ready.building === t ? 1 : 0);
  const margin = p.powerProd - p.powerUse;
  const plan = [
    ['power', 1], ['refinery', 1], ['barracks', 1], ['factory', 1], ['power', 2], ['refinery', 2],
    ['radar', 1], ['power', 3], ['depot', 1], ['techlab', 1], ['power', 4], ['refinery', Math.min(3, D.maxRef)],
    ['factory', 2], ['power', 5], ['orbital', 1], ['silo', 1], ['barracks', 2], ['power', 6], ['refinery', D.maxRef], ['power', 7],
  ];
  for (const [t, n] of plan) {
    if (c(t) >= n) continue;
    if (!w.canBuild(p.id, t)) continue;
    const need = -(BUILDINGS[t].power || 0);
    if (t !== 'power' && need > 0 && margin - need < 0 && w.canBuild(p.id, 'power')) return 'power';
    if (p.credits < BUILDINGS[t].cost * 0.3 && t !== 'power' && t !== 'refinery') return null;
    return t;
  }
  if (margin < 50 && w.canBuild(p.id, 'power')) return 'power';
  return null;
}

function findSpot(w, p, type, anchor, toE) {
  const d = BUILDINGS[type];
  const ax = tileOf(anchor.x), ay = tileOf(anchor.y);
  let best = null, bs = 1e18;
  const isDef = d.cat === 'defense';
  // Refineries prefer crystal; defenses prefer the front facing the enemy.
  let ox = ax, oy = ay;
  if (d.refinery) {
    let od = 1e18;
    const m = w.map;
    for (let y = Math.max(0, ay - 16); y < Math.min(m.h, ay + 16); y++) for (let x = Math.max(0, ax - 16); x < Math.min(m.w, ax + 16); x++) {
      if (!m.ore[m.idx(x, y)]) continue;
      const dd = (x - ax) ** 2 + (y - ay) ** 2;
      if (dd < od) { od = dd; ox = x; oy = y; }
    }
  } else if (isDef) {
    ox = ax + Math.round(Math.cos(toE) * 7); oy = ay + Math.round(Math.sin(toE) * 7);
  }
  for (let r = 1; r <= 16; r++) {
    for (let k = 0; k < r * 8; k++) {
      const a = (k / (r * 8)) * Math.PI * 2;
      const tx = Math.round(ax + Math.cos(a) * r) - Math.floor(d.w / 2), ty = Math.round(ay + Math.sin(a) * r) - Math.floor(d.h / 2);
      if (!w.canPlace(p.id, type, tx, ty)) continue;
      // keep a 1-tile margin around (except defenses) so units can move
      if (!isDef && !margin(w, tx, ty, d.w, d.h)) continue;
      if (!isDef && oreUnder(w, tx - 1, ty - 1, d.w + 2, d.h + 2) && !d.refinery) continue;
      const score = Math.hypot(tx + d.w / 2 - ox, ty + d.h / 2 - oy) + Math.random() * 1.5;
      if (score < bs) { bs = score; best = [tx, ty]; }
    }
    if (best && r > 6) break;
  }
  return best;
}

function margin(w, tx, ty, ww, hh) {
  const m = w.map;
  for (let y = ty - 1; y <= ty + hh; y++) for (let x = tx - 1; x <= tx + ww; x++) {
    if (x >= tx && x < tx + ww && y >= ty && y < ty + hh) continue;
    if (!m.inb(x, y)) return false;
    if (m.bld[m.idx(x, y)]) return false;
  }
  // dock row under refineries/factories stays clear
  for (let x = tx; x < tx + ww; x++) if (m.inb(x, ty + hh + 1) && m.bld[m.idx(x, ty + hh + 1)]) return false;
  return true;
}
function oreUnder(w, tx, ty, ww, hh) {
  const m = w.map;
  let n = 0;
  for (let y = ty; y < ty + hh; y++) for (let x = tx; x < tx + ww; x++) if (m.inb(x, y) && m.ore[m.idx(x, y)]) n++;
  return n > 2;
}
