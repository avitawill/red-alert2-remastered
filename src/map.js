// Procedural battlefield generation and terrain queries.
import { RNG, clamp } from './util.js';

export const T = { GRASS: 0, DIRT: 1, SAND: 2, WATER: 3, ROCK: 4, TREE: 5, SPIRE: 6 };
const PASSABLE = [true, true, true, false, false, false, false];

export class GameMap {
  constructor(w, h) {
    this.w = w; this.h = h;
    const n = w * h;
    this.terrain = new Uint8Array(n);
    this.variant = new Uint8Array(n);
    this.ore = new Uint16Array(n);      // credits remaining on tile
    this.oreKind = new Uint8Array(n);   // 1 amber, 2 azure
    this.bld = new Int32Array(n);       // building id occupying tile (0 = none)
    this.spires = [];                   // {x, y, kind}
    this.version = 0;                   // bumped when terrain/ore visuals change
    this.oreVersion = 0;
  }
  idx(x, y) { return y * this.w + x; }
  inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  terrainPassable(x, y) { return this.inb(x, y) && PASSABLE[this.terrain[y * this.w + x]]; }
  passable(x, y) {
    if (!this.inb(x, y)) return false;
    const i = y * this.w + x;
    return PASSABLE[this.terrain[i]] && this.bld[i] === 0;
  }
  buildable(x, y) { return this.passable(x, y); }

  toJSON() {
    return {
      w: this.w, h: this.h,
      terrain: Array.from(this.terrain), variant: Array.from(this.variant),
      ore: Array.from(this.ore), oreKind: Array.from(this.oreKind), bld: Array.from(this.bld),
      spires: this.spires,
    };
  }
  static fromJSON(o) {
    const m = new GameMap(o.w, o.h);
    m.terrain.set(o.terrain); m.variant.set(o.variant); m.ore.set(o.ore);
    m.oreKind.set(o.oreKind); m.bld.set(o.bld); m.spires = o.spires;
    return m;
  }
}

function makeNoise(rng, w, h, scale) {
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = s(fx - ix), ty = s(fy - iy);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1];
    const c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

function fbm(rng, w, h, base) {
  const n1 = makeNoise(rng, w, h, base), n2 = makeNoise(rng, w, h, base / 2), n3 = makeNoise(rng, w, h, base / 4);
  return (x, y) => (n1(x, y) * 0.6 + n2(x, y) * 0.28 + n3(x, y) * 0.12);
}

const START_SLOTS = (W, H, pad) => [
  { x: pad, y: pad }, { x: W - pad - 1, y: H - pad - 1 },
  { x: W - pad - 1, y: pad }, { x: pad, y: H - pad - 1 },
];

export function generateMap(seed, size, nPlayers) {
  const rng = new RNG(seed);
  const W = size, H = size;
  const map = new GameMap(W, H);
  const height = fbm(rng, W, H, 18);
  const forest = fbm(rng, W, H, 9);
  const soil = fbm(rng, W, H, 7);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = map.idx(x, y);
      const hgt = height(x, y);
      let t = T.GRASS;
      if (hgt < 0.33) t = T.WATER;
      else if (hgt < 0.36) t = T.SAND;
      else if (hgt > 0.7) t = T.ROCK;
      else if (forest(x, y) > 0.66) t = T.TREE;
      else if (soil(x, y) > 0.62) t = T.DIRT;
      map.terrain[i] = t;
      map.variant[i] = rng.int(256);
    }
  }

  const pad = Math.max(9, Math.round(size * 0.13));
  const slots = START_SLOTS(W, H, pad);
  // Shuffle so spawn corners vary between games.
  const order = [0, 1, 2, 3];
  const pairs = nPlayers <= 2 ? [[0, 1], [2, 3]] : null;
  let chosen;
  if (pairs) chosen = rng.pick(pairs).slice();
  else chosen = order.slice(0, nPlayers);
  for (let i = chosen.length - 1; i > 0; i--) { const j = rng.int(i + 1); [chosen[i], chosen[j]] = [chosen[j], chosen[i]]; }
  const starts = chosen.map((k) => slots[k]);

  const paint = (cx, cy, r, fn) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (map.inb(x, y) && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) fn(x, y, map.idx(x, y));
  };

  // Flatten bases for every slot (so the map looks symmetric even with fewer players).
  for (const s of slots) paint(s.x, s.y, 9, (x, y, i) => { map.terrain[i] = soil(x, y) > 0.6 ? T.DIRT : T.GRASS; });

  const placeField = (cx, cy, r, kind, withSpire) => {
    cx = Math.round(cx); cy = Math.round(cy);
    paint(cx, cy, r + 1, (x, y, i) => {
      if (map.terrain[i] === T.WATER || map.terrain[i] === T.ROCK || map.terrain[i] === T.TREE) map.terrain[i] = T.DIRT;
    });
    paint(cx, cy, r, (x, y, i) => {
      const d = Math.hypot(x - cx, y - cy) / (r + 0.01);
      if (rng.next() < 1 - d * 0.55) {
        map.ore[i] = Math.round((kind === 2 ? 200 : 300) + rng.next() * 250 * (1 - d));
        map.oreKind[i] = kind;
      }
    });
    if (withSpire) {
      const i = map.idx(cx, cy);
      map.terrain[i] = T.SPIRE; map.ore[i] = 0; map.oreKind[i] = 0;
      map.spires.push({ x: cx, y: cy, kind });
    }
  };

  const cx = W / 2, cy = H / 2;
  for (const s of slots) {
    const a = Math.atan2(cy - s.y, cx - s.x) + (rng.next() - 0.5) * 1.2;
    placeField(s.x + Math.cos(a) * 9, s.y + Math.sin(a) * 9, 3, 1, true);
  }
  placeField(cx, cy, 3.5, 2, true);
  const mids = [{ x: cx, y: pad + 2 }, { x: cx, y: H - pad - 3 }, { x: pad + 2, y: cy }, { x: W - pad - 3, y: cy }];
  for (const m of mids) placeField(m.x + (rng.next() - 0.5) * 6, m.y + (rng.next() - 0.5) * 6, 2.5, 1, true);
  if (size >= 96) {
    placeField(cx - size * 0.22, cy + size * 0.22, 2.5, 2, true);
    placeField(cx + size * 0.22, cy - size * 0.22, 2.5, 2, true);
  }

  // Connectivity: carve corridors so every slot can reach every other slot.
  const reach = () => {
    const seen = new Uint8Array(W * H);
    const q = [map.idx(slots[0].x, slots[0].y)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop();
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!map.terrainPassable(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (!seen[ni]) { seen[ni] = 1; q.push(ni); }
      }
    }
    return seen;
  };
  const carve = (a, b) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    for (let k = 0; k <= steps; k++) {
      const x = a.x + ((b.x - a.x) * k) / steps, y = a.y + ((b.y - a.y) * k) / steps;
      paint(x, y, 1.6, (px, py, i) => {
        if (!PASSABLE[map.terrain[i]] && map.terrain[i] !== T.SPIRE) map.terrain[i] = map.terrain[i] === T.WATER ? T.SAND : T.DIRT;
      });
    }
  };
  let seen = reach();
  for (let k = 1; k < slots.length; k++) {
    if (!seen[map.idx(slots[k].x, slots[k].y)]) { carve(slots[0], { x: cx, y: cy }); carve({ x: cx, y: cy }, slots[k]); seen = reach(); }
  }
  // Remove ore from unreachable pockets; open spire surroundings.
  for (let i = 0; i < W * H; i++) if (!seen[i]) { map.ore[i] = 0; map.oreKind[i] = 0; }

  // Neutral drill rigs.
  const derricks = [];
  const tryDerrick = (x, y) => {
    x = clamp(Math.round(x), 2, W - 4); y = clamp(Math.round(y), 2, H - 4);
    for (let r = 0; r < 6; r++) {
      for (let k = 0; k < 12; k++) {
        const px = x + Math.round((rng.next() - 0.5) * r * 2), py = y + Math.round((rng.next() - 0.5) * r * 2);
        let ok = true;
        for (let yy = -1; yy <= 2 && ok; yy++) for (let xx = -1; xx <= 2 && ok; xx++) {
          if (!map.terrainPassable(px + xx, py + yy) || !seen[map.idx(px + xx, py + yy)] || map.ore[map.idx(px + xx, py + yy)]) ok = false;
        }
        if (ok) { derricks.push({ x: px, y: py }); return; }
      }
    }
  };
  tryDerrick(cx - size * 0.18, cy - size * 0.05);
  tryDerrick(cx + size * 0.18, cy + size * 0.05);
  if (size >= 96) { tryDerrick(cx + size * 0.05, cy - size * 0.3); tryDerrick(cx - size * 0.05, cy + size * 0.3); }

  return { map, starts, derricks };
}
