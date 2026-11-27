// Procedural vector art for every unit and structure (original designs).
import { TILE, BUILDINGS } from './config.js';
import { shade } from './util.js';

const TAU = Math.PI * 2;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function circle(ctx, x, y, r, fill, stroke, lw = 1) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function box(ctx, x, y, w, h, fill, stroke, r = 0, lw = 1) {
  if (r) rr(ctx, x, y, w, h, r); else { ctx.beginPath(); ctx.rect(x, y, w, h); }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// ---------------- Units ----------------
// Drawn centered at origin, facing +x (angle applied by caller for vehicles).
export function drawInfantry(ctx, type, color, angle, t, moving, firing, lift = 0) {
  const dark = shade(color, -0.45);
  const step = moving ? Math.sin(t * 14) * 2 : 0;
  const big = type === 'juggernaut';
  const R = big ? 6.5 : 4.2;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(1.5 + lift * 0.6, 2.5 + lift * 0.3, R + 1, R * 0.7, 0, 0, TAU); ctx.fill();
  ctx.save();
  ctx.translate(0, -lift);
  ctx.rotate(angle);
  // legs
  ctx.fillStyle = dark;
  circle(ctx, -1 + step, -2.2, 1.6, dark);
  circle(ctx, -1 - step, 2.2, 1.6, dark);
  if (type === 'juggernaut') {
    box(ctx, -9, -4, 5, 8, '#555', '#222', 2); // fuel tank
    circle(ctx, 0, 0, R, color, dark, 1.4);
    box(ctx, -3, -5, 6, 10, shade(color, -0.2), null, 2);
    box(ctx, 3, 2, 9, 2.6, '#333');
    circle(ctx, 0, 0, 3, '#777', '#222');
    if (firing) circle(ctx, 13, 3.3, 2, '#ffb347');
  } else {
    circle(ctx, 0, 0, R, color, dark, 1.2);
    let helmet = '#3f4a2f';
    if (type === 'engineer') helmet = '#e5c33a';
    if (type === 'ranger') helmet = '#2b2b2b';
    if (type === 'rocket') {
      box(ctx, -4, 1.6, 12, 3.2, '#4d5a3a', '#222', 1);
      box(ctx, 7, 1.6, 2, 3.2, '#222');
    } else if (type === 'engineer') {
      box(ctx, -1, 3, 4, 3, '#8a6a3a', '#222');
    } else if (type === 'ranger') {
      box(ctx, 0, -0.6, 13, 1.4, '#1a1a1a');
      box(ctx, 5, -1.3, 3, 2.6, '#333');
    } else {
      box(ctx, 0, -0.7, 8, 1.6, '#222');
    }
    circle(ctx, 0.5, 0, 2.4, helmet, '#111', 0.8);
    if (firing && type !== 'engineer') circle(ctx, type === 'ranger' ? 14 : 9, type === 'rocket' ? 3.2 : 0, 1.6, '#fff4b0');
  }
  ctx.restore();
}

function tracks(ctx, L, W, tw, t, moving) {
  box(ctx, -L / 2, -W / 2, L, tw, '#2a2a28', '#111', 1.5);
  box(ctx, -L / 2, W / 2 - tw, L, tw, '#2a2a28', '#111', 1.5);
  ctx.strokeStyle = '#4a4a44'; ctx.lineWidth = 1;
  const off = moving ? (t * 30) % 4 : 0;
  ctx.beginPath();
  for (let x = -L / 2 + off; x < L / 2; x += 4) {
    ctx.moveTo(x, -W / 2 + 0.5); ctx.lineTo(x, -W / 2 + tw - 0.5);
    ctx.moveTo(x, W / 2 - tw + 0.5); ctx.lineTo(x, W / 2 - 0.5);
  }
  ctx.stroke();
}

export function drawVehicle(ctx, type, color, angle, tAngle, t, moving, firing, extra = {}) {
  const dark = shade(color, -0.5), mid = shade(color, -0.2), light = shade(color, 0.25);
  const sz = { raider: [20, 14], tank: [26, 20], artillery: [26, 18], lancer: [26, 20], behemoth: [32, 26], harvester: [32, 24], crawler: [34, 26] }[type] || [24, 18];
  const lift = extra.lift || 0;
  ctx.save();
  if (lift) {
    // ground shadow cast away from the sun (top-left), then the hull's side wall, then raise the body
    ctx.save(); ctx.translate(lift * 1.3 + 1, lift * 0.9 + 1); ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(ctx, -sz[0] / 2, -sz[1] / 2, sz[0], sz[1], 5); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.rotate(angle);
    ctx.fillStyle = '#141412'; rr(ctx, -sz[0] / 2 + 0.5, -sz[1] / 2 + 0.5, sz[0] - 1, sz[1] - 1, 4); ctx.fill();
    ctx.restore();
    ctx.translate(0, -lift);
    ctx.rotate(angle);
  } else {
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    rr(ctx, -sz[0] / 2 + 3, -sz[1] / 2 + 3, sz[0], sz[1], 4); ctx.fill();
  }
  // turret sits higher than the hull: shift "screen-up" expressed in the rotated frame
  const te = lift ? 2.5 : 0;
  const tlx = -te * Math.sin(angle), tly = -te * Math.cos(angle);
  const turretBase = (r) => { if (te) circle(ctx, 0, 0, r, 'rgba(0,0,0,0.35)'); ctx.translate(tlx, tly); };
  const ta = tAngle - angle;
  const recoil = firing ? -2 : 0;
  switch (type) {
    case 'raider': {
      for (const [x, y] of [[-6, -7], [5, -7], [-6, 5], [5, 5]]) box(ctx, x - 2.5, y, 5, 2.5, '#1d1d1d');
      box(ctx, -9, -5.5, 18, 11, color, dark, 3, 1.2);
      box(ctx, 2, -4, 4, 8, '#9fd3e8', '#333', 1);
      box(ctx, -8, -4, 6, 8, mid, null, 1);
      ctx.save(); ctx.translate(-3, 0); turretBase(3.5); ctx.rotate(ta);
      circle(ctx, 0, 0, 3, '#444', '#111');
      box(ctx, 0 + recoil * 0.5, -0.8, 9, 1.6, '#1a1a1a');
      if (firing) circle(ctx, 10, 0, 2.2, '#fff0a0');
      ctx.restore();
      break;
    }
    case 'tank': case 'lancer': {
      tracks(ctx, 24, 18, 5, t, moving);
      box(ctx, -10, -6.5, 20, 13, color, dark, 2, 1.2);
      box(ctx, -9, -5, 4, 10, mid);
      ctx.save(); turretBase(6.5); ctx.rotate(ta);
      if (type === 'tank') {
        box(ctx, 2 + recoil, -1.3, 12, 2.6, '#2c2c2c', '#111', 0.5);
        circle(ctx, 0, 0, 5.8, light, dark, 1.2);
        circle(ctx, -1.5, -1.5, 1.6, mid);
        if (firing) circle(ctx, 15, 0, 3, '#fff2b0');
      } else {
        box(ctx, -5, -5, 10, 10, light, dark, 3, 1.2);
        box(ctx, 3, -2, 9, 4, '#3a3a3a', '#111', 1);
        circle(ctx, 12, 0, 2.6, '#bff6ff', '#4fd8ff', 1.2);
        if (firing) circle(ctx, 12, 0, 5, 'rgba(180,240,255,0.7)');
      }
      ctx.restore();
      break;
    }
    case 'artillery': {
      tracks(ctx, 24, 16, 4.5, t, moving);
      box(ctx, -11, -5.5, 18, 11, color, dark, 2, 1.2);
      box(ctx, -4, -4, 8, 8, light, dark, 1);
      box(ctx, 2 + recoil, -1.6, 18, 3.2, '#2e2e2e', '#111', 0.5);
      box(ctx, 18 + recoil, -2.2, 3, 4.4, '#222');
      if (firing) circle(ctx, 22, 0, 4, '#fff2b0');
      break;
    }
    case 'behemoth': {
      tracks(ctx, 30, 25, 7, t, moving);
      box(ctx, -13, -8.5, 26, 17, color, dark, 3, 1.4);
      box(ctx, -12, -6, 5, 12, mid);
      box(ctx, 8, -8, 4, 16, shade(color, -0.3));
      ctx.save(); turretBase(8); ctx.rotate(ta);
      box(ctx, 3 + recoil, -5, 15, 3, '#2a2a2a', '#111', 0.5);
      box(ctx, 3 + recoil, 2, 15, 3, '#2a2a2a', '#111', 0.5);
      box(ctx, -7, -7, 13, 14, light, dark, 4, 1.4);
      circle(ctx, -2, 0, 2.2, mid);
      if (firing) circle(ctx, 19, extra.barrel ? 3.5 : -3.5, 3.4, '#fff2b0');
      ctx.restore();
      break;
    }
    case 'harvester': {
      tracks(ctx, 30, 22, 6, t, moving);
      box(ctx, -14, -8.5, 20, 17, mid, dark, 2, 1.2);
      // ore bin
      const fill = extra.cargo || 0;
      box(ctx, -12, -6.5, 15, 13, '#3b3b36', '#111', 1);
      if (fill > 0) box(ctx, -12, -6.5, 15 * fill, 13, extra.cargoKind === 2 ? '#5fd0ff' : '#f0b233');
      box(ctx, 6, -8, 8, 16, color, dark, 2, 1.2);
      box(ctx, 9, -5, 4, 10, '#9fd3e8', '#222', 1);
      box(ctx, 14, -9, 3, 18, '#555', '#222');
      if (extra.mining) {
        ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
        for (let k = 0; k < 3; k++) { const a = t * 10 + k * 2.1; ctx.beginPath(); ctx.moveTo(15.5, Math.sin(a) * 8); ctx.lineTo(18, Math.sin(a) * 8); ctx.stroke(); }
      }
      break;
    }
    case 'crawler': {
      tracks(ctx, 32, 24, 6, t, moving);
      box(ctx, -15, -9, 30, 18, color, dark, 3, 1.4);
      box(ctx, -12, -7, 14, 14, mid, dark, 1);
      box(ctx, 5, -7, 9, 14, light, dark, 2);
      box(ctx, 9, -4, 4, 8, '#9fd3e8', '#222', 1);
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-12, -6); ctx.lineTo(2, 6); ctx.moveTo(-12, 6); ctx.lineTo(2, -6); ctx.stroke();
      circle(ctx, -5, 0, 3, '#444', '#111');
      break;
    }
    default:
      box(ctx, -10, -7, 20, 14, color, dark, 2);
  }
  ctx.restore();
}

// ---------------- Buildings ----------------
// Wall height (world px) of each structure in the 2.5D view.
export const BUILDING_HEIGHT = {
  hq: 30, power: 24, refinery: 26, barracks: 16, factory: 28, radar: 20, depot: 3, techlab: 28,
  orbital: 22, silo: 10, wall: 14, sentry: 10, turret: 12, lancetower: 30, bastion: 14, derrick: 14,
};

// Front (south-facing) wall of a raised structure. Spans y = D - H .. D in a footprint W wide.
export function drawFacade(ctx, type, color, W, D, H, t, opts = {}) {
  if (H <= 0.5) return;
  const y = D - H;
  const wall = type === 'wall';
  const lit = !opts.unpowered;
  const g = ctx.createLinearGradient(0, y, 0, D);
  g.addColorStop(0, wall ? '#8f8f83' : '#707068');
  g.addColorStop(1, wall ? '#5c5c53' : '#3f3f3a');
  ctx.fillStyle = g;
  if (wall) {
    const n = opts.neighbors || {};
    const x0 = n.l ? 0 : 5, x1 = n.r ? W : W - 5;
    ctx.fillRect(x0, y - 5, x1 - x0, H);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, y + H / 2 - 5); ctx.lineTo(x1, y + H / 2 - 5); ctx.stroke();
    return;
  }
  ctx.fillRect(1, y, W - 2, H);
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(1, y, W - 2, 1.5);
  if (H > 9) { ctx.fillStyle = shade(color, -0.3); ctx.fillRect(1, y + 3, W - 2, 2.5); }
  const win = (yy, step = 10) => {
    for (let x = 6; x < W - 9; x += step) {
      ctx.fillStyle = lit && ((x * 7 + yy) % 3) ? '#ffe08a' : '#262b31';
      ctx.fillRect(x, yy, 5, 3.5);
    }
  };
  const hazard = (x, yy, w, h) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x, yy, w, h); ctx.clip();
    ctx.fillStyle = '#e5c33a'; ctx.fillRect(x, yy, w, h);
    ctx.fillStyle = '#222';
    for (let k = -h; k < w; k += 7) { ctx.beginPath(); ctx.moveTo(x + k, yy + h); ctx.lineTo(x + k + 3.5, yy + h); ctx.lineTo(x + k + 3.5 + h, yy); ctx.lineTo(x + k + h, yy); ctx.fill(); }
    ctx.restore();
  };
  switch (type) {
    case 'hq': win(y + 9); ctx.fillStyle = '#1b1f24'; ctx.fillRect(W / 2 - 8, D - 13, 16, 13); hazard(W / 2 - 8, D - 15, 16, 3); break;
    case 'factory': {
      const dh = Math.min(H - 6, 22);
      ctx.fillStyle = '#1b1d20'; ctx.fillRect(W / 2 - 22, D - dh, 44, dh);
      ctx.strokeStyle = '#33373c'; ctx.lineWidth = 1;
      for (let yy = D - dh + 3; yy < D; yy += 3) { ctx.beginPath(); ctx.moveTo(W / 2 - 22, yy); ctx.lineTo(W / 2 + 22, yy); ctx.stroke(); }
      hazard(W / 2 - 22, D - dh - 3, 44, 3);
      break;
    }
    case 'barracks': ctx.fillStyle = '#1b1f24'; ctx.fillRect(W / 2 - 5, D - Math.min(H - 5, 10), 10, Math.min(H - 5, 10)); break;
    case 'refinery': case 'power':
      ctx.strokeStyle = '#8b8b82'; ctx.lineWidth = 2.5;
      for (let x = 10; x < W - 6; x += 14) { ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x, D - 2); ctx.stroke(); }
      if (type === 'power') { ctx.fillStyle = lit ? '#ffe680' : '#333'; ctx.fillRect(W - 14, y + 8, 8, 4); }
      break;
    case 'techlab': ctx.fillStyle = lit ? 'rgba(150,210,255,0.75)' : '#3a4048'; ctx.fillRect(6, y + 8, W - 12, Math.max(3, H - 14)); break;
    case 'radar': win(y + 8, 12); break;
    case 'orbital': case 'silo': hazard(1, D - 5, W - 2, 4); break;
    case 'lancetower': ctx.fillStyle = lit ? color : '#444'; ctx.fillRect(W / 2 - 2, y + 6, 4, H - 10); break;
    case 'derrick': ctx.fillStyle = '#5b4f3c'; ctx.fillRect(1, y, W - 2, H); break;
  }
  // contact shadow at the base
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(1, D - 2, W - 2, 2);
}
// Drawn with top-left at (0,0) in a w*TILE by h*TILE box.
export function drawBuilding(ctx, type, color, t, opts = {}) {
  const d = BUILDINGS[type];
  const W = d.w * TILE, H = d.h * TILE;
  const dark = shade(color, -0.5), mid = shade(color, -0.2), light = shade(color, 0.3);
  const lit = !opts.unpowered;
  const glow = lit ? color : '#444';
  const conc = '#8a8a80', concD = '#5d5d55';
  if (!opts.noShadow) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(5, 5, W - 2, H - 2); }
  const slab = (inset = 1) => box(ctx, inset, inset, W - inset * 2, H - inset * 2, conc, concD, 2, 1.2);
  switch (type) {
    case 'hq': {
      slab();
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.strokeRect(8, H - 26, W - 16, 20); ctx.setLineDash([]);
      box(ctx, 6, 6, W - 30, H - 40, mid, dark, 3, 1.4);
      box(ctx, 10, 10, W - 38, 12, color);
      box(ctx, W - 26, 6, 20, 30, light, dark, 2, 1.2);
      circle(ctx, W - 16, 14, 4, lit ? '#9fe6ff' : '#456');
      // crane
      ctx.save(); ctx.translate(W - 18, H - 20); ctx.rotate(Math.sin(t * 0.4) * 0.6 - 2.2);
      box(ctx, 0, -2, 34, 4, '#e5c33a', '#6b5a10', 1); box(ctx, 30, -1, 2, 10, '#333');
      ctx.restore();
      circle(ctx, W - 18, H - 20, 5, '#555', '#222');
      break;
    }
    case 'power': {
      slab();
      for (const [cx, cy] of [[W * 0.32, H * 0.36], [W * 0.68, H * 0.64]]) {
        circle(ctx, cx, cy, 12, '#9a9a90', concD, 1.5);
        circle(ctx, cx, cy, 8, '#3b3b36');
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(lit ? t * 6 : 0);
        ctx.fillStyle = lit ? shade(color, 0.1) : '#555';
        for (let k = 0; k < 3; k++) { ctx.rotate(TAU / 3); ctx.fillRect(-1.5, 0, 3, 7); }
        ctx.restore();
        circle(ctx, cx, cy, 2, lit ? '#fff' : '#666');
      }
      box(ctx, W * 0.6, 4, W * 0.34, H * 0.3, mid, dark, 2);
      box(ctx, 4, H * 0.66, W * 0.34, H * 0.28, mid, dark, 2);
      if (lit) { ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 4); circle(ctx, W * 0.78, H * 0.18, 3, '#ffe680'); ctx.globalAlpha = 1; }
      break;
    }
    case 'refinery': {
      slab();
      box(ctx, 4, H - 30, W - 8, 26, '#4c4c46', concD, 2);
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 3;
      for (let x = 8; x < W - 8; x += 10) { ctx.beginPath(); ctx.moveTo(x, H - 6); ctx.lineTo(x + 6, H - 28); ctx.stroke(); }
      box(ctx, 4, 4, W * 0.55, H - 38, mid, dark, 3, 1.4);
      box(ctx, 8, 8, W * 0.55 - 8, 8, color);
      for (const [cx, cy] of [[W * 0.78, H * 0.2], [W * 0.78, H * 0.48]]) {
        circle(ctx, cx, cy, 11, light, dark, 1.5);
        circle(ctx, cx - 3, cy - 3, 4, 'rgba(255,255,255,0.35)');
      }
      box(ctx, 16, H * 0.36, 26, 14, '#3a3a34', null, 2);
      if (opts.docking) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 12); circle(ctx, W / 2, H - 16, 5, '#f0b233'); ctx.globalAlpha = 1; }
      break;
    }
    case 'barracks': {
      slab();
      box(ctx, 5, 5, W - 10, H - 18, mid, dark, 3, 1.4);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(W / 2, 5); ctx.lineTo(W - 5, 18); ctx.closePath(); ctx.fill();
      box(ctx, W / 2 - 6, H - 22, 12, 9, '#222');
      for (let x = 4; x < W - 4; x += 7) circle(ctx, x + 3, H - 6, 3.2, '#b7a171', '#6b5a35');
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(W - 10, 22); ctx.lineTo(W - 10, 4); ctx.stroke();
      ctx.fillStyle = color;
      const wv = Math.sin(t * 5) * 2;
      ctx.beginPath(); ctx.moveTo(W - 10, 4); ctx.lineTo(W - 1, 6 + wv); ctx.lineTo(W - 10, 10); ctx.fill();
      break;
    }
    case 'factory': {
      slab();
      box(ctx, 4, 4, W - 8, H - 22, mid, dark, 3, 1.4);
      for (let y = 10; y < H - 22; y += 9) box(ctx, 8, y, W - 16, 4, shade(color, -0.05));
      box(ctx, W / 2 - 22, H - 24, 44, 20, '#2b2b28', '#111', 1);
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 2;
      for (let x = W / 2 - 20; x < W / 2 + 20; x += 8) { ctx.beginPath(); ctx.moveTo(x, H - 6); ctx.lineTo(x + 5, H - 22); ctx.stroke(); }
      box(ctx, 6, H - 18, 12, 12, '#555', '#222', 2);
      circle(ctx, 12, H - 12, 3, lit ? glow : '#444');
      box(ctx, W - 18, H - 18, 12, 12, '#555', '#222', 2);
      break;
    }
    case 'radar': {
      slab();
      box(ctx, 6, 8, W - 12, H - 14, mid, dark, 4, 1.4);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(lit ? t * 1.5 : 0.4);
      ctx.fillStyle = '#cfd3d6'; ctx.strokeStyle = '#555';
      ctx.beginPath(); ctx.ellipse(0, 0, 18, 9, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#333'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -12); ctx.stroke();
      circle(ctx, 0, -12, 2, lit ? '#ff4040' : '#444');
      ctx.restore();
      break;
    }
    case 'depot': {
      box(ctx, 1, 1, W - 2, H - 2, '#5a5a54', concD, 2, 1.2);
      box(ctx, 10, 10, W - 20, H - 20, '#6e6e66', '#e5c33a', 3, 2);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI / 4);
      box(ctx, -3, -14, 6, 28, color); box(ctx, -8, -16, 16, 6, color, null, 2);
      ctx.restore();
      for (const [x, y] of [[4, 4], [W - 12, 4], [4, H - 12], [W - 12, H - 12]]) box(ctx, x, y, 8, 8, mid, dark, 1);
      if (opts.repairing) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 15); circle(ctx, W / 2, H / 2, 6, '#7cff7c'); ctx.globalAlpha = 1; }
      break;
    }
    case 'techlab': {
      slab();
      box(ctx, 6, H - 26, W - 12, 20, mid, dark, 3, 1.4);
      const g = ctx.createRadialGradient(W / 2 - 8, H * 0.38 - 8, 2, W / 2, H * 0.4, 30);
      g.addColorStop(0, '#f4f7fa'); g.addColorStop(0.6, '#a9b6c2'); g.addColorStop(1, '#5c6874');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 28, 0, TAU); ctx.fill();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(W / 2, H * 0.42, 22, 0.2, Math.PI - 0.2); ctx.stroke();
      ctx.strokeStyle = '#444'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(W - 12, H - 24); ctx.lineTo(W - 12, 6); ctx.stroke();
      circle(ctx, W - 12, 6, 2.5, lit ? (Math.sin(t * 6) > 0 ? '#ff5050' : '#702020') : '#333');
      break;
    }
    case 'orbital': {
      slab();
      box(ctx, 6, 6, W - 12, H - 12, '#4a4e55', dark, 6, 1.4);
      const ch = opts.charge || 0;
      ctx.strokeStyle = color; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 30, -Math.PI / 2, -Math.PI / 2 + TAU * ch); ctx.stroke();
      const g = ctx.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, 24);
      g.addColorStop(0, lit ? '#ffffff' : '#888'); g.addColorStop(0.4, lit ? light : '#666'); g.addColorStop(1, '#2f3338');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(W / 2, H / 2, 24, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(t * (opts.ready ? 3 : 0.6));
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(26, 0); ctx.stroke(); }
      ctx.restore();
      if (opts.ready) { ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t * 8); circle(ctx, W / 2, H / 2, 9, '#fff'); ctx.globalAlpha = 1; }
      break;
    }
    case 'silo': {
      slab();
      box(ctx, 8, 8, W - 16, H - 16, '#4b4a44', dark, 4, 1.4);
      const open = opts.ready ? 1 : 0;
      box(ctx, 16 - open * 8, 16, (W - 32) / 2, H - 32, mid, dark, 2);
      box(ctx, W / 2 + open * 8, 16, (W - 32) / 2, H - 32, mid, dark, 2);
      if (open) { circle(ctx, W / 2, H / 2, 10, '#222'); circle(ctx, W / 2, H / 2, 5, '#ddd', '#888'); circle(ctx, W / 2, H / 2, 2, '#e33'); }
      ctx.strokeStyle = '#e5c33a'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.strokeRect(12, 12, W - 24, H - 24); ctx.setLineDash([]);
      const ch = opts.charge || 0;
      box(ctx, 6, H - 8, (W - 12) * ch, 4, lit ? color : '#555');
      break;
    }
    case 'wall': {
      const n = opts.neighbors || {};
      box(ctx, 5, 5, W - 10, H - 10, '#a4a497', '#5d5d55', 2, 1.2);
      ctx.fillStyle = '#a4a497';
      if (n.l) ctx.fillRect(0, 6, 8, H - 12);
      if (n.r) ctx.fillRect(W - 8, 6, 8, H - 12);
      if (n.u) ctx.fillRect(6, 0, W - 12, 8);
      if (n.d) ctx.fillRect(6, H - 8, W - 12, 8);
      box(ctx, 9, 9, W - 18, H - 18, '#b8b8ab');
      break;
    }
    case 'sentry': {
      box(ctx, 2, 2, W - 4, H - 4, '#7a7a6e', '#3d3d36', 6, 1.4);
      circle(ctx, W / 2, H / 2, 9, mid, dark, 1.2);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(opts.tAngle || 0);
      box(ctx, 2, -1.2, 12, 2.4, '#1a1a1a');
      if (opts.firing) circle(ctx, 15, 0, 2.5, '#fff2b0');
      ctx.restore();
      circle(ctx, W / 2, H / 2, 3, '#333');
      break;
    }
    case 'turret': {
      box(ctx, 1, 1, W - 2, H - 2, '#7a7a6e', '#3d3d36', 4, 1.2);
      circle(ctx, W / 2, H / 2, 11, '#5a5a52', '#2a2a26', 1.2);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(opts.tAngle || 0);
      box(ctx, 2 + (opts.firing ? -2 : 0), -1.8, 15, 3.6, '#262626', '#111', 0.5);
      circle(ctx, 0, 0, 7, lit ? color : shade(color, -0.4), dark, 1.2);
      if (opts.firing) circle(ctx, 18, 0, 3, '#fff2b0');
      ctx.restore();
      break;
    }
    case 'lancetower': {
      box(ctx, 2, 2, W - 4, H - 4, '#6b6f75', '#33363a', 4, 1.2);
      circle(ctx, W / 2, H / 2, 10, mid, dark, 1.4);
      const g = ctx.createRadialGradient(W / 2, H / 2 - 6, 1, W / 2, H / 2 - 6, 9);
      g.addColorStop(0, lit ? '#ffffff' : '#999'); g.addColorStop(1, lit ? color : '#555');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 16); ctx.lineTo(W / 2 + 6, H / 2 - 4); ctx.lineTo(W / 2, H / 2 + 4); ctx.lineTo(W / 2 - 6, H / 2 - 4); ctx.closePath(); ctx.fill();
      if (lit) { ctx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 5); circle(ctx, W / 2, H / 2 - 6, 11, color); ctx.globalAlpha = 1; }
      break;
    }
    case 'bastion': {
      box(ctx, 1, 1, W - 2, H - 2, '#77746a', '#3a3832', 8, 1.4);
      for (const [x, y] of [[6, 6], [W - 14, 6], [6, H - 14], [W - 14, H - 14]]) box(ctx, x, y, 8, 8, '#5e5b52', '#2c2a25', 2);
      circle(ctx, W / 2, H / 2, 16, mid, dark, 1.4);
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(opts.tAngle || 0);
      box(ctx, 0 + (opts.firing ? -3 : 0), -4, 20, 3, '#262626'); box(ctx, 0 + (opts.firing ? -3 : 0), 1, 20, 3, '#262626');
      circle(ctx, 0, 0, 8, lit ? light : '#666', dark);
      ctx.restore();
      break;
    }
    case 'derrick': {
      box(ctx, 1, 1, W - 2, H - 2, '#6a5f4e', '#3a3328', 3, 1.2);
      circle(ctx, W * 0.72, H * 0.72, 9, '#4a4a44', '#222', 1.2);
      circle(ctx, W * 0.72, H * 0.72, 5, color);
      const bob = Math.sin(t * 2.5) * 0.35;
      ctx.save(); ctx.translate(W * 0.35, H * 0.45); ctx.rotate(bob);
      box(ctx, -18, -2.5, 30, 5, '#333', '#111', 1);
      box(ctx, -20, -5, 6, 10, '#555', '#111', 2);
      ctx.restore();
      box(ctx, W * 0.35 - 3, H * 0.45, 6, 16, '#444');
      box(ctx, 4, H - 12, 18, 8, color, dark, 1);
      break;
    }
  }
}

export function drawCrate(ctx, t) {
  const b = Math.sin(t * 3) * 1.5;
  box(ctx, -8, -8 + b, 16, 16, '#b8873e', '#5a3e12', 2, 1.4);
  ctx.strokeStyle = '#5a3e12'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-8, -8 + b); ctx.lineTo(8, 8 + b); ctx.moveTo(8, -8 + b); ctx.lineTo(-8, 8 + b); ctx.stroke();
}

// Icon for sidebar/cameo (draws into a canvas).
export function drawIcon(canvas, type, color) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width;
  ctx.clearRect(0, 0, s, canvas.height);
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, '#2c3440'); g.addColorStop(1, '#141920');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, canvas.height);
  ctx.save();
  if (BUILDINGS[type]) {
    const d = BUILDINGS[type];
    const scale = Math.min((s * 0.8) / (d.w * TILE), (canvas.height * 0.8) / (d.h * TILE));
    ctx.translate((s - d.w * TILE * scale) / 2, (canvas.height - d.h * TILE * scale) / 2);
    ctx.scale(scale, scale);
    const nb = type === 'wall' ? { l: true, r: true } : {};
    drawBuilding(ctx, type, color, 1, { tAngle: -0.6, neighbors: nb, charge: 0.7 });
  } else {
    ctx.translate(s / 2, canvas.height / 2);
    const inf = ['rifle', 'rocket', 'engineer', 'ranger', 'juggernaut'].includes(type);
    const sc = inf ? s / 16 : s / 38;
    ctx.scale(sc, sc);
    if (inf) drawInfantry(ctx, type, color, -0.6, 0, false, false);
    else drawVehicle(ctx, type, color, -0.6, -0.6, 0, false, false, { cargo: 0.6 });
  }
  ctx.restore();
}
