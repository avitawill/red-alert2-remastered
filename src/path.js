// A* pathfinding on the tile grid (8-directional, no corner cutting).
import { MinHeap } from './util.js';

const SQ2 = Math.SQRT2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];

export class PathFinder {
  constructor(map) {
    this.map = map;
    const n = map.w * map.h;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
    this.heap = new MinHeap();
  }

  // Nearest passable tile to (tx,ty), spiral search.
  nearestPassable(tx, ty, maxR = 8, extraOk) {
    const m = this.map;
    const ok = (x, y) => m.passable(x, y) || (extraOk && extraOk(x, y));
    if (ok(tx, ty)) return [tx, ty];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = 1e9;
      for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!ok(x, y)) continue;
        const d = (x - tx) ** 2 + (y - ty) ** 2;
        if (d < bd) { bd = d; best = [x, y]; }
      }
      if (best) return best;
    }
    return null;
  }

  // Returns array of [x,y] tiles from (excluding) start to goal, or partial path toward goal, or null.
  find(sx, sy, tx, ty, maxNodes = 6000) {
    const m = this.map, W = m.w;
    if (!m.inb(tx, ty)) return null;
    let goal = [tx, ty];
    if (!m.passable(tx, ty)) {
      goal = this.nearestPassable(tx, ty, 10);
      if (!goal) return null;
    }
    const [gx, gy] = goal;
    if (sx === gx && sy === gy) return [];
    this.gen++;
    if (this.gen > 0xfffffff0) { this.gen = 1; this.stamp.fill(0); this.closed.fill(0); }
    const gen = this.gen, g = this.g, parent = this.parent, stamp = this.stamp, closed = this.closed;
    const heap = this.heap; heap.clear();
    const h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return (dx + dy) + (SQ2 - 2) * Math.min(dx, dy); };
    const s = sy * W + sx;
    g[s] = 0; parent[s] = -1; stamp[s] = gen;
    heap.push(s, h(sx, sy));
    let best = s, bestH = h(sx, sy), expanded = 0;
    const goalI = gy * W + gx;
    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur] === gen) continue;
      closed[cur] = gen;
      if (cur === goalI) { best = cur; break; }
      const cx = cur % W, cy = (cur / W) | 0;
      const ch = h(cx, cy);
      if (ch < bestH) { bestH = ch; best = cur; }
      if (++expanded > maxNodes) break;
      for (let d = 0; d < 8; d++) {
        const [dx, dy, cost] = DIRS[d];
        const nx = cx + dx, ny = cy + dy;
        if (!m.passable(nx, ny)) continue;
        if (dx && dy && (!m.passable(cx + dx, cy) || !m.passable(cx, cy + dy))) continue;
        const ni = ny * W + nx;
        if (closed[ni] === gen) continue;
        const ng = g[cur] + cost;
        if (stamp[ni] !== gen || ng < g[ni]) {
          stamp[ni] = gen; g[ni] = ng; parent[ni] = cur;
          heap.push(ni, ng + h(nx, ny) * 1.001);
        }
      }
    }
    if (best === s) return [];
    const out = [];
    let c = best;
    while (c !== s && c !== -1) { out.push([c % W, (c / W) | 0]); c = parent[c]; }
    out.reverse();
    return simplify(out);
  }
}

// Drop intermediate points on straight runs (direction unchanged).
function simplify(path) {
  if (path.length < 3) return path;
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const p = path[i - 1], b = path[i], c = path[i + 1];
    if (b[0] - p[0] === c[0] - b[0] && b[1] - p[1] === c[1] - b[1]) continue;
    out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
