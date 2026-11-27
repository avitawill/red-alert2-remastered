// Canvas renderer: terrain, entities, effects, fog, overlays, minimap.
import { TILE, UNITS, BUILDINGS, RANKS, unitRadius } from './config.js';
import { T } from './map.js';
import { drawInfantry, drawVehicle, drawBuilding, drawCrate, drawFacade, BUILDING_HEIGHT } from './sprites.js';
import { clamp, lerp, shade, RNG } from './util.js';

const CHUNK = 16;
const TAU = Math.PI * 2;
const TERRAIN_COL = {
  [T.GRASS]: ['#58753a', '#5d7b3c', '#547035', '#62803f'],
  [T.DIRT]: ['#7d6a46', '#846f4a', '#776443', '#8a754e'],
  [T.SAND]: ['#bba674', '#c2ad7a', '#b49f6d', '#c7b483'],
  [T.WATER]: ['#285473', '#2a5878', '#26516f', '#2c5b7c'],
  [T.ROCK]: ['#5d5a55', '#625f59', '#58554f', '#67635c'],
  [T.TREE]: ['#4a6a30', '#4e6e33', '#47662d', '#527236'],
  [T.SPIRE]: ['#6b6253', '#6b6253', '#6b6253', '#6b6253'],
};
const MINI_COL = { [T.GRASS]: [88, 117, 58], [T.DIRT]: [125, 106, 70], [T.SAND]: [187, 166, 116], [T.WATER]: [40, 84, 115], [T.ROCK]: [93, 90, 85], [T.TREE]: [52, 82, 34], [T.SPIRE]: [107, 98, 83] };

export class Renderer {
  constructor(canvas, world, me) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.me = me;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.chunks = new Map();
    this.particles = [];
    this.decals = [];
    this.texts = [];
    this.beams = [];
    this.markers = [];
    this.swFx = [];
    this.shake = 0;
    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = world.map.w; this.fogCanvas.height = world.map.h;
    this.fogCtx = this.fogCanvas.getContext('2d');
    this.fogImg = this.fogCtx.createImageData(world.map.w, world.map.h);
    this.fogTick = -1;
    this.rng = new RNG(99);
    this.time = 0;
    this.mapVersion = world.map.version;
    this.miniBase = null;
    this.view3d = true;
    this.buildHillshade();
    this.resize();
  }

  setView3d(on) { this.view3d = !!on; this.chunks.clear(); }
  bHeight(type) { return this.view3d ? BUILDING_HEIGHT[type] || 0 : 0; }
  unitLift(type) { return this.view3d ? (UNITS[type].cat === 'infantry' ? 1.5 : 4) : 0; }

  // Purely visual rolling terrain: smooth height field -> per-tile light/shade.
  buildHillshade() {
    const m = this.world.map, W = m.w, H = m.h;
    const rng = new RNG((this.world.setup.seed * 31 + 7) >>> 0);
    const S = 7, gw = Math.ceil(W / S) + 2, gh = Math.ceil(H / S) + 2;
    const g = new Float32Array(gw * gh).map(() => rng.next());
    const hf = new Float32Array(W * H);
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const fx = x / S, fy = y / S, ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
      const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
      hf[y * W + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
    this.hill = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const h0 = hf[Math.max(0, y - 1) * W + Math.max(0, x - 1)], h1 = hf[Math.min(H - 1, y + 1) * W + Math.min(W - 1, x + 1)];
      this.hill[y * W + x] = clamp((h0 - h1) * 3.2, -1, 1);
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    const r = this.canvas.getBoundingClientRect();
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    this.canvas.width = Math.round(this.vw * dpr); this.canvas.height = Math.round(this.vh * dpr);
    this.clampCam();
  }

  clampCam() {
    const m = this.world.map;
    const z = this.cam.zoom;
    const maxX = m.w * TILE - this.vw / z, maxY = m.h * TILE - this.vh / z;
    this.cam.x = maxX < 0 ? maxX / 2 : clamp(this.cam.x, 0, maxX);
    this.cam.y = maxY < 0 ? maxY / 2 : clamp(this.cam.y, 0, maxY);
  }
  centerOn(x, y) { this.cam.x = x - this.vw / this.cam.zoom / 2; this.cam.y = y - this.vh / this.cam.zoom / 2; this.clampCam(); }
  screenToWorld(sx, sy) { return [this.cam.x + sx / this.cam.zoom, this.cam.y + sy / this.cam.zoom]; }
  worldToScreen(wx, wy) { return [(wx - this.cam.x) * this.cam.zoom, (wy - this.cam.y) * this.cam.zoom]; }
  setZoom(z, sx, sy) {
    const [wx, wy] = this.screenToWorld(sx ?? this.vw / 2, sy ?? this.vh / 2);
    const m = this.world.map;
    const minZ = Math.max(0.35, Math.min(this.vw / (m.w * TILE), this.vh / (m.h * TILE)));
    this.cam.zoom = clamp(z, minZ, 2.5);
    this.cam.x = wx - (sx ?? this.vw / 2) / this.cam.zoom;
    this.cam.y = wy - (sy ?? this.vh / 2) / this.cam.zoom;
    this.clampCam();
  }

  // ---------- Terrain chunks ----------
  chunk(cx, cy) {
    const key = cy * 1000 + cx;
    let c = this.chunks.get(key);
    if (c && c.v === this.world.map.version) return c.canvas;
    if (!c) { c = { canvas: document.createElement('canvas') }; c.canvas.width = c.canvas.height = CHUNK * TILE; this.chunks.set(key, c); }
    c.v = this.world.map.version;
    this.paintChunk(c.canvas.getContext('2d'), cx, cy);
    return c.canvas;
  }
  paintChunk(ctx, cx, cy) {
    const m = this.world.map;
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    ctx.clearRect(0, 0, CHUNK * TILE, CHUNK * TILE);
    const tAt = (x, y) => (m.inb(x, y) ? m.terrain[m.idx(x, y)] : T.GRASS);
    // pass 1: water/base squares
    for (let y = y0 - 1; y <= y0 + CHUNK; y++) for (let x = x0 - 1; x <= x0 + CHUNK; x++) {
      if (!m.inb(x, y)) continue;
      const t = tAt(x, y), v = m.variant[m.idx(x, y)];
      const base = t === T.TREE ? T.GRASS : t === T.SPIRE || (t === T.ROCK && this.view3d) ? T.DIRT : t;
      ctx.fillStyle = TERRAIN_COL[base][v & 3];
      ctx.fillRect((x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
    }
    // pass 2: rounded land blobs over water and soft transitions
    for (let y = y0 - 1; y <= y0 + CHUNK; y++) for (let x = x0 - 1; x <= x0 + CHUNK; x++) {
      if (!m.inb(x, y)) continue;
      const t = tAt(x, y);
      if (t === T.WATER) continue;
      const v = m.variant[m.idx(x, y)];
      const base = t === T.TREE ? T.GRASS : t === T.SPIRE || (t === T.ROCK && this.view3d) ? T.DIRT : t;
      const px = (x - x0) * TILE, py = (y - y0) * TILE;
      ctx.fillStyle = TERRAIN_COL[base][(v >> 2) & 3];
      ctx.beginPath(); ctx.arc(px + TILE / 2, py + TILE / 2, TILE * 0.72, 0, TAU); ctx.fill();
    }
    // hill shading (light from the north-west)
    if (this.view3d) {
      for (let y = y0; y < y0 + CHUNK; y++) for (let x = x0; x < x0 + CHUNK; x++) {
        if (!m.inb(x, y) || tAt(x, y) === T.WATER) continue;
        const hs = this.hill[m.idx(x, y)];
        if (Math.abs(hs) < 0.04) continue;
        ctx.fillStyle = hs > 0 ? `rgba(255,244,210,${(hs * 0.16).toFixed(3)})` : `rgba(0,0,20,${(-hs * 0.22).toFixed(3)})`;
        ctx.fillRect((x - x0) * TILE, (y - y0) * TILE, TILE, TILE);
      }
      // water depth: darker away from shore
      for (let y = y0; y < y0 + CHUNK; y++) for (let x = x0; x < x0 + CHUNK; x++) {
        if (!m.inb(x, y) || tAt(x, y) !== T.WATER) continue;
        let shore = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (m.inb(x + dx, y + dy) && tAt(x + dx, y + dy) !== T.WATER) shore++;
        if (!shore) { ctx.fillStyle = 'rgba(0,10,30,0.25)'; ctx.fillRect((x - x0) * TILE, (y - y0) * TILE, TILE, TILE); }
        if (y > 0 && tAt(x, y - 1) !== T.WATER) { ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect((x - x0) * TILE, (y - y0) * TILE, TILE, 6); }
      }
    }
    // shoreline foam
    ctx.strokeStyle = 'rgba(220,235,240,0.25)'; ctx.lineWidth = 2;
    for (let y = y0; y < y0 + CHUNK; y++) for (let x = x0; x < x0 + CHUNK; x++) {
      if (!m.inb(x, y) || tAt(x, y) !== T.WATER) continue;
      const px = (x - x0) * TILE, py = (y - y0) * TILE;
      const v = m.variant[m.idx(x, y)];
      if (v % 3 === 0) { ctx.beginPath(); ctx.moveTo(px + 6, py + 12 + (v % 7)); ctx.quadraticCurveTo(px + 16, py + 8 + (v % 5), px + 26, py + 12 + (v % 7)); ctx.stroke(); }
    }
    // details
    for (let y = y0; y < y0 + CHUNK; y++) for (let x = x0; x < x0 + CHUNK; x++) {
      if (!m.inb(x, y)) continue;
      const t = tAt(x, y), v = m.variant[m.idx(x, y)];
      const px = (x - x0) * TILE, py = (y - y0) * TILE;
      const r = new RNG(v * 7919 + x * 31 + y * 17);
      if (t === T.GRASS || t === T.DIRT || t === T.SAND) {
        ctx.fillStyle = t === T.GRASS ? 'rgba(130,170,80,0.35)' : 'rgba(60,45,25,0.25)';
        for (let k = 0; k < 4; k++) ctx.fillRect(px + r.next() * TILE, py + r.next() * TILE, 2, 2);
        if (t === T.GRASS && v < 12) { ctx.fillStyle = '#e8e4a0'; ctx.fillRect(px + r.next() * 28, py + r.next() * 28, 2, 2); }
        if (t === T.DIRT && v < 20) { ctx.fillStyle = '#8f8a80'; ctx.beginPath(); ctx.arc(px + 4 + r.next() * 24, py + 4 + r.next() * 24, 2 + r.next() * 2, 0, TAU); ctx.fill(); }
      }
    }
    for (let y = y0 - 1; y <= y0 + CHUNK; y++) for (let x = x0 - 1; x <= x0 + CHUNK; x++) {
      if (!m.inb(x, y)) continue;
      const t = tAt(x, y), v = m.variant[m.idx(x, y)];
      const px = (x - x0) * TILE, py = (y - y0) * TILE;
      const r = new RNG(v * 104729 + x * 13 + y * 7);
      if (t === T.ROCK && this.view3d) {
        this.cliffTile(ctx, m, x, y, px, py, r, tAt);
      } else if (t === T.TREE && this.view3d) {
        const n = 2 + (v & 1);
        for (let k = 0; k < n; k++) {
          const cx2 = px + 8 + r.next() * 16, cy2 = py + 10 + r.next() * 14, rad = 7 + r.next() * 5, ht = 9 + r.next() * 6;
          ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cx2 + ht * 0.7, cy2 + ht * 0.35, rad * 1.05, rad * 0.8, 0.5, 0, TAU); ctx.fill();
          ctx.fillStyle = '#4a3420'; ctx.fillRect(cx2 - 1.5, cy2 - ht * 0.6, 3, ht * 0.6);
          const g = ctx.createRadialGradient(cx2 - rad * 0.4, cy2 - ht - rad * 0.4, 1, cx2, cy2 - ht, rad * 1.1);
          const base = shade('#2f5a22', (r.next() - 0.5) * 0.3);
          g.addColorStop(0, '#7fae52'); g.addColorStop(0.45, base); g.addColorStop(1, '#16290f');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx2, cy2 - ht, rad, 0, TAU); ctx.fill();
        }
      } else if (t === T.ROCK) {
        for (let k = 0; k < 3; k++) {
          const cx2 = px + 6 + r.next() * 20, cy2 = py + 6 + r.next() * 20, rad = 8 + r.next() * 8;
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          poly(ctx, cx2 + 3, cy2 + 3, rad, r, 6);
          ctx.fillStyle = shade('#7a756c', (r.next() - 0.5) * 0.3);
          poly(ctx, cx2, cy2, rad, r, 6);
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          poly(ctx, cx2 - 2, cy2 - 2, rad * 0.5, r, 5);
        }
      } else if (t === T.TREE) {
        const n = 2 + (v & 1);
        for (let k = 0; k < n; k++) {
          const cx2 = px + 8 + r.next() * 16, cy2 = py + 8 + r.next() * 16, rad = 7 + r.next() * 5;
          ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(cx2 + 4, cy2 + 4, rad, 0, TAU); ctx.fill();
          ctx.fillStyle = shade('#2f5a22', (r.next() - 0.5) * 0.3); ctx.beginPath(); ctx.arc(cx2, cy2, rad, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(140,190,90,0.3)'; ctx.beginPath(); ctx.arc(cx2 - rad * 0.3, cy2 - rad * 0.3, rad * 0.5, 0, TAU); ctx.fill();
        }
      } else if (t === T.SPIRE) {
        const sp = this.world.map.spires.find((s) => s.x === x && s.y === y);
        const col = sp && sp.kind === 2 ? '#5fd0ff' : '#f0b233';
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + r.next();
          const cx2 = px + 16 + Math.cos(a) * 6, cy2 = py + 16 + Math.sin(a) * 6;
          crystal(ctx, cx2, cy2, 5 + r.next() * 4, col);
        }
        crystal(ctx, px + 16, py + 14, 10, col);
      }
    }
  }

  // Raised rocky plateau tile: lifted top surface + south-facing cliff wall + cast shadow.
  cliffTile(ctx, m, x, y, px, py, r, tAt) {
    const CH = 12;
    const isR = (xx, yy) => !m.inb(xx, yy) || tAt(xx, yy) === T.ROCK;
    const N = isR(x, y - 1), S = isR(x, y + 1), E = isR(x + 1, y), Wn = isR(x - 1, y);
    const R = 9;
    if (!S || !E) { ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(px + (E ? 0 : TILE), py + 4, E ? TILE : 8, TILE - 4); if (!S) ctx.fillRect(px + 4, py + TILE, TILE, 6); }
    if (!S) {
      const g = ctx.createLinearGradient(0, py + TILE - CH, 0, py + TILE);
      g.addColorStop(0, '#5c564d'); g.addColorStop(1, '#2f2b26');
      ctx.fillStyle = g;
      roundRect(ctx, px, py + TILE - CH - R, TILE, CH + R, [0, 0, !E ? R : 0, !Wn ? R : 0]); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < 4; k++) { const sx = px + 3 + r.next() * (TILE - 6); ctx.moveTo(sx, py + TILE - CH + 2); ctx.lineTo(sx + (r.next() - 0.5) * 3, py + TILE - 1); }
      ctx.stroke();
    }
    const top = shade('#857e72', ((m.variant[m.idx(x, y)] & 7) - 3.5) * 0.02);
    ctx.fillStyle = top;
    roundRect(ctx, px, py - CH, TILE, TILE, [!N && !Wn ? R : 0, !N && !E ? R : 0, !S && !E ? R : 0, !S && !Wn ? R : 0]); ctx.fill();
    if (!N) { ctx.fillStyle = 'rgba(255,250,230,0.18)'; ctx.fillRect(px + (Wn ? 0 : 4), py - CH, TILE - (Wn ? 0 : 4) - (E ? 0 : 4), 2); }
    if (!Wn) { ctx.fillStyle = 'rgba(255,250,230,0.12)'; ctx.fillRect(px, py - CH + 4, 2, TILE - 8); }
    for (let k = 0; k < 2; k++) {
      const cx2 = px + 7 + r.next() * 18, cy2 = py - CH + 7 + r.next() * 18, rad = 4 + r.next() * 5;
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; poly(ctx, cx2 + 2, cy2 + 2, rad, r, 6);
      ctx.fillStyle = shade('#9a9386', (r.next() - 0.5) * 0.2); poly(ctx, cx2, cy2, rad, r, 6);
    }
  }

  // ---------- Events → effects ----------
  ingest(events) {
    for (const e of events) {
      if (e.t !== 'fx') continue;
      switch (e.kind) {
        case 'bullet': this.beams.push({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, life: 0.07, max: 0.07, col: '#ffe9a0', w: 1.2 }); this.spark(e.tx, e.ty, 2, '#ffd27a'); break;
        case 'tracer': this.beams.push({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, life: 0.12, max: 0.12, col: '#ffffff', w: 1.6 }); this.spark(e.tx, e.ty, 3, '#ffffff'); break;
        case 'flame':
          for (let k = 0; k < 6; k++) {
            const f = Math.random();
            this.particles.push({ x: e.x + (e.tx - e.x) * f * 0.3, y: e.y + (e.ty - e.y) * f * 0.3, vx: (e.tx - e.x) * (2 + Math.random()) , vy: (e.ty - e.y) * (2 + Math.random()), life: 0.35, max: 0.35, size: 3 + Math.random() * 3, col: Math.random() < 0.5 ? '#ffb347' : '#ff6a2a', grow: 8, drag: 0.9, glow: true });
          }
          break;
        case 'beam': this.beams.push({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, life: 0.3, max: 0.3, col: e.color, w: e.thin ? 2.5 : 4, glow: true }); this.spark(e.tx, e.ty, 6, '#ffffff'); break;
        case 'muzzle': this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.08, max: 0.08, size: 5, col: '#fff2b0', glow: true }); this.smoke(e.x, e.y, 1, 0.6); break;
        case 'muzzle_big': this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 9, col: '#fff2b0', glow: true }); this.smoke(e.x, e.y, 3, 1); break;
        case 'hit_shell': this.explosion(e.x, e.y, 0.5); break;
        case 'hit_rocket': this.explosion(e.x, e.y, 0.55); this.smoke(e.x, e.y, 2, 0.8); break;
        case 'blast': this.explosion(e.x, e.y, 0.9 * (e.size || 1)); this.decal(e.x, e.y, 14 * (e.size || 1)); break;
        case 'explode': this.explosion(e.x, e.y, 1.2 * (e.size || 1)); this.debris(e.x, e.y, 8); this.decal(e.x, e.y, 18); this.shake = Math.max(this.shake, 3); break;
        case 'die_inf': this.smoke(e.x, e.y, 3, 0.5); this.decals.push({ x: e.x, y: e.y, r: 4, life: 6, max: 6, inf: true }); break;
        case 'bld_explode': {
          const n = Math.min(10, e.w * e.h);
          for (let k = 0; k < n; k++) {
            const dx = (Math.random() - 0.5) * e.w * TILE, dy = (Math.random() - 0.5) * e.h * TILE;
            setTimeout(() => this.explosion(e.x + dx, e.y + dy, 1.1), k * 90);
          }
          this.debris(e.x, e.y, 18); this.decal(e.x, e.y, e.w * TILE * 0.6, true);
          this.shake = Math.max(this.shake, 7);
          break;
        }
        case 'mine': if (Math.random() < 0.6) this.particles.push({ x: e.x + (Math.random() - 0.5) * 20, y: e.y + (Math.random() - 0.5) * 20, vx: 0, vy: -10, life: 0.6, max: 0.6, size: 3, col: e.ore === 2 ? '#8fdfff' : '#f5c460', grow: 2 }); break;
        case 'income': this.texts.push({ x: e.x, y: e.y, txt: `+${e.amt}`, life: 1.5, max: 1.5, col: '#7cff7c', mine: e.p === this.me }); break;
        case 'orbital_charge': this.swFx.push({ kind: 'reticle', x: e.x, y: e.y, life: e.dur, max: e.dur }); break;
        case 'launch': this.swFx.push({ kind: 'missile', sx: e.sx, sy: e.sy, x: e.x, y: e.y, life: e.dur, max: e.dur }); this.smoke(e.sx, e.sy, 20, 2); break;
        case 'orbital':
          this.swFx.push({ kind: 'column', x: e.x, y: e.y, life: 1.6, max: 1.6, r: e.r });
          for (let k = 0; k < 14; k++) setTimeout(() => this.explosion(e.x + (Math.random() - 0.5) * e.r * TILE * 1.6, e.y + (Math.random() - 0.5) * e.r * TILE * 1.6, 1.3), k * 50);
          this.decal(e.x, e.y, e.r * TILE, true); this.shake = 14; break;
        case 'nuke':
          this.swFx.push({ kind: 'shock', x: e.x, y: e.y, life: 1.4, max: 1.4, r: e.r });
          for (let k = 0; k < 20; k++) setTimeout(() => this.explosion(e.x + (Math.random() - 0.5) * e.r * TILE * 1.8, e.y + (Math.random() - 0.5) * e.r * TILE * 1.8, 1.5), k * 40);
          this.smoke(e.x, e.y, 40, 4); this.decal(e.x, e.y, e.r * TILE * 1.1, true); this.shake = 18; break;
      }
    }
  }
  marker(x, y, col) { this.markers.push({ x, y, life: 0.6, max: 0.6, col }); }
  spark(x, y, n, col) { for (let k = 0; k < n; k++) { const a = Math.random() * TAU, s = 40 + Math.random() * 80; this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.15, max: 0.15, size: 1.5, col, glow: true }); } }
  smoke(x, y, n, scale = 1) { for (let k = 0; k < n; k++) this.particles.push({ x: x + (Math.random() - 0.5) * 8 * scale, y: y + (Math.random() - 0.5) * 8 * scale, vx: (Math.random() - 0.5) * 10, vy: -8 - Math.random() * 12, life: 1 + Math.random() * scale, max: 1.6 * scale, size: 3 * scale, col: 'rgba(60,60,60,', grow: 6 * scale, smoke: true }); }
  explosion(x, y, s) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.35 * (0.6 + s * 0.5), max: 0.35 * (0.6 + s * 0.5), size: 10 * s, col: '#ffdd88', grow: 30 * s, glow: true, boom: true });
    for (let k = 0; k < 6 * s; k++) { const a = Math.random() * TAU, sp = 30 + Math.random() * 70 * s; this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4, max: 0.4, size: 3 + Math.random() * 3 * s, col: Math.random() < 0.5 ? '#ff9a3a' : '#ffcc55', grow: 4, drag: 0.85, glow: true }); }
    this.smoke(x, y, Math.round(3 * s), s);
  }
  debris(x, y, n) { for (let k = 0; k < n; k++) { const a = Math.random() * TAU, sp = 50 + Math.random() * 90; this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.7, max: 0.7, size: 2, col: '#3a3530', drag: 0.9 }); } }
  decal(x, y, r, big) { this.decals.push({ x, y, r, life: big ? 90 : 40, max: big ? 90 : 40 }); if (this.decals.length > 220) this.decals.shift(); }

  updateFx(dt) {
    this.time += dt;
    const step = (arr) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].life -= dt; if (arr[i].life <= 0) arr.splice(i, 1); } };
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { p.vx *= Math.pow(p.drag, dt * 20); p.vy *= Math.pow(p.drag, dt * 20); }
      if (p.grow) p.size += p.grow * dt;
    }
    step(this.particles); step(this.beams); step(this.texts); step(this.decals); step(this.markers); step(this.swFx);
    for (const t of this.texts) t.y -= 18 * dt;
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
    this.shake = Math.max(0, this.shake - dt * 20);
  }

  // ---------- Fog ----------
  updateFogCanvas() {
    const w = this.world, p = w.players[this.me];
    if (!p.vis || this.fogTick === w.tickN) return;
    this.fogTick = w.tickN;
    const d = this.fogImg.data, v = p.vis;
    for (let i = 0; i < v.length; i++) {
      const a = v[i] === 2 ? 0 : v[i] === 1 ? 110 : 255;
      d[i * 4] = 0; d[i * 4 + 1] = 0; d[i * 4 + 2] = 0; d[i * 4 + 3] = a;
    }
    this.fogCtx.putImageData(this.fogImg, 0, 0);
  }

  // ---------- Main draw ----------
  draw(alpha, ui) {
    const ctx = this.ctx, w = this.world, m = w.map, z = this.cam.zoom;
    const me = this.me;
    const vis = w.players[me].vis;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.vw, this.vh);
    const sx = this.shake ? (Math.random() - 0.5) * this.shake : 0, sy = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    ctx.setTransform(this.dpr * z, 0, 0, this.dpr * z, (-this.cam.x * z + sx) * this.dpr, (-this.cam.y * z + sy) * this.dpr);
    const x0 = this.cam.x, y0 = this.cam.y, x1 = x0 + this.vw / z, y1 = y0 + this.vh / z;
    const T0x = Math.max(0, Math.floor(x0 / TILE) - 1), T0y = Math.max(0, Math.floor(y0 / TILE) - 1);
    const T1x = Math.min(m.w - 1, Math.ceil(x1 / TILE) + 1), T1y = Math.min(m.h - 1, Math.ceil(y1 / TILE) + 1);
    const tileVis = (x, y) => (vis ? vis[y * m.w + x] : 2);

    // terrain
    ctx.imageSmoothingEnabled = true;
    for (let cy = Math.floor(T0y / CHUNK); cy <= Math.floor(T1y / CHUNK); cy++)
      for (let cx = Math.floor(T0x / CHUNK); cx <= Math.floor(T1x / CHUNK); cx++)
        ctx.drawImage(this.chunk(cx, cy), cx * CHUNK * TILE, cy * CHUNK * TILE);

    // water shimmer
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = T0y; y <= T1y; y++) for (let x = T0x; x <= T1x; x++) {
      const i = y * m.w + x;
      if (m.terrain[i] !== T.WATER || (m.variant[i] & 3)) continue;
      const ph = Math.sin(this.time * 1.5 + m.variant[i]) * 4;
      ctx.moveTo(x * TILE + 8 + ph, y * TILE + 22); ctx.lineTo(x * TILE + 18 + ph, y * TILE + 22);
    }
    ctx.stroke();

    // decals
    for (const d of this.decals) {
      const a = Math.min(1, d.life / d.max * 2) * (d.inf ? 0.5 : 0.45);
      ctx.fillStyle = d.inf ? `rgba(70,30,20,${a})` : `rgba(20,18,15,${a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    }

    // crystal
    for (let y = T0y; y <= T1y; y++) for (let x = T0x; x <= T1x; x++) {
      const i = y * m.w + x;
      const amt = m.ore[i];
      if (!amt || tileVis(x, y) === 0) continue;
      const v = m.variant[i];
      const n = Math.min(5, 1 + Math.floor(amt / 100));
      const col = m.oreKind[i] === 2 ? '#5fd0ff' : '#f0b233';
      for (let k = 0; k < n; k++) {
        const ox = ((v * (k + 3) * 37) % 24) + 4, oy = ((v * (k + 5) * 53) % 24) + 4;
        crystal(ctx, x * TILE + ox, y * TILE + oy, 3 + ((v >> k) & 3), col);
      }
    }

    // crates
    for (const c of w.crates) {
      if (tileVis(c.x, c.y) !== 2) continue;
      ctx.save(); ctx.translate((c.x + 0.5) * TILE, (c.y + 0.5) * TILE); drawCrate(ctx, this.time); ctx.restore();
    }

    // buildings and units, depth-sorted by their ground line so tall structures hide what is behind them
    const sel = ui.selection;
    const items = [];
    for (const b of w.buildings) {
      if (b.dead || (b.tx + b.w) * TILE < x0 - 40 || b.tx * TILE > x1 + 40 || (b.ty + b.h) * TILE < y0 - 40 || b.ty * TILE > y1 + 80) continue;
      const mine = w.isAlly(b.owner, me);
      if (!mine && vis && !(b.seen & (1 << me))) continue;
      if (vis && tileVis(b.tx + (b.w >> 1), b.ty + (b.h >> 1)) === 0) continue;
      items.push({ k: (b.ty + b.h) * TILE - 0.5, b });
    }
    if (this.view3d) for (const it of items) this.buildingShadow(ctx, it.b);

    // rally lines for selected
    for (const id of sel) {
      const b = w.get(id);
      if (!b || b.kind !== 'building' || !b.rally) continue;
      ctx.strokeStyle = 'rgba(120,255,120,0.7)'; ctx.lineWidth = 1.5 / z; ctx.setLineDash([6 / z, 4 / z]);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.rally.x, b.rally.y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#7cff7c'; ctx.beginPath(); ctx.moveTo(b.rally.x, b.rally.y); ctx.lineTo(b.rally.x, b.rally.y - 14); ctx.lineTo(b.rally.x + 9, b.rally.y - 10); ctx.lineTo(b.rally.x, b.rally.y - 7); ctx.fill();
    }

    for (const u of w.units) {
      if (u.dead || u.x < x0 - 40 || u.x > x1 + 40 || u.y < y0 - 40 || u.y > y1 + 60) continue;
      if (!w.isAlly(u.owner, me) && vis && !w.visibleTo(me, u.x, u.y)) continue;
      items.push({ k: u.y, u });
    }
    items.sort((a, b) => a.k - b.k);
    for (const it of items) {
      if (it.b) { this.drawBuildingEnt(ctx, it.b); continue; }
      const u = it.u;
      const lift = this.unitLift(u.type);
      const ix = lerp(u.px ?? u.x, u.x, alpha), iy = lerp(u.py ?? u.y, u.y, alpha);
      ctx.save(); ctx.translate(ix, iy);
      const col = w.players[u.owner].color;
      const firing = w.time - u.lastFire < 0.08;
      if (UNITS[u.type].cat === 'infantry') drawInfantry(ctx, u.type, col, u.angle, this.time + u.id, u.moving, firing, lift);
      else drawVehicle(ctx, u.type, col, u.angle, u.tAngle, this.time + u.id, u.moving, firing, { cargo: u.cargo / (UNITS[u.type].capacity || 1), cargoKind: u.cargoKind, mining: u.order.type === 'harvest' && u.order.s === 'mine', barrel: u.barrel, lift });
      if (u.hitT && w.time - u.hitT < 0.06) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(0, -lift, unitRadius(u.type), 0, TAU); ctx.fill(); }
      ctx.restore();
      if (UNITS[u.type].cat !== 'infantry' && u.hp < u.maxHp * 0.5 && Math.random() < (u.hp < u.maxHp * 0.25 ? 0.25 : 0.08)) this.smoke(u.x, u.y, 1, 0.5);
    }

    // projectiles
    for (const pr of w.projectiles) {
      if (vis && !w.visibleTo(me, pr.x, pr.y)) continue;
      const f = Math.min(1, pr.t / pr.dur);
      if (pr.kind === 'arty') {
        const h = Math.sin(f * Math.PI) * 60;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 3, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd27a'; ctx.beginPath(); ctx.arc(pr.x, pr.y - h, 3, 0, TAU); ctx.fill();
      } else if (pr.kind === 'rocket') {
        const a = Math.atan2(pr.ty - pr.sy, pr.tx - pr.sx);
        const alt = this.view3d ? 8 : 0;
        if (alt) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(pr.x + 4, pr.y + 3, 2.5, 0, TAU); ctx.fill(); }
        ctx.save(); ctx.translate(pr.x, pr.y - alt); ctx.rotate(a);
        ctx.fillStyle = '#ddd'; ctx.fillRect(-4, -1.2, 8, 2.4);
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(-5, 0, 2.5, 0, TAU); ctx.fill();
        ctx.restore();
        if (Math.random() < 0.6) this.particles.push({ x: pr.x, y: pr.y, vx: 0, vy: 0, life: 0.4, max: 0.4, size: 2, col: 'rgba(200,200,200,', grow: 6, smoke: true });
      } else {
        const alt = this.view3d ? 6 : 0;
        if (alt) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(pr.x + 3, pr.y + 2, 2, 0, TAU); ctx.fill(); }
        ctx.fillStyle = '#ffe9a0'; ctx.beginPath(); ctx.arc(pr.x, pr.y - alt, 2.2, 0, TAU); ctx.fill();
      }
    }

    // beams / tracers
    ctx.lineCap = 'round';
    for (const b of this.beams) {
      const a = b.life / b.max;
      if (b.glow) {
        ctx.globalAlpha = a * 0.5; ctx.strokeStyle = b.col; ctx.lineWidth = b.w * 3;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.tx, b.ty); ctx.stroke();
        ctx.globalAlpha = a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = b.w * 0.6;
        ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.tx, b.ty); ctx.stroke();
      } else {
        ctx.globalAlpha = a; ctx.strokeStyle = b.col; ctx.lineWidth = b.w;
        const mx = lerp(b.x, b.tx, 0.4), my = lerp(b.y, b.ty, 0.4);
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(b.tx, b.ty); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // particles
    for (const p of this.particles) {
      const a = p.life / p.max;
      if (p.smoke) { ctx.fillStyle = p.col + (a * 0.45).toFixed(3) + ')'; }
      else { ctx.globalAlpha = Math.min(1, a * 1.5); ctx.fillStyle = p.col; }
      if (p.glow) ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }

    // superweapon effects
    for (const f of this.swFx) this.drawSwFx(ctx, f);

    // fog of war
    if (vis && w.setup.fog !== false) {
      this.updateFogCanvas();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, m.w * TILE, m.h * TILE);
      // edge of world
    }

    // floating texts
    ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    for (const t of this.texts) {
      if (!t.mine) continue;
      ctx.globalAlpha = t.life / t.max; ctx.fillStyle = '#000'; ctx.fillText(t.txt, t.x + 1, t.y + 1); ctx.fillStyle = t.col; ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    // selection overlays
    for (const id of sel) {
      const e = w.get(id);
      if (!e) continue;
      this.drawSelection(ctx, e, alpha, true, ui);
    }
    if (ui.hover && !sel.has(ui.hover.id)) {
      const e = w.get(ui.hover.id);
      if (e && (w.isAlly(e.owner, me) || w.entVisibleTo(me, e))) this.drawSelection(ctx, e, alpha, false, ui);
    }

    // markers
    for (const mk of this.markers) {
      const a = mk.life / mk.max;
      ctx.strokeStyle = mk.col; ctx.globalAlpha = a; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(mk.x, mk.y, 4 + (1 - a) * 12, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // placement ghost
    if (ui.placing && ui.placeTile) this.drawPlacement(ctx, ui);

    // superweapon targeting cursor
    if (ui.mode === 'sw' && ui.pointerWorld) {
      const [px, py] = ui.pointerWorld;
      ctx.strokeStyle = '#ff4040'; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(px, py, 3.4 * TILE, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 20, py); ctx.lineTo(px + 20, py); ctx.moveTo(px, py - 20); ctx.lineTo(px, py + 20); ctx.stroke();
    }

    // screen space overlays
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (ui.dragBox) {
      const { x0: a, y0: b, x1: c, y1: d } = ui.dragBox;
      ctx.strokeStyle = '#7cff7c'; ctx.lineWidth = 1.5; ctx.fillStyle = 'rgba(124,255,124,0.08)';
      ctx.fillRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
      ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
    }
  }

  buildingShadow(ctx, b) {
    const H = this.bHeight(b.type) * Math.min(1, b.built);
    if (H < 2) return;
    const x0 = b.tx * TILE + 2, y0 = b.ty * TILE + 2, x1 = (b.tx + b.w) * TILE - 2, y1 = (b.ty + b.h) * TILE;
    const dx = H * 0.75, dy = H * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.moveTo(x0, y0 - H * 0.2); ctx.lineTo(x1, y0 - H * 0.2); ctx.lineTo(x1 + dx, y0 + dy); ctx.lineTo(x1 + dx, y1 + dy); ctx.lineTo(x0 + dx, y1 + dy); ctx.lineTo(x0, y1);
    ctx.closePath(); ctx.fill();
  }

  buildingOpts(b) {
    const w = this.world, d = BUILDINGS[b.type], p = w.players[b.owner];
    const opts = {
      unpowered: p.lowPower && (d.power < 0 || d.needsPower), tAngle: b.tAngle, firing: w.time - b.lastFire < 0.1,
      docking: b.dockBusy, repairing: b.repairFx && w.time - b.repairFx < 0.4,
    };
    if (d.superweapon) { opts.charge = p.sw.max ? p.sw.charge / p.sw.max : 0; opts.ready = p.sw.ready; }
    if (d.wall) {
      const m = w.map;
      const same = (x, y) => { if (!m.inb(x, y)) return false; const o = w.get(m.bld[m.idx(x, y)]); return o && o.type === 'wall'; };
      opts.neighbors = { l: same(b.tx - 1, b.ty), r: same(b.tx + 1, b.ty), u: same(b.tx, b.ty - 1), d: same(b.tx, b.ty + 1) };
    }
    return opts;
  }

  // Draw a structure as a raised block: south wall (facade) + roof lifted by its height.
  drawStructure(ctx, type, color, t, opts, built = 1) {
    const d = BUILDINGS[type];
    const W = d.w * TILE, D = d.h * TILE;
    const H = this.bHeight(type) * built;
    if (!H) {
      if (built < 1) { ctx.save(); ctx.beginPath(); ctx.rect(-4, D * (1 - built) - 2, W + 8, D * built + 6); ctx.clip(); }
      drawBuilding(ctx, type, color, t, opts);
      if (built < 1) ctx.restore();
      return 0;
    }
    if (!(d.wall && opts.neighbors && opts.neighbors.d)) drawFacade(ctx, type, color, W, D, H, t, opts);
    ctx.save(); ctx.translate(0, -H);
    drawBuilding(ctx, type, color, t, { ...opts, noShadow: true });
    // light the roof from the north-west
    const g = ctx.createLinearGradient(0, 0, W, D);
    g.addColorStop(0, 'rgba(255,248,225,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.fillStyle = g; ctx.fillRect(1, 1, W - 2, D - 2);
    ctx.restore();
    return H;
  }

  drawBuildingEnt(ctx, b) {
    const w = this.world;
    const d = BUILDINGS[b.type];
    const col = w.players[b.owner].color;
    const p = w.players[b.owner];
    const W = d.w * TILE, D = d.h * TILE;
    ctx.save();
    ctx.translate(b.tx * TILE, b.ty * TILE);
    const built = Math.min(1, b.built);
    const H = this.drawStructure(ctx, b.type, col, this.time + b.id * 0.37, this.buildingOpts(b), built);
    if (built < 1) {
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 2;
      if (H) {
        // scaffolding around the rising block
        ctx.strokeStyle = 'rgba(229,195,58,0.85)'; ctx.lineWidth = 1.2;
        const full = this.bHeight(b.type);
        ctx.strokeRect(1, D - full - D, W - 2, D + full - 1);
        ctx.beginPath();
        for (let x = 1; x <= W; x += 10) { ctx.moveTo(x, D); ctx.lineTo(x, -full); }
        ctx.stroke();
        this.spark(b.tx * TILE + Math.random() * W, b.ty * TILE - H, 1, '#ffe680');
      } else {
        const y = D * (1 - built);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.strokeStyle = 'rgba(229,195,58,0.5)'; ctx.lineWidth = 1;
        ctx.strokeRect(1, 1, W - 2, D - 2);
        this.spark(b.tx * TILE + Math.random() * W, b.ty * TILE + y, 1, '#ffe680');
      }
    }
    ctx.translate(0, -H);
    if (b.demoT > 0) {
      ctx.fillStyle = Math.sin(w.time * 20) > 0 ? '#ff3030' : '#601010';
      ctx.beginPath(); ctx.arc(W / 2, D / 2, 5, 0, TAU); ctx.fill();
    }
    if (b.repairing) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(w.time * 8);
      wrench(ctx, W / 2, D / 2);
      ctx.globalAlpha = 1;
    }
    if (p.lowPower && d.power < 0 && b.owner === this.me && Math.sin(w.time * 4) > 0) {
      ctx.fillStyle = '#ffdd00'; ctx.font = 'bold 14px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⚡', W / 2, 14);
    }
    ctx.restore();
    const ry = b.y - H;
    if (b.hp < b.maxHp * 0.5 && !d.wall && Math.random() < 0.15) this.smoke(b.x + (Math.random() - 0.5) * d.w * 20, ry + (Math.random() - 0.5) * d.h * 20, 1, 1);
    if (b.hp < b.maxHp * 0.25 && !d.wall && Math.random() < 0.3) this.particles.push({ x: b.x + (Math.random() - 0.5) * d.w * 20, y: ry + (Math.random() - 0.5) * d.h * 20, vx: 0, vy: -20, life: 0.4, max: 0.4, size: 3, col: '#ff8a2a', grow: 3, glow: true });
  }

  drawSelection(ctx, e, alpha, selected, ui) {
    const w = this.world, z = this.cam.zoom;
    let cx, cy, hw, hh;
    if (e.kind === 'unit') {
      cx = lerp(e.px ?? e.x, e.x, alpha); cy = lerp(e.py ?? e.y, e.y, alpha) - this.unitLift(e.type);
      hw = hh = unitRadius(e.type) + 3;
    } else {
      const H = this.bHeight(e.type) * Math.min(1, e.built);
      cx = e.x; cy = e.y - H / 2; hw = (e.w * TILE) / 2; hh = (e.h * TILE + H) / 2;
    }
    const col = selected ? (w.isAlly(e.owner, this.me) ? '#ffffff' : '#ff8080') : 'rgba(255,255,255,0.5)';
    ctx.strokeStyle = col; ctx.lineWidth = 1.5 / z;
    const L = Math.min(8, hw * 0.6);
    ctx.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = cx + sx * hw, py = cy + sy * hh;
      ctx.moveTo(px, py - sy * -L * 0); ctx.lineTo(px - sx * L, py);
      ctx.moveTo(px, py); ctx.lineTo(px, py - sy * L);
    }
    ctx.stroke();
    // health bar
    const bw = Math.max(18, hw * 2), bh = 4 / Math.max(0.7, z);
    const f = clamp(e.hp / e.maxHp, 0, 1);
    const bx = cx - bw / 2, by = cy - hh - 7 / Math.max(0.7, z);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = f > 0.5 ? '#4cff4c' : f > 0.25 ? '#ffd400' : '#ff3b3b';
    const segs = Math.max(4, Math.round(bw / 4));
    const segW = bw / segs;
    for (let s = 0; s < segs * f; s++) ctx.fillRect(bx + s * segW, by, segW - 0.6, bh);
    if (e.kind === 'unit') {
      const d = UNITS[e.type];
      if (d.harvester) {
        const cf = e.cargo / d.capacity;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by + bh + 1, bw + 2, 3);
        ctx.fillStyle = e.cargoKind === 2 ? '#5fd0ff' : '#f0b233'; ctx.fillRect(bx, by + bh + 1.5, bw * cf, 2);
      }
      if (e.rank > 0) {
        ctx.fillStyle = e.rank === 2 ? '#ffd700' : '#c0c0c0';
        for (let k = 0; k < e.rank; k++) {
          const px = cx + hw - 2, py = cy + hh - 2 - k * 4;
          ctx.beginPath(); ctx.moveTo(px - 4, py - 2); ctx.lineTo(px, py + 1); ctx.lineTo(px + 4, py - 2); ctx.lineTo(px + 4, py); ctx.lineTo(px, py + 3); ctx.lineTo(px - 4, py); ctx.fill();
        }
      }
      const g = ui.groupOf && ui.groupOf(e.id);
      if (g != null && selected) {
        ctx.fillStyle = '#fff'; ctx.font = `bold ${10 / Math.max(0.8, z)}px sans-serif`; ctx.textAlign = 'left';
        ctx.fillText(String(g), cx - hw, cy + hh + 9 / Math.max(0.8, z));
      }
    }
    if (e.kind === 'building' && e.primary && selected && w.isAlly(e.owner, this.me) && BUILDINGS[e.type].producer) {
      ctx.fillStyle = '#7cff7c'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PRIMARY', cx, cy + hh + 11);
    }
  }

  drawPlacement(ctx, ui) {
    const w = this.world;
    const type = ui.placing;
    const d = BUILDINGS[type];
    const [tx, ty] = ui.placeTile;
    const st = w.tileStatus(this.me, type, tx, ty);
    let k = 0;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) {
      ctx.fillStyle = st[k++] ? 'rgba(80,255,80,0.28)' : 'rgba(255,60,60,0.45)';
      ctx.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }
    ctx.globalAlpha = 0.55;
    ctx.save(); ctx.translate(tx * TILE, ty * TILE);
    this.drawStructure(ctx, type, w.players[this.me].color, this.time, { tAngle: 0, neighbors: {} });
    ctx.restore();
    ctx.globalAlpha = 1;
    if (ui.wallLine && ui.wallLine.length) {
      for (const [x, y] of ui.wallLine) { ctx.fillStyle = 'rgba(80,255,80,0.25)'; ctx.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4); }
    }
  }

  drawSwFx(ctx, f) {
    const a = f.life / f.max;
    if (f.kind === 'reticle') {
      const p = 1 - a;
      ctx.strokeStyle = `rgba(255,80,80,${0.5 + 0.5 * Math.sin(this.time * 20)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3.2 * TILE * (1 - p * 0.6), 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(160,220,255,${p * 0.5})`;
      ctx.fillRect(f.x - 4 - p * 10, f.y - 3000, 8 + p * 20, 3000);
      ctx.globalCompositeOperation = 'source-over';
    } else if (f.kind === 'column') {
      ctx.globalCompositeOperation = 'lighter';
      const wdt = f.r * TILE * (0.6 + 0.4 * a);
      const g = ctx.createLinearGradient(f.x - wdt, 0, f.x + wdt, 0);
      g.addColorStop(0, 'rgba(120,200,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(120,200,255,0)');
      ctx.fillStyle = g; ctx.fillRect(f.x - wdt, f.y - 3000, wdt * 2, 3000);
      ctx.fillStyle = `rgba(200,240,255,${a * 0.8})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * TILE * (1.2 - a * 0.4), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (f.kind === 'missile') {
      const p = 1 - a;
      const hx = lerp(f.sx, f.x, p), hy = lerp(f.sy, f.y, p) - Math.sin(p * Math.PI) * 400;
      ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fill();
      this.particles.push({ x: hx, y: hy, vx: 0, vy: 0, life: 1.2, max: 1.2, size: 5, col: 'rgba(220,220,220,', grow: 10, smoke: true });
      this.particles.push({ x: hx, y: hy, vx: 0, vy: 0, life: 0.15, max: 0.15, size: 6, col: '#ffb347', glow: true });
      ctx.strokeStyle = `rgba(255,60,60,${0.5 + 0.5 * Math.sin(this.time * 15)})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3.8 * TILE, 0, TAU); ctx.stroke();
    } else if (f.kind === 'shock') {
      const p = 1 - a;
      ctx.strokeStyle = `rgba(255,220,150,${a})`; ctx.lineWidth = 10 * a + 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * TILE * 2 * p, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,180,80,${a * 0.7})`;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r * TILE * (0.4 + p * 0.8), 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // ---------- Minimap ----------
  drawMinimap(mc, online) {
    const w = this.world, m = w.map;
    const ctx = mc.getContext('2d');
    const W = mc.width, H = mc.height;
    const s = Math.min(W / m.w, H / m.h);
    const ox = (W - m.w * s) / 2, oy = (H - m.h * s) / 2;
    this.miniXform = { s, ox, oy };
    ctx.fillStyle = '#05080a'; ctx.fillRect(0, 0, W, H);
    if (!online) {
      const img = ctx.createImageData(W, H);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 40; img.data[i] = v; img.data[i + 1] = v * 1.2; img.data[i + 2] = v; img.data[i + 3] = 255; }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = '#6a8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(w.hasBuilding(this.me, 'radar') ? 'LOW POWER' : 'NO UPLINK', W / 2, H / 2 + 4);
      return;
    }
    if (!this.miniBase || this.miniVersion !== m.version + m.oreVersion * 0 || this.miniOre !== Math.floor(w.tickN / 40)) {
      this.miniVersion = m.version; this.miniOre = Math.floor(w.tickN / 40);
      const c = this.miniBase || document.createElement('canvas');
      c.width = m.w; c.height = m.h;
      const cx = c.getContext('2d');
      const img = cx.createImageData(m.w, m.h);
      for (let i = 0; i < m.w * m.h; i++) {
        let col = MINI_COL[m.terrain[i]];
        if (m.ore[i]) col = m.oreKind[i] === 2 ? [95, 208, 255] : [240, 178, 51];
        img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      this.miniBase = c;
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.miniBase, ox, oy, m.w * s, m.h * s);
    const me = this.me;
    for (const b of w.buildings) {
      if (b.dead) continue;
      if (!w.isAlly(b.owner, me) && !(b.seen & (1 << me))) continue;
      ctx.fillStyle = w.players[b.owner].color;
      ctx.fillRect(ox + b.tx * s, oy + b.ty * s, Math.max(2, b.w * s), Math.max(2, b.h * s));
    }
    for (const u of w.units) {
      if (u.dead) continue;
      if (!w.isAlly(u.owner, me) && !w.visibleTo(me, u.x, u.y)) continue;
      ctx.fillStyle = w.players[u.owner].color;
      const sz = Math.max(1.5, s * 0.9);
      ctx.fillRect(ox + (u.x / TILE) * s - sz / 2, oy + (u.y / TILE) * s - sz / 2, sz, sz);
    }
    if (w.players[me].vis && w.setup.fog !== false) {
      this.updateFogCanvas();
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, ox, oy, m.w * s, m.h * s);
    }
    // alert pings
    if (this.pings) {
      for (const p of this.pings) {
        const a = p.life / p.max;
        ctx.strokeStyle = `rgba(255,60,60,${a})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ox + (p.x / TILE) * s, oy + (p.y / TILE) * s, 3 + (1 - a) * 14, 0, TAU); ctx.stroke();
      }
    }
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.strokeRect(ox + (this.cam.x / TILE) * s, oy + (this.cam.y / TILE) * s, (this.vw / this.cam.zoom / TILE) * s, (this.vh / this.cam.zoom / TILE) * s);
  }
  minimapToWorld(mx, my) {
    const t = this.miniXform;
    if (!t) return null;
    return [((mx - t.ox) / t.s) * TILE, ((my - t.oy) / t.s) * TILE];
  }
}

function roundRect(ctx, x, y, w, h, [tl, tr, br, bl]) {
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y); if (tr) ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br); if (br) ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h); if (bl) ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl); if (tl) ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}
function poly(ctx, cx, cy, r, rng, n) {
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, rr = r * (0.7 + rng.next() * 0.3);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.85;
    k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}
function crystal(ctx, x, y, s, col) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.moveTo(x + 2, y - s + 2); ctx.lineTo(x + s * 0.55 + 2, y + 2); ctx.lineTo(x + 2, y + s * 0.6 + 2); ctx.lineTo(x - s * 0.55 + 2, y + 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.55, y); ctx.lineTo(x, y + s * 0.6); ctx.lineTo(x - s * 0.55, y); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.2, y - s * 0.1); ctx.lineTo(x - s * 0.3, y); ctx.fill();
}
function wrench(ctx, x, y) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.7);
  ctx.fillStyle = '#7cff7c'; ctx.strokeStyle = '#063'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.rect(-2.5, -2, 5, 14); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -5, 6, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#063'; ctx.fillRect(-2, -12, 4, 7);
  ctx.restore();
}
