// Core simulation. Deterministic, DOM-free (runs in browser and in Node tests).
import { TILE, DT, UNITS, BUILDINGS, WARHEADS, RANKS, FACTIONS, DIFFICULTY, unitRadius } from './config.js';
import { RNG, clamp, dist, rotateTowards, angleDiff } from './util.js';
import { generateMap, GameMap, T } from './map.js';
import { PathFinder } from './path.js';

const CELL = 4; // spatial hash cell size in tiles
const tileOf = (p) => Math.floor(p / TILE);
const CATS = ['building', 'defense', 'infantry', 'vehicle'];

export function defOf(type) { return UNITS[type] || BUILDINGS[type]; }

export class World {
  constructor(setup, restore) {
    this.setup = setup;
    this.events = [];
    if (restore) { this._restore(restore); return; }
    this.rng = new RNG((setup.seed ^ 0x9e3779b9) >>> 0);
    const nPlayers = setup.players.length;
    const { map, starts, derricks } = generateMap(setup.seed, setup.size, nPlayers);
    this.map = map;
    this.starts = starts;
    this.time = 0; this.tickN = 0; this.nextId = 1;
    this.ents = new Map(); this.units = []; this.buildings = [];
    this.projectiles = []; this.strikes = []; this.crates = [];
    this.over = null;
    this.players = setup.players.map((ps, i) => this._makePlayer(i, ps));
    this.neutralId = this.players.length;
    this.players.push(this._makePlayer(this.neutralId, { name: 'Neutral', faction: 'accord', color: '#9a9a8a', team: -1, neutral: true }));
    this._initRuntime();
    for (const d of derricks) this.createBuilding(this.neutralId, 'derrick', d.x, d.y, true);
    this.players.forEach((p, i) => {
      if (p.neutral) return;
      const s = starts[i];
      p.startX = s.x; p.startY = s.y;
      this.createUnit(i, 'crawler', (s.x + 0.5) * TILE, (s.y + 0.5) * TILE);
      if (setup.startUnits === 'army') {
        const extra = ['tank', 'tank', 'raider', 'rifle', 'rifle', 'rifle', 'rocket', 'rocket', 'engineer'];
        extra.forEach((t, k) => {
          const a = (k / extra.length) * Math.PI * 2;
          const slot = this.pf.nearestPassable(Math.round(s.x + Math.cos(a) * 3), Math.round(s.y + Math.sin(a) * 3), 6);
          if (slot) this.createUnit(i, t, (slot[0] + 0.5) * TILE, (slot[1] + 0.5) * TILE);
        });
      }
    });
    this.updateFog(true);
  }

  _makePlayer(id, ps) {
    const n = this.map.w * this.map.h;
    return {
      id, name: ps.name, faction: ps.faction, color: ps.color, ai: !!ps.ai, difficulty: ps.difficulty || 'normal',
      team: ps.team ?? id, neutral: !!ps.neutral,
      credits: ps.neutral ? 0 : (this.setup.credits ?? 10000),
      powerProd: 0, powerUse: 0, lowPower: false,
      queues: { building: [], defense: [], infantry: [], vehicle: [] },
      ready: { building: null, defense: null }, wallCharge: false,
      defeated: false,
      sw: { charge: 0, ready: false, max: 300 },
      vis: ps.neutral ? null : new Uint8Array(n),
      stats: { unitsBuilt: 0, unitsLost: 0, unitsKilled: 0, bldBuilt: 0, bldLost: 0, bldKilled: 0, harvested: 0, spent: 0 },
      alertT: -99, harvAlertT: -99, fundsT: -99, lastAttack: null,
      aiState: null, startX: 0, startY: 0,
    };
  }

  _initRuntime() {
    this.pf = new PathFinder(this.map);
    this.cw = Math.ceil(this.map.w / CELL); this.ch = Math.ceil(this.map.h / CELL);
    this.cells = Array.from({ length: this.cw * this.ch }, () => []);
    this.circles = [];
    this.powerDirty = true;
    this.pathBudget = 0;
  }

  // ---------- Serialization ----------
  toJSON() {
    const ents = [];
    for (const e of this.ents.values()) {
      const o = { ...e };
      ents.push(o);
    }
    return {
      v: 1, setup: this.setup, map: this.map.toJSON(), starts: this.starts,
      time: this.time, tickN: this.tickN, nextId: this.nextId, rng: this.rng.s,
      ents, projectiles: this.projectiles, strikes: this.strikes, crates: this.crates, over: this.over,
      players: this.players.map((p) => ({ ...p, vis: p.vis ? Array.from(p.vis) : null })),
      neutralId: this.neutralId,
    };
  }
  _restore(o) {
    this.map = GameMap.fromJSON(o.map);
    this.starts = o.starts;
    this.time = o.time; this.tickN = o.tickN; this.nextId = o.nextId;
    this.rng = new RNG(1); this.rng.s = o.rng;
    this.projectiles = o.projectiles; this.strikes = o.strikes; this.crates = o.crates; this.over = o.over;
    this.players = o.players.map((p) => ({ ...p, vis: p.vis ? Uint8Array.from(p.vis) : null }));
    this.neutralId = o.neutralId;
    this.ents = new Map(); this.units = []; this.buildings = [];
    for (const e of o.ents) {
      this.ents.set(e.id, e);
      (e.kind === 'unit' ? this.units : this.buildings).push(e);
    }
    this._initRuntime();
  }
  static fromJSON(o) { return new World(o.setup, o); }

  // ---------- Helpers ----------
  get(id) { const e = this.ents.get(id); return e && !e.dead ? e : null; }
  isEnemy(a, b) {
    if (a === b) return false;
    const pa = this.players[a], pb = this.players[b];
    if (!pa || !pb || pa.neutral || pb.neutral) return false;
    return pa.team !== pb.team;
  }
  isAlly(a, b) { return a === b || (this.players[a].team === this.players[b].team && !this.players[a].neutral); }
  visibleTo(pid, x, y) {
    const p = this.players[pid];
    if (!p.vis) return true;
    const tx = tileOf(x), ty = tileOf(y);
    if (!this.map.inb(tx, ty)) return false;
    return p.vis[ty * this.map.w + tx] === 2;
  }
  entVisibleTo(pid, e) {
    if (e.kind === 'unit') return this.visibleTo(pid, e.x, e.y);
    const p = this.players[pid];
    if (!p.vis) return true;
    for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (p.vis[y * this.map.w + x] === 2) return true;
    return false;
  }
  emit(ev) { this.events.push(ev); }
  ownedCount(pid, type) {
    let n = 0;
    for (const b of this.buildings) if (b.owner === pid && b.type === type && !b.dead && b.built >= 1) n++;
    return n;
  }
  hasBuilding(pid, type) { return this.ownedCount(pid, type) > 0; }
  producers(pid, cat) {
    const want = cat === 'building' || cat === 'defense' ? 'hq' : cat === 'infantry' ? 'barracks' : 'factory';
    return this.buildings.filter((b) => b.owner === pid && b.type === want && !b.dead && b.built >= 1);
  }

  // Is this type available for a player to start building?
  canBuild(pid, type) {
    const d = defOf(type);
    const p = this.players[pid];
    if (!d || d.buildable === false) return false;
    const cat = d.cat;
    const prods = this.producers(pid, cat);
    if (!prods.length) return false;
    if (d.faction && d.faction !== p.faction && !prods.some((b) => b.origin === d.faction)) return false;
    if (d.superweapon && this.setup.superweapons === false) return false;
    for (const r of d.req || []) if (!this.hasBuilding(pid, r)) return false;
    if (d.unique) {
      if (this.units.some((u) => u.owner === pid && u.type === type && !u.dead)) return false;
      if (p.queues[cat].some((q) => q.type === type)) return false;
    }
    if (d.superweapon && this.buildings.some((b) => b.owner === pid && b.type === type && !b.dead)) return false;
    return true;
  }
  missingReqs(pid, type) {
    const d = defOf(type);
    const out = [];
    for (const r of d.req || []) if (!this.hasBuilding(pid, r)) out.push(BUILDINGS[r].name);
    return out;
  }

  // ---------- Entity creation ----------
  createUnit(owner, type, x, y) {
    const d = UNITS[type];
    const u = {
      id: this.nextId++, kind: 'unit', type, owner, x, y, px: x, py: y,
      angle: Math.PI / 2, tAngle: Math.PI / 2, hp: d.hp, maxHp: d.hp,
      order: { type: 'idle' }, path: null, pathI: 0, needPath: false, goal: null, goalOff: null,
      cooldown: 0, xp: 0, rank: 0, cargo: 0, target: 0, anchorX: x, anchorY: y,
      scanT: this.rng.next() * 0.5, stuck: 0, progT: 0, progX: x, progY: y, barrel: 0, lastFire: -9, moving: false,
      idleT: 0,
    };
    this.ents.set(u.id, u); this.units.push(u);
    if (d.harvester) u.order = { type: 'harvest', s: 'seek' };
    return u;
  }

  createBuilding(owner, type, tx, ty, instant = false) {
    const d = BUILDINGS[type];
    const b = {
      id: this.nextId++, kind: 'building', type, owner, tx, ty, w: d.w, h: d.h,
      x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE,
      hp: d.hp, maxHp: d.hp, built: instant ? 1 : 0, repairing: false, rally: null,
      cooldown: 0, tAngle: Math.PI / 2, target: 0, primary: false, seen: 0,
      origin: this.players[owner].faction, incomeT: 0, demoT: 0, dockBusy: 0, dockT: 0, scanT: 0, lastFire: -9,
    };
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      const i = this.map.idx(x, y);
      this.map.bld[i] = b.id;
      if (this.map.ore[i]) { this.map.ore[i] = 0; this.map.oreKind[i] = 0; this.map.oreVersion++; }
    }
    this.ents.set(b.id, b); this.buildings.push(b);
    this.powerDirty = true;
    this.map.version++;
    if (d.producer && d.producer !== 'building' && !this.buildings.some((o) => o !== b && o.owner === owner && o.type === type && o.primary && !o.dead)) b.primary = true;
    if (type === 'hq' && !this.buildings.some((o) => o !== b && o.owner === owner && o.type === 'hq' && o.primary && !o.dead)) b.primary = true;
    return b;
  }

  removeEntity(e) {
    e.dead = true;
    if (e.kind === 'building') {
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) {
        const i = this.map.idx(x, y);
        if (this.map.bld[i] === e.id) this.map.bld[i] = 0;
      }
      this.powerDirty = true;
      this.map.version++;
      if (e.primary) {
        const next = this.buildings.find((o) => o !== e && !o.dead && o.owner === e.owner && o.type === e.type);
        if (next) next.primary = true;
      }
    }
  }

  // ---------- Placement ----------
  footprintClear(tx, ty, w, h, ignoreUnitId = 0) {
    const m = this.map;
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (!m.inb(x, y)) return false;
      const i = m.idx(x, y);
      if (m.terrain[i] === T.WATER || m.terrain[i] === T.ROCK || m.terrain[i] === T.TREE || m.terrain[i] === T.SPIRE) return false;
      if (m.bld[i]) return false;
    }
    const x0 = tx * TILE, y0 = ty * TILE, x1 = (tx + w) * TILE, y1 = (ty + h) * TILE;
    for (const u of this.unitsInRect(x0 - 4, y0 - 4, x1 + 4, y1 + 4)) if (u.id !== ignoreUnitId) return false;
    for (const c of this.crates) if (c.x >= tx && c.x < tx + w && c.y >= ty && c.y < ty + h) return false;
    return true;
  }
  tileStatus(pid, type, tx, ty) {
    // per-tile validity for UI ghost
    const d = BUILDINGS[type];
    const out = [];
    const near = this.nearBase(pid, tx, ty, d.w, d.h);
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) out.push(near && this.footprintClear(x, y, 1, 1));
    return out;
  }
  nearBase(pid, tx, ty, w, h, range = 3) {
    for (const b of this.buildings) {
      if (b.dead || b.owner !== pid || BUILDINGS[b.type].wall) continue;
      const gx = Math.max(b.tx - (tx + w), tx - (b.tx + b.w), 0);
      const gy = Math.max(b.ty - (ty + h), ty - (b.ty + b.h), 0);
      if (gx <= range && gy <= range) return true;
    }
    return false;
  }
  canPlace(pid, type, tx, ty) {
    const d = BUILDINGS[type];
    return this.footprintClear(tx, ty, d.w, d.h) && this.nearBase(pid, tx, ty, d.w, d.h);
  }

  // ---------- Commands (all player input goes through here) ----------
  command(pid, c) {
    const p = this.players[pid];
    if (!p || p.defeated || this.over) return false;
    const myUnits = () => (c.ids || []).map((id) => this.get(id)).filter((u) => u && u.kind === 'unit' && u.owner === pid);
    switch (c.type) {
      case 'move': return this.orderGroup(myUnits(), 'move', c.x, c.y);
      case 'attackmove': return this.orderGroup(myUnits(), 'attackmove', c.x, c.y);
      case 'attack': {
        const t = this.get(c.target);
        if (!t) return false;
        for (const u of myUnits()) {
          const d = UNITS[u.type];
          if (d.engineer && t.kind === 'building') this.setOrder(u, { type: 'capture', target: t.id });
          else if (d.demo && t.kind === 'building' && t.owner !== pid) this.setOrder(u, { type: 'demo', target: t.id });
          else if (d.weapon) this.setOrder(u, { type: 'attack', target: t.id, forced: true });
        }
        return true;
      }
      case 'stop': for (const u of myUnits()) { this.setOrder(u, UNITS[u.type].harvester ? { type: 'idleHarv' } : { type: 'idle' }); } return true;
      case 'guard': for (const u of myUnits()) this.setOrder(u, { type: 'guard', x: u.x, y: u.y }); return true;
      case 'scatter': {
        for (const u of myUnits()) {
          const a = this.rng.next() * Math.PI * 2;
          const t = this.pf.nearestPassable(tileOf(u.x + Math.cos(a) * TILE * 2.5), tileOf(u.y + Math.sin(a) * TILE * 2.5), 3);
          if (t) this.setOrder(u, { type: 'move', tx: t[0], ty: t[1] });
        }
        return true;
      }
      case 'deploy': {
        let ok = false;
        for (const u of myUnits()) if (UNITS[u.type].deploysTo) ok = this.deploy(u) || ok;
        for (const id of c.ids || []) {
          const b = this.get(id);
          if (b && b.kind === 'building' && b.owner === pid && BUILDINGS[b.type].undeploysTo && b.built >= 1) ok = this.undeploy(b) || ok;
        }
        return ok;
      }
      case 'harvest': {
        for (const u of myUnits()) if (UNITS[u.type].harvester) this.setOrder(u, { type: 'harvest', s: 'seek', prefX: c.tx, prefY: c.ty });
        return true;
      }
      case 'dock': {
        const r = this.get(c.target);
        for (const u of myUnits()) if (UNITS[u.type].harvester) this.setOrder(u, { type: 'harvest', s: 'return', ref: r ? r.id : 0 });
        return true;
      }
      case 'repairAt': {
        const b = this.get(c.target);
        if (!b) return false;
        for (const u of myUnits()) if (UNITS[u.type].cat === 'vehicle') this.setOrder(u, { type: 'repairAt', target: b.id });
        return true;
      }
      case 'queue': return this.enqueue(pid, c.item, c.count || 1);
      case 'cancel': return this.cancel(pid, c.item);
      case 'pause': return this.pauseItem(pid, c.item);
      case 'place': return this.place(pid, c.cat, c.item, c.tx, c.ty);
      case 'cancelPlace': {
        const d = BUILDINGS[p.ready[c.cat]];
        if (!d) return false;
        if (!(c.cat === 'defense' && p.wallCharge)) p.credits += d.cost;
        p.ready[c.cat] = null; p.wallCharge = false;
        return true;
      }
      case 'sell': {
        const b = this.get(c.target);
        if (!b || b.kind !== 'building' || b.owner !== pid || b.built < 1) return false;
        const d = BUILDINGS[b.type];
        p.credits += Math.floor(d.cost * 0.5 * (b.hp / b.maxHp));
        this.emit({ t: 'sold', p: pid, x: b.x, y: b.y });
        if (!d.wall && d.w * d.h >= 4) this.spawnSurvivors(b, 1 + (d.w * d.h >= 9 ? 1 : 0));
        this.removeEntity(b);
        return true;
      }
      case 'repair': {
        const b = this.get(c.target);
        if (!b || b.kind !== 'building' || b.owner !== pid) return false;
        b.repairing = c.on ?? !b.repairing;
        if (b.hp >= b.maxHp) b.repairing = false;
        return true;
      }
      case 'rally': {
        const b = this.get(c.target);
        if (!b || b.owner !== pid || b.kind !== 'building') return false;
        b.rally = { x: c.x, y: c.y };
        return true;
      }
      case 'primary': {
        const b = this.get(c.target);
        if (!b || b.owner !== pid) return false;
        for (const o of this.buildings) if (o.owner === pid && o.type === b.type) o.primary = false;
        b.primary = true;
        return true;
      }
      case 'superweapon': return this.fireSuperweapon(pid, c.x, c.y);
    }
    return false;
  }

  setOrder(u, o) {
    u.order = o; u.path = null; u.pathI = 0; u.needPath = false; u.target = o.target || 0;
    u.stuck = 0; u.progT = 0; u.progX = u.x; u.progY = u.y; u.goalOff = null; u.idleT = 0;
    if (o.type === 'move' || o.type === 'attackmove') { this.requestPath(u, o.tx, o.ty); u.goalOff = o.off || null; }
    if (o.type === 'idle') { u.anchorX = u.x; u.anchorY = u.y; }
    if (o.type === 'guard') { u.anchorX = o.x; u.anchorY = o.y; }
  }

  orderGroup(units, type, x, y) {
    if (!units.length) return false;
    const tx = clamp(tileOf(x), 0, this.map.w - 1), ty = clamp(tileOf(y), 0, this.map.h - 1);
    // Harvesters ordered onto crystal go harvest there.
    const i = this.map.idx(tx, ty);
    const slots = this.formationSlots(tx, ty, units.length);
    const sorted = units.slice().sort((a, b) => dist(a.x, a.y, x, y) - dist(b.x, b.y, x, y));
    const used = new Set();
    for (const u of sorted) {
      if (UNITS[u.type].harvester && this.map.ore[i] && type === 'move') { this.setOrder(u, { type: 'harvest', s: 'seek', prefX: tx, prefY: ty }); continue; }
      let best = -1, bd = 1e18;
      for (let k = 0; k < slots.length; k++) {
        if (used.has(k)) continue;
        const sx = (slots[k][0] + 0.5) * TILE, sy = (slots[k][1] + 0.5) * TILE;
        const d = (sx - u.x) ** 2 + (sy - u.y) ** 2 + ((slots[k][0] - tx) ** 2 + (slots[k][1] - ty) ** 2) * TILE * TILE * 4;
        if (d < bd) { bd = d; best = k; }
      }
      let s = [tx, ty];
      if (best >= 0) { used.add(best); s = slots[best]; }
      const off = UNITS[u.type].cat === 'infantry' ? { x: (this.rng.next() - 0.5) * 14, y: (this.rng.next() - 0.5) * 14 } : null;
      this.setOrder(u, { type, tx: s[0], ty: s[1], off });
    }
    return true;
  }

  formationSlots(tx, ty, n) {
    const m = this.map;
    const start = this.pf.nearestPassable(tx, ty, 12);
    if (!start) return [[tx, ty]];
    const out = [], seen = new Set([start[1] * m.w + start[0]]);
    const q = [start];
    while (q.length && out.length < n) {
      const [x, y] = q.shift();
      out.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        const k = ny * m.w + nx;
        if (!seen.has(k) && m.passable(nx, ny)) { seen.add(k); q.push([nx, ny]); }
      }
    }
    return out;
  }

  // ---------- Production ----------
  enqueue(pid, type, count = 1) {
    const d = defOf(type);
    const p = this.players[pid];
    if (!d || !this.canBuild(pid, type)) return false;
    const q = p.queues[d.cat];
    if (d.cat === 'building' || d.cat === 'defense') {
      if (q.length || p.ready[d.cat]) return false;
      q.push({ type, progress: 0, paid: 0, paused: false });
      return true;
    }
    let added = 0;
    for (let k = 0; k < count; k++) {
      if (q.length >= 20) break;
      if (d.unique && k > 0) break;
      q.push({ type, progress: 0, paid: 0, paused: false });
      added++;
    }
    return added > 0;
  }
  cancel(pid, type) {
    const p = this.players[pid];
    const d = defOf(type);
    if (!d) return false;
    const cat = d.cat;
    if (p.ready[cat] === type) {
      if (!(type === 'wall' && p.wallCharge)) p.credits += d.cost;
      p.ready[cat] = null; p.wallCharge = false;
      return true;
    }
    const q = p.queues[cat];
    for (let k = q.length - 1; k >= 0; k--) {
      if (q[k].type === type) {
        p.credits += q[k].paid;
        p.stats.spent -= q[k].paid;
        q.splice(k, 1);
        return true;
      }
    }
    return false;
  }
  pauseItem(pid, type) {
    const p = this.players[pid];
    const d = defOf(type);
    if (!d) return false;
    const it = p.queues[d.cat].find((q) => q.type === type);
    if (!it) return false;
    it.paused = !it.paused;
    return true;
  }
  place(pid, cat, type, tx, ty) {
    const p = this.players[pid];
    if (p.ready[cat] !== type) return false;
    if (!this.canPlace(pid, type, tx, ty)) return false;
    const d = BUILDINGS[type];
    if (d.wall && p.wallCharge) {
      if (p.credits < d.cost) { this.emit({ t: 'funds', p: pid }); return false; }
      p.credits -= d.cost; p.stats.spent += d.cost;
    }
    const b = this.createBuilding(pid, type, tx, ty);
    p.stats.bldBuilt++;
    this.emit({ t: 'placed', p: pid, x: b.x, y: b.y, id: b.id });
    if (d.wall) p.wallCharge = true;
    else p.ready[cat] = null;
    if (d.superweapon) for (const o of this.players) if (o.id !== pid && !o.neutral) this.emit({ t: 'sw_detected', p: o.id, sw: d.superweapon });
    return b;
  }

  updateProduction(p) {
    for (const cat of CATS) {
      const q = p.queues[cat];
      if (!q.length) continue;
      if ((cat === 'building' || cat === 'defense') && p.ready[cat]) continue;
      const it = q[0];
      if (it.paused) continue;
      const prods = this.producers(p.id, cat);
      if (!prods.length) continue;
      const d = defOf(it.type);
      if (!this.canBuildIgnoringQueue(p.id, it.type)) {
        // Lost prerequisites: refund and drop.
        p.credits += it.paid; q.shift(); continue;
      }
      let rate = (1 + 0.5 * (prods.length - 1)) / Math.max(0.5, d.time);
      if (p.lowPower) rate *= 0.5;
      if (p.ai) rate *= DIFFICULTY[p.difficulty]?.income >= 1.3 ? 1.15 : 1;
      let dp = Math.min(rate * DT, 1 - it.progress);
      const step = d.cost * dp;
      if (p.credits < step) {
        if (this.time - p.fundsT > 8) { p.fundsT = this.time; this.emit({ t: 'funds', p: p.id }); }
        continue;
      }
      p.credits -= step; it.paid += step; it.progress += dp; p.stats.spent += step;
      if (it.progress >= 1 - 1e-6) {
        q.shift();
        if (cat === 'building' || cat === 'defense') {
          p.ready[cat] = it.type; p.wallCharge = false;
          this.emit({ t: 'ready', p: p.id, cat, item: it.type });
        } else {
          const u = this.spawnFromProducer(p.id, it.type);
          if (u) { p.stats.unitsBuilt++; this.emit({ t: 'unit_ready', p: p.id, item: it.type, id: u.id }); }
        }
      }
    }
  }
  canBuildIgnoringQueue(pid, type) {
    const d = defOf(type);
    const prods = this.producers(pid, d.cat);
    if (!prods.length) return false;
    for (const r of d.req || []) if (!this.hasBuilding(pid, r)) return false;
    return true;
  }

  spawnFromProducer(pid, type) {
    const d = UNITS[type];
    const prods = this.producers(pid, d.cat);
    if (!prods.length) return null;
    const b = prods.find((o) => o.primary) || prods[0];
    const ex = b.tx + Math.floor(b.w / 2), ey = b.ty + b.h;
    const t = this.pf.nearestPassable(ex, ey, 8) || [ex, ey];
    const u = this.createUnit(pid, type, (t[0] + 0.5) * TILE, (t[1] + 0.5) * TILE);
    u.angle = u.tAngle = Math.PI / 2;
    if (d.harvester) return u;
    if (b.rally) this.setOrder(u, { type: 'move', tx: tileOf(b.rally.x), ty: tileOf(b.rally.y), off: d.cat === 'infantry' ? { x: (this.rng.next() - 0.5) * 16, y: (this.rng.next() - 0.5) * 16 } : null });
    else {
      const s = this.formationSlots(t[0], t[1] + 2, 1 + this.rng.int(6));
      const pick = s[s.length - 1];
      this.setOrder(u, { type: 'move', tx: pick[0], ty: pick[1] });
    }
    return u;
  }

  spawnSurvivors(b, n) {
    for (let k = 0; k < n; k++) {
      const t = this.pf.nearestPassable(b.tx + this.rng.int(b.w), b.ty + b.h, 4);
      if (!t) continue;
      const u = this.createUnit(b.owner, 'rifle', (t[0] + 0.5) * TILE, (t[1] + 0.5) * TILE);
      this.setOrder(u, { type: 'idle' });
    }
  }

  deploy(u) {
    const tx = tileOf(u.x) - 1, ty = tileOf(u.y) - 1;
    if (!this.footprintClear(tx, ty, 3, 3, u.id)) { this.emit({ t: 'cant_deploy', p: u.owner, x: u.x, y: u.y }); return false; }
    this.removeEntity(u);
    const b = this.createBuilding(u.owner, 'hq', tx, ty);
    b.hp = Math.max(1, Math.round(b.maxHp * (u.hp / u.maxHp)));
    this.emit({ t: 'placed', p: u.owner, x: b.x, y: b.y, id: b.id, deploy: true });
    return true;
  }
  undeploy(b) {
    const p = this.players[b.owner];
    if (this.producers(b.owner, 'building').length <= 1) {
      for (const cat of ['building', 'defense']) {
        for (const it of p.queues[cat]) p.credits += it.paid;
        p.queues[cat] = [];
        if (p.ready[cat]) { p.credits += BUILDINGS[p.ready[cat]].cost; p.ready[cat] = null; }
      }
    }
    const x = b.x, y = b.y;
    const hpFrac = b.hp / b.maxHp;
    this.removeEntity(b);
    const u = this.createUnit(b.owner, 'crawler', x, y);
    u.hp = Math.max(1, Math.round(u.maxHp * hpFrac));
    this.emit({ t: 'undeploy', p: b.owner, x, y, id: u.id });
    return true;
  }

  // ---------- Superweapons ----------
  fireSuperweapon(pid, x, y) {
    const p = this.players[pid];
    if (!p.sw.ready) return false;
    const b = this.buildings.find((o) => o.owner === pid && BUILDINGS[o.type].superweapon && !o.dead && o.built >= 1);
    if (!b) return false;
    const kind = BUILDINGS[b.type].superweapon;
    p.sw.ready = false; p.sw.charge = 0;
    const delay = kind === 'orbital' ? 2.5 : 4.5;
    this.strikes.push({ kind, x, y, sx: b.x, sy: b.y - 20, t: 0, delay, owner: pid });
    for (const o of this.players) if (!o.neutral) this.emit({ t: 'sw_launch', p: o.id, kind, x, y, own: o.id === pid });
    this.emit({ t: 'fx', kind: kind === 'orbital' ? 'orbital_charge' : 'launch', x, y, sx: b.x, sy: b.y, dur: delay });
    return true;
  }

  updateStrikes() {
    for (let k = this.strikes.length - 1; k >= 0; k--) {
      const s = this.strikes[k];
      s.t += DT;
      if (s.t >= s.delay) {
        this.strikes.splice(k, 1);
        const r = s.kind === 'orbital' ? 3.2 : 3.8;
        const dmg = s.kind === 'orbital' ? 1700 : 2100;
        this.areaDamage(s.x, s.y, r, dmg, 'super', 0, s.owner, true);
        this.emit({ t: 'fx', kind: s.kind === 'orbital' ? 'orbital' : 'nuke', x: s.x, y: s.y, r });
        this.emit({ t: 'snd', snd: 'superblast', x: s.x, y: s.y });
      }
    }
  }

  // ---------- Damage ----------
  damage(t, amount, wh, attackerId, attackerOwner) {
    if (!t || t.dead) return;
    const armor = t.kind === 'unit' ? UNITS[t.type].armor : 'bld';
    let mult = WARHEADS[wh][armor];
    if (t.kind === 'unit') mult *= RANKS[t.rank].armor;
    const dmg = amount * mult;
    if (dmg <= 0) return;
    t.hp -= dmg;
    t.hitT = this.time;
    const owner = this.players[t.owner];
    if (attackerOwner != null && this.isEnemy(attackerOwner, t.owner) && !owner.neutral) {
      owner.lastAttack = { x: t.x, y: t.y, t: this.time, by: attackerId };
      const isHarv = t.kind === 'unit' && UNITS[t.type].harvester;
      if (isHarv && this.time - owner.harvAlertT > 15) { owner.harvAlertT = this.time; this.emit({ t: 'harv_attack', p: t.owner, x: t.x, y: t.y }); }
      else if (t.kind === 'building' && this.time - owner.alertT > 15) { owner.alertT = this.time; this.emit({ t: 'base_attack', p: t.owner, x: t.x, y: t.y }); }
      // Retaliation for idle armed units.
      if (t.kind === 'unit' && attackerId && (t.order.type === 'idle' || t.order.type === 'guard') && UNITS[t.type].weapon) {
        const a = this.get(attackerId);
        if (a && this.canTarget(t, a)) { t.target = a.id; }
      }
    }
    if (t.hp <= 0) this.kill(t, attackerId, attackerOwner);
  }

  kill(t, attackerId, attackerOwner) {
    if (t.dead) return;
    t.hp = 0;
    const owner = this.players[t.owner];
    const atk = this.players[attackerOwner];
    if (t.kind === 'unit') {
      const d = UNITS[t.type];
      owner.stats.unitsLost++;
      if (atk && atk.id !== t.owner) atk.stats.unitsKilled++;
      this.emit({ t: 'fx', kind: d.cat === 'infantry' ? 'die_inf' : 'explode', x: t.x, y: t.y, size: d.cat === 'infantry' ? 0.4 : unitRadius(t.type) / 12 });
      this.emit({ t: 'unit_lost', p: t.owner, x: t.x, y: t.y, item: t.type, inf: d.cat === 'infantry' });
      if (d.harvester) this.releaseDock(t);
    } else {
      const d = BUILDINGS[t.type];
      owner.stats.bldLost++;
      if (atk && atk.id !== t.owner) atk.stats.bldKilled++;
      this.emit({ t: 'fx', kind: 'bld_explode', x: t.x, y: t.y, w: t.w, h: t.h });
      this.emit({ t: 'bld_lost', p: t.owner, x: t.x, y: t.y, item: t.type });
      if (!d.wall && d.w * d.h >= 4 && !owner.neutral && this.rng.chance(0.6)) this.spawnSurvivors(t, 1 + this.rng.int(2));
    }
    // Veterancy
    const a = this.get(attackerId);
    if (a && a.kind === 'unit' && a.owner !== t.owner) {
      const val = t.kind === 'unit' ? UNITS[t.type].cost : BUILDINGS[t.type].cost * 0.4;
      a.xp += val;
      const own = Math.max(250, UNITS[a.type].cost);
      const newRank = a.xp >= own * 3 ? 2 : a.xp >= own ? 1 : 0;
      if (newRank > a.rank) { a.rank = newRank; this.emit({ t: 'promoted', p: a.owner, x: a.x, y: a.y, id: a.id, rank: newRank }); }
    }
    this.removeEntity(t);
  }

  areaDamage(x, y, rTiles, dmg, wh, attackerId, attackerOwner, hitsAll = false) {
    const r = rTiles * TILE;
    for (const u of this.unitsInRect(x - r, y - r, x + r, y + r)) {
      if (!hitsAll && !this.isEnemy(attackerOwner, u.owner) && u.owner !== this.neutralId) continue;
      const d = dist(x, y, u.x, u.y);
      if (d > r) continue;
      this.damage(u, dmg * (1 - (d / r) * 0.5), wh, attackerId, attackerOwner);
    }
    for (const b of this.buildings) {
      if (b.dead) continue;
      if (!hitsAll && !this.isEnemy(attackerOwner, b.owner)) continue;
      const d = this.distToRect(x, y, b);
      if (d > r) continue;
      this.damage(b, dmg * (1 - (d / r) * 0.5), wh, attackerId, attackerOwner);
    }
    if (wh === 'super' || wh === 'he') {
      // scorch crystal slightly? leave terrain intact
    }
  }

  distToRect(x, y, b) {
    const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = (b.tx + b.w) * TILE, y1 = (b.ty + b.h) * TILE;
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
    return Math.hypot(dx, dy);
  }
  distTo(e, t) {
    if (t.kind === 'building') return this.distToRect(e.x, e.y, t);
    return dist(e.x, e.y, t.x, t.y);
  }
  aimPoint(e, t) {
    if (t.kind === 'unit') return [t.x, t.y];
    const x0 = t.tx * TILE + 6, y0 = t.ty * TILE + 6, x1 = (t.tx + t.w) * TILE - 6, y1 = (t.ty + t.h) * TILE - 6;
    return [clamp(e.x, x0, x1), clamp(e.y, y0, y1)];
  }

  weaponOf(e) { return (e.kind === 'unit' ? UNITS[e.type] : BUILDINGS[e.type]).weapon || null; }

  canTarget(e, t) {
    if (!t || t.dead) return false;
    const w = this.weaponOf(e);
    if (!w) return false;
    const armor = t.kind === 'unit' ? UNITS[t.type].armor : 'bld';
    if (WARHEADS[w.wh][armor] <= 0) return false;
    if (t.kind === 'building' && this.players[t.owner].neutral) return false;
    if (!this.isEnemy(e.owner, t.owner)) return false;
    return this.entVisibleTo(e.owner, t);
  }

  inRange(e, t, w) {
    const r = this.distTo(e, t) / TILE;
    if (w.minRange && r < w.minRange) return false;
    return r <= w.range + (t.kind === 'building' ? 0.2 : 0);
  }

  acquire(e, rangeTiles, preferInf = false) {
    const w = this.weaponOf(e);
    if (!w) return null;
    const r = rangeTiles * TILE;
    let best = null, bs = 1e18;
    for (const u of this.unitsInRect(e.x - r, e.y - r, e.x + r, e.y + r)) {
      if (!this.isEnemy(e.owner, u.owner)) continue;
      const d = dist(e.x, e.y, u.x, u.y);
      if (d > r) continue;
      if (w.minRange && d / TILE < w.minRange) continue;
      if (!this.canTarget(e, u)) continue;
      const ud = UNITS[u.type];
      let s = d;
      if (!ud.weapon) s += TILE * 3;
      if (preferInf && ud.armor === 'inf') s -= TILE * 3;
      const mult = WARHEADS[w.wh][ud.armor];
      s -= mult * TILE * 2;
      if (s < bs) { bs = s; best = u; }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (b.dead || !this.isEnemy(e.owner, b.owner)) continue;
      if (BUILDINGS[b.type].wall) continue;
      const d = this.distToRect(e.x, e.y, b);
      if (d > r) continue;
      if (w.minRange && d / TILE < w.minRange) continue;
      if (!this.canTarget(e, b)) continue;
      const s = d + (BUILDINGS[b.type].weapon ? -TILE : TILE);
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  }

  fire(e, t, w) {
    const isUnit = e.kind === 'unit';
    const rank = isUnit ? RANKS[e.rank] : RANKS[0];
    const dmg = w.dmg * rank.dmg;
    e.cooldown = w.rof * rank.rof;
    e.lastFire = this.time;
    const ang = w.proj === 'arty' && !isUnit ? e.tAngle : (isUnit && !UNITS[e.type].turret ? e.angle : e.tAngle);
    const rad = isUnit ? unitRadius(e.type) + 4 : 14;
    let sx = e.x + Math.cos(ang) * rad, sy = e.y + Math.sin(ang) * rad;
    if (w.barrels === 2) {
      e.barrel = (e.barrel + 1) % 2;
      const o = e.barrel ? 4 : -4;
      sx += Math.cos(ang + Math.PI / 2) * o; sy += Math.sin(ang + Math.PI / 2) * o;
    }
    const [tx, ty] = this.aimPoint(e, t);
    this.emit({ t: 'snd', snd: w.snd, x: sx, y: sy });
    switch (w.proj) {
      case 'bullet': case 'tracer':
        this.emit({ t: 'fx', kind: w.proj, x: sx, y: sy, tx, ty });
        this.damage(t, dmg, w.wh, e.id, e.owner);
        break;
      case 'flame':
        this.emit({ t: 'fx', kind: 'flame', x: sx, y: sy, tx, ty });
        this.damage(t, dmg, w.wh, e.id, e.owner);
        if (w.splash) this.areaDamageExcept(tx, ty, w.splash, dmg * 0.5, w.wh, e, t);
        break;
      case 'beam': {
        this.emit({ t: 'fx', kind: 'beam', x: sx, y: sy, tx, ty, color: this.players[e.owner].color });
        this.damage(t, dmg, w.wh, e.id, e.owner);
        let from = [tx, ty], hit = new Set([t.id]);
        for (let c = 0; c < (w.chain || 0); c++) {
          let nb = null, nd = 1e9;
          for (const u of this.unitsInRect(from[0] - 96, from[1] - 96, from[0] + 96, from[1] + 96)) {
            if (hit.has(u.id) || !this.isEnemy(e.owner, u.owner)) continue;
            const d = dist(from[0], from[1], u.x, u.y);
            if (d < nd && d < 3 * TILE) { nd = d; nb = u; }
          }
          if (!nb) break;
          hit.add(nb.id);
          this.emit({ t: 'fx', kind: 'beam', x: from[0], y: from[1], tx: nb.x, ty: nb.y, color: this.players[e.owner].color, thin: true });
          this.damage(nb, dmg * 0.6, w.wh, e.id, e.owner);
          from = [nb.x, nb.y];
        }
        break;
      }
      default: {
        let ax = tx, ay = ty;
        if (w.proj === 'arty') { ax += (this.rng.next() - 0.5) * TILE * 0.8; ay += (this.rng.next() - 0.5) * TILE * 0.8; }
        const speed = w.proj === 'shell' ? 16 : w.proj === 'rocket' ? 10 : 6.5;
        const d = dist(sx, sy, ax, ay);
        this.projectiles.push({
          kind: w.proj, sx, sy, x: sx, y: sy, tx: ax, ty: ay, target: w.proj === 'arty' ? 0 : t.id,
          t: 0, dur: Math.max(0.08, d / (speed * TILE)), dmg, wh: w.wh, splash: w.splash || 0,
          owner: e.owner, src: e.id,
        });
        if (w.proj !== 'arty') this.emit({ t: 'fx', kind: 'muzzle', x: sx, y: sy, a: ang });
        else this.emit({ t: 'fx', kind: 'muzzle_big', x: sx, y: sy, a: ang });
      }
    }
  }

  areaDamageExcept(x, y, rTiles, dmg, wh, src, except) {
    const r = rTiles * TILE;
    for (const u of this.unitsInRect(x - r, y - r, x + r, y + r)) {
      if (u === except || !this.isEnemy(src.owner, u.owner)) continue;
      if (dist(x, y, u.x, u.y) <= r) this.damage(u, dmg, wh, src.id, src.owner);
    }
  }

  updateProjectiles() {
    for (let k = this.projectiles.length - 1; k >= 0; k--) {
      const pr = this.projectiles[k];
      const tg = pr.target ? this.get(pr.target) : null;
      if (tg && pr.kind === 'rocket') {
        const [ax, ay] = tg.kind === 'unit' ? [tg.x, tg.y] : [pr.tx, pr.ty];
        pr.tx = ax; pr.ty = ay;
      }
      pr.t += DT;
      const f = Math.min(1, pr.t / pr.dur);
      pr.px = pr.x; pr.py = pr.y;
      pr.x = pr.sx + (pr.tx - pr.sx) * f;
      pr.y = pr.sy + (pr.ty - pr.sy) * f;
      if (f >= 1) {
        this.projectiles.splice(k, 1);
        if (pr.splash) {
          this.areaDamage(pr.tx, pr.ty, pr.splash, pr.dmg, pr.wh, pr.src, pr.owner);
          this.emit({ t: 'fx', kind: 'blast', x: pr.tx, y: pr.ty, size: pr.splash });
        } else {
          if (tg && dist(tg.x, tg.y, pr.tx, pr.ty) < 40 + (tg.kind === 'building' ? tg.w * TILE : 0)) this.damage(tg, pr.dmg, pr.wh, pr.src, pr.owner);
          this.emit({ t: 'fx', kind: pr.kind === 'rocket' ? 'hit_rocket' : 'hit_shell', x: pr.tx, y: pr.ty });
        }
      }
    }
  }

  // ---------- Spatial hash ----------
  rebuildSpatial() {
    for (const c of this.cells) c.length = 0;
    for (const u of this.units) {
      if (u.dead) continue;
      const cx = clamp(Math.floor(u.x / TILE / CELL), 0, this.cw - 1), cy = clamp(Math.floor(u.y / TILE / CELL), 0, this.ch - 1);
      this.cells[cy * this.cw + cx].push(u);
    }
  }
  unitsInRect(x0, y0, x1, y1) {
    const out = [];
    const cx0 = clamp(Math.floor(x0 / TILE / CELL), 0, this.cw - 1), cx1 = clamp(Math.floor(x1 / TILE / CELL), 0, this.cw - 1);
    const cy0 = clamp(Math.floor(y0 / TILE / CELL), 0, this.ch - 1), cy1 = clamp(Math.floor(y1 / TILE / CELL), 0, this.ch - 1);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (const u of this.cells[cy * this.cw + cx]) if (!u.dead && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) out.push(u);
    }
    return out;
  }

  // ---------- Movement ----------
  requestPath(u, tx, ty) {
    u.goal = { x: clamp(tx, 0, this.map.w - 1), y: clamp(ty, 0, this.map.h - 1) };
    u.needPath = true; u.path = null; u.pathI = 0;
  }

  // returns 'arrived' | 'moving'
  stepMove(u) {
    if (u.needPath) {
      if (this.pathBudget <= 0) return 'moving';
      this.pathBudget--;
      u.needPath = false;
      u.path = this.pf.find(tileOf(u.x), tileOf(u.y), u.goal.x, u.goal.y, 5000) || [];
      u.pathI = 0;
      u.progT = 0; u.progX = u.x; u.progY = u.y;
    }
    const d = UNITS[u.type];
    if (!u.path) { u.moving = false; return 'arrived'; }
    if (u.pathI >= u.path.length) {
      // final nudge to sub-tile offset
      u.moving = false;
      return 'arrived';
    }
    const [tx, ty] = u.path[u.pathI];
    if (!this.map.passable(tx, ty)) { if (u.goal) { u.needPath = true; return 'moving'; } return 'arrived'; }
    const last = u.pathI === u.path.length - 1;
    let wx = (tx + 0.5) * TILE, wy = (ty + 0.5) * TILE;
    if (last && u.goalOff) { wx += u.goalOff.x; wy += u.goalOff.y; }
    const dx = wx - u.x, dy = wy - u.y;
    const dd = Math.hypot(dx, dy);
    u.moving = true;
    if (dd < 0.5) { u.pathI++; return 'moving'; }
    const desired = Math.atan2(dy, dx);
    if (d.cat === 'vehicle') {
      u.angle = rotateTowards(u.angle, desired, (d.turn || 4) * DT);
      if (Math.abs(angleDiff(u.angle, desired)) > 0.7) return 'moving';
    } else u.angle = desired;
    let speed = d.speed * TILE * DT;
    if (u.hp < u.maxHp * 0.3 && d.cat === 'vehicle') speed *= 0.8;
    if (dd <= speed) { u.x = wx; u.y = wy; u.pathI++; }
    else { u.x += (dx / dd) * speed; u.y += (dy / dd) * speed; }
    // stuck detection
    u.progT += DT;
    if (u.progT > 1.5) {
      const moved = dist(u.x, u.y, u.progX, u.progY);
      u.progT = 0; u.progX = u.x; u.progY = u.y;
      if (moved < TILE * 0.35) {
        u.stuck++;
        const gd = u.goal ? Math.hypot(u.goal.x - tileOf(u.x), u.goal.y - tileOf(u.y)) : 0;
        if (u.stuck >= 3 || gd <= 1.5) { u.path = null; u.moving = false; return 'arrived'; }
        if (u.goal) u.needPath = true;
      } else u.stuck = 0;
    }
    return 'moving';
  }

  moveToward(u, x, y) {
    const tx = tileOf(x), ty = tileOf(y);
    if (!u.goal || u.goal.x !== tx || u.goal.y !== ty || (!u.path && !u.needPath)) this.requestPath(u, tx, ty);
    return this.stepMove(u);
  }

  // Aim turret/body; returns true if aligned to fire.
  aim(e, t) {
    const [ax, ay] = this.aimPoint(e, t);
    const want = Math.atan2(ay - e.y, ax - e.x);
    if (e.kind === 'building') {
      e.tAngle = rotateTowards(e.tAngle, want, 5 * DT);
      return Math.abs(angleDiff(e.tAngle, want)) < 0.15;
    }
    const d = UNITS[e.type];
    if (d.cat === 'infantry') { e.angle = want; e.tAngle = want; return true; }
    if (d.turret) {
      e.tAngle = rotateTowards(e.tAngle, want, 6 * DT);
      return Math.abs(angleDiff(e.tAngle, want)) < 0.15;
    }
    e.angle = rotateTowards(e.angle, want, (d.turn || 3) * DT);
    e.tAngle = e.angle;
    return Math.abs(angleDiff(e.angle, want)) < 0.12;
  }

  // Engage a target: chase if out of range, fire when ready. Returns false if target invalid.
  engage(u, t, chase = true) {
    const w = this.weaponOf(u);
    if (!w || !t || t.dead) return false;
    if (!this.isEnemy(u.owner, t.owner) && !(u.order.forced && !this.isAlly(u.owner, t.owner))) return false;
    if (!this.entVisibleTo(u.owner, t)) return false;
    if (this.inRange(u, t, w)) {
      u.path = null; u.needPath = false; u.moving = false;
      if (this.aim(u, t) && u.cooldown <= 0) this.fire(u, t, w);
      return true;
    }
    if (!chase) return true;
    // too close for minRange weapons: back off
    const r = this.distTo(u, t) / TILE;
    if (w.minRange && r < w.minRange) {
      const a = Math.atan2(u.y - t.y, u.x - t.x);
      const bx = u.x + Math.cos(a) * TILE * 3, by = u.y + Math.sin(a) * TILE * 3;
      this.moveToward(u, bx, by);
      return true;
    }
    // re-path periodically as target moves
    const [ax, ay] = this.aimPoint(u, t);
    if (!u.goal || Math.hypot(u.goal.x - tileOf(ax), u.goal.y - tileOf(ay)) > 1.5 || (!u.path && !u.needPath)) this.requestPath(u, tileOf(ax), tileOf(ay));
    this.stepMove(u);
    return true;
  }

  // ---------- Units ----------
  updateUnit(u) {
    if (u.dead) return;
    const d = UNITS[u.type];
    u.px = u.x; u.py = u.y;
    if (u.cooldown > 0) u.cooldown -= DT;
    const rk = RANKS[u.rank];
    if ((rk.heal || d.selfRepair) && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * (rk.heal + (d.selfRepair ? 0.006 : 0)) * DT);
    const o = u.order;
    u.scanT -= DT;
    const scan = u.scanT <= 0;
    if (scan) u.scanT = 0.5;

    switch (o.type) {
      case 'idle':
      case 'guard': {
        u.moving = false;
        let t = u.target ? this.get(u.target) : null;
        if (t && !this.canTarget(u, t)) { t = null; u.target = 0; }
        if (!t && scan && d.weapon) {
          const nt = this.acquire(u, d.weapon.range + (o.type === 'guard' ? 0.5 : 1.5), u.type === 'ranger');
          if (nt) u.target = nt.id, t = nt;
        }
        if (t) {
          const leash = dist(u.x, u.y, u.anchorX, u.anchorY) / TILE;
          if (leash > (o.type === 'guard' ? 3 : 6)) { u.target = 0; this.requestPath(u, tileOf(u.anchorX), tileOf(u.anchorY)); }
          else { this.engage(u, t, true); break; }
        }
        if (u.path || u.needPath) { if (this.stepMove(u) === 'arrived') { u.path = null; } }
        else if (d.harvester) {
          u.idleT += DT;
          if (u.idleT > 3 && o.type === 'idle') this.setOrder(u, { type: 'harvest', s: 'seek' });
        }
        // crawler AI convenience: nothing
        break;
      }
      case 'idleHarv': u.moving = false; break;
      case 'move': {
        // Turreted units shoot while moving
        if (d.weapon && d.turret) this.opportunityFire(u, d, scan);
        if (this.stepMove(u) === 'arrived') { this.setOrder(u, { type: 'idle' }); }
        break;
      }
      case 'attackmove': {
        let t = u.target ? this.get(u.target) : null;
        if (t && !this.canTarget(u, t)) { t = null; u.target = 0; }
        if (!t && scan && d.weapon) { const nt = this.acquire(u, Math.max(d.sight, d.weapon.range + 1)); if (nt) { u.target = nt.id; t = nt; } }
        if (t) { this.engage(u, t, true); u.resumeAM = true; break; }
        if (u.resumeAM) { u.resumeAM = false; this.requestPath(u, o.tx, o.ty); }
        if (this.stepMove(u) === 'arrived') this.setOrder(u, { type: 'idle' });
        break;
      }
      case 'attack': {
        const t = this.get(o.target);
        if (!t || !this.engage(u, t, true)) this.setOrder(u, { type: 'idle' });
        break;
      }
      case 'harvest': this.updateHarvester(u, d, o); break;
      case 'capture': case 'demo': {
        const t = this.get(o.target);
        if (!t || t.kind !== 'building') { this.setOrder(u, { type: 'idle' }); break; }
        if (this.distToRect(u.x, u.y, t) < TILE * 0.9) {
          if (o.type === 'capture') this.engineerAct(u, t);
          else {
            if (!t.demoT) { t.demoT = 4; t.demoBy = u.owner; t.demoSrc = u.id; this.emit({ t: 'demo', p: u.owner, x: t.x, y: t.y }); }
            this.setOrder(u, { type: 'idle' });
          }
          break;
        }
        this.moveAdjacent(u, t);
        break;
      }
      case 'repairAt': {
        const t = this.get(o.target);
        if (!t) { this.setOrder(u, { type: 'idle' }); break; }
        if (this.distToRect(u.x, u.y, t) < TILE * 1.1) {
          u.moving = false;
          if (u.hp >= u.maxHp) this.setOrder(u, { type: 'idle' });
          break;
        }
        this.moveAdjacent(u, t);
        break;
      }
    }

    // Crates
    if (this.crates.length) {
      const tx = tileOf(u.x), ty = tileOf(u.y);
      for (let k = this.crates.length - 1; k >= 0; k--) {
        const c = this.crates[k];
        if (c.x === tx && c.y === ty) { this.crates.splice(k, 1); this.collectCrate(u, c); }
      }
    }
  }

  opportunityFire(u, d, scan) {
    let t = u.target ? this.get(u.target) : null;
    if (t && (!this.canTarget(u, t) || !this.inRange(u, t, d.weapon))) { t = null; u.target = 0; }
    if (!t && scan) { const nt = this.acquire(u, d.weapon.range); if (nt) { u.target = nt.id; t = nt; } }
    if (t) {
      const [ax, ay] = this.aimPoint(u, t);
      const want = Math.atan2(ay - u.y, ax - u.x);
      u.tAngle = rotateTowards(u.tAngle, want, 6 * DT);
      if (Math.abs(angleDiff(u.tAngle, want)) < 0.15 && u.cooldown <= 0) this.fire(u, t, d.weapon);
    } else u.tAngle = rotateTowards(u.tAngle, u.angle, 3 * DT);
  }

  moveAdjacent(u, t) {
    // pick passable tile adjacent to building nearest the unit
    if (!u.goal || !u.adjFor || u.adjFor !== t.id || (!u.path && !u.needPath)) {
      let best = null, bd = 1e9;
      for (let y = t.ty - 1; y <= t.ty + t.h; y++) for (let x = t.tx - 1; x <= t.tx + t.w; x++) {
        if (x >= t.tx && x < t.tx + t.w && y >= t.ty && y < t.ty + t.h) continue;
        if (!this.map.passable(x, y)) continue;
        const dd = (x - tileOf(u.x)) ** 2 + (y - tileOf(u.y)) ** 2;
        if (dd < bd) { bd = dd; best = [x, y]; }
      }
      if (!best) { this.setOrder(u, { type: 'idle' }); return; }
      u.adjFor = t.id;
      this.requestPath(u, best[0], best[1]);
    }
    if (this.stepMove(u) === 'arrived' && this.distToRect(u.x, u.y, t) >= TILE * 1.2) {
      u.adjTries = (u.adjTries || 0) + 1;
      u.adjFor = 0;
      if (u.adjTries > 4) { u.adjTries = 0; this.setOrder(u, { type: 'idle' }); }
    }
  }

  engineerAct(u, b) {
    const bd = BUILDINGS[b.type];
    if (b.owner === u.owner || this.isAlly(u.owner, b.owner)) {
      if (b.hp < b.maxHp) { b.hp = b.maxHp; this.emit({ t: 'eng_repair', p: u.owner, x: b.x, y: b.y }); this.removeEntity(u); }
      else this.setOrder(u, { type: 'idle' });
      return;
    }
    if (bd.wall) { this.setOrder(u, { type: 'idle' }); return; }
    const prev = b.owner;
    b.owner = u.owner; b.repairing = false; b.primary = false; b.rally = null;
    if (BUILDINGS[b.type].superweapon) this.players[prev].sw.charge = 0;
    this.powerDirty = true;
    this.emit({ t: 'captured', p: u.owner, from: prev, x: b.x, y: b.y, item: b.type });
    if (!this.players[prev].neutral) this.emit({ t: 'bld_captured', p: prev, x: b.x, y: b.y });
    if (!this.buildings.some((o) => o !== b && o.owner === u.owner && o.type === b.type && o.primary && !o.dead) && (bd.producer)) b.primary = true;
    this.removeEntity(u);
  }

  // Harvester state machine.
  updateHarvester(u, d, o) {
    const m = this.map;
    const p = this.players[u.owner];
    if (o.s === 'seek') {
      if (u.cargo >= d.capacity) { o.s = 'return'; return; }
      const t = this.findOre(u, o.prefX, o.prefY);
      o.prefX = undefined; o.prefY = undefined;
      if (!t) {
        if (u.cargo > 0) { o.s = 'return'; return; }
        u.moving = false; o.waitT = (o.waitT || 0) + DT;
        if (o.waitT > 4) { o.waitT = 0; }
        return;
      }
      o.ox = t[0]; o.oy = t[1]; o.s = 'goto';
      this.requestPath(u, t[0], t[1]);
      return;
    }
    if (o.s === 'goto') {
      const r = this.stepMove(u);
      if (r === 'arrived') {
        const tx = tileOf(u.x), ty = tileOf(u.y);
        if (m.ore[m.idx(tx, ty)] > 0) { o.s = 'mine'; o.mt = 0; }
        else { o.s = 'seek'; o.prefX = o.ox; o.prefY = o.oy; o.fails = (o.fails || 0) + 1; if (o.fails > 6) { o.fails = 0; o.prefX = undefined; } }
      }
      return;
    }
    if (o.s === 'mine') {
      u.moving = false;
      o.mt += DT;
      u.angle += 0; // stationary
      if (o.mt >= 0.5) {
        o.mt = 0;
        const i = m.idx(tileOf(u.x), tileOf(u.y));
        if (m.ore[i] > 0 && u.cargo < d.capacity) {
          const kind = m.oreKind[i];
          const val = kind === 2 ? 2 : 1;
          const take = Math.min(m.ore[i], 25, Math.ceil((d.capacity - u.cargo) / val));
          m.ore[i] -= take;
          u.cargo = Math.min(d.capacity, u.cargo + take * val);
          u.cargoKind = kind;
          if (m.ore[i] <= 0) { m.ore[i] = 0; m.oreKind[i] = 0; }
          m.oreVersion++;
          this.emit({ t: 'fx', kind: 'mine', x: u.x, y: u.y, ore: kind });
        }
        if (u.cargo >= d.capacity) { o.s = 'return'; }
        else if (m.ore[i] <= 0) { o.s = 'seek'; o.prefX = tileOf(u.x); o.prefY = tileOf(u.y); }
      }
      return;
    }
    if (o.s === 'return') {
      let ref = o.ref ? this.get(o.ref) : null;
      if (!ref || ref.owner !== u.owner || ref.built < 1) {
        ref = this.nearestRefinery(u);
        o.ref = ref ? ref.id : 0;
        if (!ref) { u.moving = false; return; }
      }
      const dx = ref.tx + 1, dy = ref.ty + ref.h;
      const dockX = (dx + 0.5) * TILE, dockY = (dy + 0.5) * TILE;
      if (dist(u.x, u.y, dockX, dockY) < TILE * 0.6) {
        if (ref.dockBusy && ref.dockBusy !== u.id && this.get(ref.dockBusy)) {
          // wait nearby
          u.moving = false;
          return;
        }
        ref.dockBusy = u.id;
        o.s = 'unload'; o.mt = 0;
        u.x = dockX; u.y = dockY;
        return;
      }
      if (!u.goal || u.goal.x !== dx || u.goal.y !== dy || (!u.path && !u.needPath)) {
        if (!m.passable(dx, dy)) { u.moving = false; return; }
        this.requestPath(u, dx, dy);
      }
      const r = this.stepMove(u);
      if (r === 'arrived' && dist(u.x, u.y, dockX, dockY) >= TILE * 0.6) {
        // couldn't reach dock (occupied) — wait and retry
        o.retry = (o.retry || 0) + 1;
        u.path = null; u.goal = null;
        if (o.retry > 20) { o.retry = 0; o.ref = 0; }
      }
      return;
    }
    if (o.s === 'unload') {
      const ref = o.ref ? this.get(o.ref) : null;
      if (!ref) { o.s = 'return'; return; }
      u.moving = false;
      u.angle = rotateTowards(u.angle, -Math.PI / 2, 3 * DT);
      o.mt += DT;
      if (o.mt >= 0.2) {
        o.mt = 0;
        const amt = Math.min(u.cargo, 50);
        u.cargo -= amt;
        const mult = p.ai ? (DIFFICULTY[p.difficulty]?.income ?? 1) : 1;
        const gain = Math.round(amt * mult);
        p.credits += gain; p.stats.harvested += gain;
        ref.dockT = this.time;
        if (u.cargo <= 0) {
          u.cargo = 0; ref.dockBusy = 0; o.s = 'seek';
          o.prefX = o.ox; o.prefY = o.oy;
          // drive off the dock
          const out = this.pf.nearestPassable(ref.tx + 1, ref.ty + ref.h + 2, 3);
          if (out) { u.path = [[out[0], out[1]]]; u.pathI = 0; }
        }
      }
    }
  }
  releaseDock(u) {
    for (const b of this.buildings) if (b.dockBusy === u.id) b.dockBusy = 0;
  }
  nearestRefinery(u) {
    let best = null, bd = 1e18;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== u.owner || !BUILDINGS[b.type].refinery || b.built < 1) continue;
      const d = dist(u.x, u.y, b.x, b.y) + (b.dockBusy && b.dockBusy !== u.id ? TILE * 6 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  findOre(u, px, py) {
    const m = this.map;
    const cx = px ?? tileOf(u.x), cy = py ?? tileOf(u.y);
    // Count other harvesters' claimed tiles to spread them out.
    const claimed = new Set();
    for (const h of this.units) if (h !== u && !h.dead && h.order.type === 'harvest' && h.order.ox != null && (h.order.s === 'goto' || h.order.s === 'mine')) claimed.add(h.order.oy * m.w + h.order.ox);
    let best = null, bd = 1e18;
    const R = px != null ? 6 : Math.max(m.w, m.h);
    for (let r = 0; r <= R; r++) {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (!m.inb(x, y)) continue;
        const i = m.idx(x, y);
        if (!m.ore[i] || m.bld[i]) continue;
        let dd = (x - cx) ** 2 + (y - cy) ** 2;
        if (claimed.has(i)) dd += 30;
        if (m.oreKind[i] === 2) dd -= 4;
        if (dd < bd) { bd = dd; best = [x, y]; }
      }
      if (best && r * r > bd + 30) break;
    }
    if (!best && px != null) return this.findOre(u);
    return best;
  }

  collectCrate(u, c) {
    const p = this.players[u.owner];
    let kind = c.kind;
    if (kind === 'promote' && u.rank >= 2) kind = 'money';
    switch (kind) {
      case 'money': { const amt = 500 + this.rng.int(11) * 100; p.credits += amt; this.emit({ t: 'crate', p: u.owner, kind, amt, x: u.x, y: u.y }); break; }
      case 'heal':
        for (const o of this.unitsInRect(u.x - 160, u.y - 160, u.x + 160, u.y + 160)) if (o.owner === u.owner) o.hp = o.maxHp;
        this.emit({ t: 'crate', p: u.owner, kind, x: u.x, y: u.y }); break;
      case 'promote': u.rank++; u.xp = Math.max(u.xp, Math.max(250, UNITS[u.type].cost) * (u.rank === 2 ? 3 : 1)); this.emit({ t: 'crate', p: u.owner, kind, x: u.x, y: u.y }); this.emit({ t: 'promoted', p: u.owner, x: u.x, y: u.y, id: u.id, rank: u.rank }); break;
      case 'reveal': if (p.vis) for (let i = 0; i < p.vis.length; i++) if (p.vis[i] === 0) p.vis[i] = 1; this.emit({ t: 'crate', p: u.owner, kind, x: u.x, y: u.y }); break;
      case 'unit': {
        const t = this.pf.nearestPassable(c.x + 1, c.y, 3);
        if (t) this.createUnit(u.owner, this.rng.pick(['tank', 'raider', 'artillery']), (t[0] + 0.5) * TILE, (t[1] + 0.5) * TILE);
        this.emit({ t: 'crate', p: u.owner, kind, x: u.x, y: u.y }); break;
      }
    }
  }

  // ---------- Buildings ----------
  updateBuilding(b) {
    if (b.dead) return;
    const d = BUILDINGS[b.type];
    const p = this.players[b.owner];
    if (b.built < 1) { b.built = Math.min(1, b.built + DT / (d.wall ? 0.3 : 1.2)); if (b.built >= 1) { this.powerDirty = true; this.onBuilt(b); } return; }
    if (b.cooldown > 0) b.cooldown -= DT;
    if (b.demoT > 0) {
      b.demoT -= DT;
      if (b.demoT <= 0) { this.emit({ t: 'snd', snd: 'boom_big', x: b.x, y: b.y }); this.kill(b, b.demoSrc, b.demoBy); return; }
    }
    if (b.repairing) {
      if (b.hp >= b.maxHp) b.repairing = false;
      else {
        const amt = b.maxHp * 0.06 * DT;
        const cost = (d.cost * 0.25 * amt) / b.maxHp;
        if (p.credits >= cost) { p.credits -= cost; b.hp = Math.min(b.maxHp, b.hp + amt); }
        else b.repairing = false;
      }
    }
    if (d.weapon && !(d.needsPower && p.lowPower)) {
      b.scanT -= DT;
      let t = b.target ? this.get(b.target) : null;
      if (t && (!this.canTarget(b, t) || !this.inRange(b, t, d.weapon))) { t = null; b.target = 0; }
      if (!t && b.scanT <= 0) { b.scanT = 0.4; const nt = this.acquire(b, d.weapon.range, b.type === 'sentry'); if (nt) { b.target = nt.id; t = nt; } }
      if (t && this.aim(b, t) && b.cooldown <= 0) this.fire(b, t, d.weapon);
    }
    if (d.income && !p.neutral) {
      b.incomeT += DT;
      if (b.incomeT >= d.incomeEvery) { b.incomeT = 0; p.credits += d.income; p.stats.harvested += d.income; this.emit({ t: 'fx', kind: 'income', x: b.x, y: b.y - 20, amt: d.income, p: b.owner }); }
    }
    if (d.depot) {
      b.scanT -= DT;
      if (b.scanT <= 0) {
        b.scanT = 0.25;
        const r = TILE * 1.2;
        for (const u of this.unitsInRect(b.tx * TILE - r, b.ty * TILE - r, (b.tx + b.w) * TILE + r, (b.ty + b.h) * TILE + r)) {
          if (u.owner !== b.owner || UNITS[u.type].cat !== 'vehicle' || u.hp >= u.maxHp || u.moving) continue;
          const amt = u.maxHp * 0.05;
          const cost = (UNITS[u.type].cost * 0.15 * amt) / u.maxHp;
          if (p.credits < cost) continue;
          p.credits -= cost; u.hp = Math.min(u.maxHp, u.hp + amt);
          b.repairFx = this.time; b.repairTarget = u.id;
        }
      }
    }
  }

  onBuilt(b) {
    const d = BUILDINGS[b.type];
    const p = this.players[b.owner];
    if (p.neutral) return;
    this.emit({ t: 'bld_done', p: b.owner, item: b.type, x: b.x, y: b.y });
    if (d.refinery) {
      const t = this.pf.nearestPassable(b.tx + 1, b.ty + b.h + 1, 5);
      if (t) {
        const u = this.createUnit(b.owner, 'harvester', (t[0] + 0.5) * TILE, (t[1] + 0.5) * TILE);
        this.emit({ t: 'unit_ready', p: b.owner, item: 'harvester', id: u.id, free: true });
      }
    }
  }

  // ---------- Players ----------
  updatePower() {
    for (const p of this.players) { p.powerProd = 0; p.powerUse = 0; }
    for (const b of this.buildings) {
      if (b.dead) continue;
      const d = BUILDINGS[b.type];
      const p = this.players[b.owner];
      if (d.power > 0 && b.built >= 1) p.powerProd += d.power;
      else if (d.power < 0) p.powerUse += -d.power;
    }
    for (const p of this.players) {
      const was = p.lowPower;
      p.lowPower = p.powerUse > p.powerProd;
      if (p.lowPower && !was && !p.neutral) this.emit({ t: 'low_power', p: p.id });
      if (!p.lowPower && was && !p.neutral) this.emit({ t: 'power_restored', p: p.id });
    }
    this.powerDirty = false;
  }

  updatePlayer(p) {
    if (p.neutral || p.defeated) return;
    this.updateProduction(p);
    const swb = this.buildings.find((b) => b.owner === p.id && BUILDINGS[b.type].superweapon && !b.dead && b.built >= 1);
    if (swb && this.setup.superweapons !== false) {
      p.sw.max = BUILDINGS[swb.type].charge * (this.setup.swScale || 1);
      p.sw.type = BUILDINGS[swb.type].superweapon;
      if (!p.lowPower && !p.sw.ready) {
        p.sw.charge += DT;
        if (p.sw.charge >= p.sw.max) { p.sw.ready = true; p.sw.charge = p.sw.max; this.emit({ t: 'sw_ready', p: p.id, kind: p.sw.type }); for (const o of this.players) if (o.id !== p.id && !o.neutral && this.isEnemy(o.id, p.id)) this.emit({ t: 'sw_enemy_ready', p: o.id, kind: p.sw.type }); }
      }
    } else { p.sw.charge = 0; p.sw.ready = false; p.sw.type = null; }
  }

  // ---------- Fog of war ----------
  circle(r) {
    if (this.circles[r]) return this.circles[r];
    const out = [];
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r) out.push(x, y);
    return (this.circles[r] = out);
  }
  updateFog(force = false) {
    const m = this.map, W = m.w, H = m.h;
    for (const p of this.players) {
      if (!p.vis) continue;
      const v = p.vis;
      if (this.setup.fog === false) { v.fill(2); continue; }
      for (let i = 0; i < v.length; i++) if (v[i] === 2) v[i] = 1;
      const mark = (cx, cy, r) => {
        const c = this.circle(r);
        for (let k = 0; k < c.length; k += 2) {
          const x = cx + c[k], y = cy + c[k + 1];
          if (x >= 0 && y >= 0 && x < W && y < H) v[y * W + x] = 2;
        }
      };
      for (const u of this.units) if (!u.dead && this.isAlly(u.owner, p.id) && !this.players[u.owner].neutral) mark(tileOf(u.x), tileOf(u.y), UNITS[u.type].sight);
      for (const b of this.buildings) if (!b.dead && this.isAlly(b.owner, p.id) && !this.players[b.owner].neutral) mark(tileOf(b.x), tileOf(b.y), BUILDINGS[b.type].sight + Math.floor(b.w / 2));
      for (const s of this.strikes) mark(tileOf(s.x), tileOf(s.y), 4);
    }
    // Buildings remember being seen (shown under fog).
    for (const b of this.buildings) {
      if (b.dead) continue;
      for (const p of this.players) {
        if (!p.vis) continue;
        if (this.entVisibleTo(p.id, b)) b.seen |= 1 << p.id;
      }
    }
  }

  // ---------- Separation ----------
  separate() {
    for (const u of this.units) {
      if (u.dead) continue;
      const ru = unitRadius(u.type);
      const near = this.unitsInRect(u.x - 30, u.y - 30, u.x + 30, u.y + 30);
      for (const o of near) {
        if (o.id <= u.id) continue;
        const ro = unitRadius(o.type);
        const dx = o.x - u.x, dy = o.y - u.y;
        let d = Math.hypot(dx, dy);
        const min = (ru + ro) * 0.85;
        if (d >= min) continue;
        let nx, ny;
        if (d < 0.01) { const a = (u.id * 2.39996) % (Math.PI * 2); nx = Math.cos(a); ny = Math.sin(a); d = 0.01; }
        else { nx = dx / d; ny = dy / d; }
        const push = Math.min(min - d, 3);
        // stationary harvesters/working units resist pushing
        const uw = this.pushWeight(u), ow = this.pushWeight(o);
        const tot = uw + ow || 1;
        this.nudge(u, -nx * push * (uw / tot), -ny * push * (uw / tot));
        this.nudge(o, nx * push * (ow / tot), ny * push * (ow / tot));
      }
    }
  }
  pushWeight(u) {
    const o = u.order;
    if (o.type === 'harvest' && (o.s === 'mine' || o.s === 'unload')) return 0.05;
    if (u.moving) return 0.4;
    return 1;
  }
  nudge(u, dx, dy) {
    const nx = u.x + dx, ny = u.y + dy;
    if (this.map.passable(tileOf(nx), tileOf(ny))) { u.x = nx; u.y = ny; }
    else if (this.map.passable(tileOf(nx), tileOf(u.y))) u.x = nx;
    else if (this.map.passable(tileOf(u.x), tileOf(ny))) u.y = ny;
  }

  // ---------- Misc world ----------
  updateCrates() {
    if (this.setup.crates === false) return;
    if (this.tickN % (20 * 30) !== 0 || this.crates.length >= 3 || this.time < 30) return;
    for (let tries = 0; tries < 30; tries++) {
      const x = this.rng.int(this.map.w), y = this.rng.int(this.map.h);
      if (!this.map.passable(x, y) || this.map.ore[this.map.idx(x, y)]) continue;
      const kind = this.rng.pick(['money', 'money', 'heal', 'promote', 'reveal', 'unit']);
      this.crates.push({ x, y, kind, id: this.nextId++ });
      return;
    }
  }
  growOre() {
    if (this.tickN % (20 * 8) !== 0) return;
    const m = this.map;
    for (const s of m.spires) {
      for (let k = 0; k < 3; k++) {
        const x = s.x + this.rng.int(7) - 3, y = s.y + this.rng.int(7) - 3;
        if (!m.passable(x, y)) continue;
        const i = m.idx(x, y);
        if (m.ore[i] && m.oreKind[i] !== s.kind) continue;
        m.ore[i] = Math.min(500, m.ore[i] + 60);
        m.oreKind[i] = s.kind;
        m.oreVersion++;
      }
    }
  }

  checkVictory() {
    for (const p of this.players) {
      if (p.neutral || p.defeated) continue;
      const alive = this.units.some((u) => !u.dead && u.owner === p.id) || this.buildings.some((b) => !b.dead && b.owner === p.id && !BUILDINGS[b.type].wall);
      if (!alive) {
        p.defeated = true;
        for (const q of Object.values(p.queues)) q.length = 0;
        for (const b of this.buildings) if (b.owner === p.id && !b.dead) this.removeEntity(b);
        this.emit({ t: 'defeated', p: p.id });
      }
    }
    const teams = new Set(this.players.filter((p) => !p.neutral && !p.defeated).map((p) => p.team));
    if (teams.size <= 1 && !this.over) {
      this.over = { team: teams.size ? [...teams][0] : -1, time: this.time };
      this.emit({ t: 'game_over', team: this.over.team });
    }
  }

  tick() {
    this.time += DT; this.tickN++;
    this.pathBudget = 14;
    if (this.powerDirty) this.updatePower();
    this.rebuildSpatial();
    for (const p of this.players) this.updatePlayer(p);
    const us = this.units.slice();
    for (const u of us) this.updateUnit(u);
    const bs = this.buildings.slice();
    for (const b of bs) this.updateBuilding(b);
    this.updateProjectiles();
    this.updateStrikes();
    this.rebuildSpatial();
    this.separate();
    if (this.tickN % 4 === 0) this.updateFog();
    this.updateCrates();
    this.growOre();
    if (this.units.some((u) => u.dead)) this.units = this.units.filter((u) => !u.dead);
    if (this.buildings.some((b) => b.dead)) this.buildings = this.buildings.filter((b) => !b.dead);
    for (const [id, e] of this.ents) if (e.dead) this.ents.delete(id);
    if (this.powerDirty) this.updatePower();
    if (this.tickN % 20 === 0) this.checkVictory();
  }
}

export { FACTIONS };
