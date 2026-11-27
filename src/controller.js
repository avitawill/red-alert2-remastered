// Human player controller: selection, input (mouse/keyboard/touch), command issuing.
import { TILE, UNITS, BUILDINGS, unitRadius } from './config.js';
import { dist } from './util.js';

const tileOf = (p) => Math.floor(p / TILE);
const ACKS = {
  move: ['Moving.', 'On my way.', 'Relocating.', 'Copy that.'],
  attack: ['Engaging.', 'Target locked.', 'Opening fire.', 'Weapons free.'],
  select: ['Ready.', 'Standing by.', 'Awaiting orders.', 'Reporting.'],
};

export class Controller {
  constructor(game) {
    this.game = game; // {world, renderer, audio, ui, me, settings}
    this.selection = new Set();
    this.groups = {};
    this.mode = null;          // 'sell' | 'repair' | 'sw' | 'attackmove' | 'guardArea' | null
    this.placing = null;       // building type
    this.placeCat = null;
    this.placeTile = null;
    this.hover = null;
    this.pointerWorld = null;
    this.pointers = new Map();
    this.dragBox = null;
    this.boxMode = false;
    this.keys = new Set();
    this.lastTap = { t: 0, id: 0 };
    this.lastGroupKey = { k: null, t: 0 };
    this.edge = { x: 0, y: 0 };
    this.lastAlert = null;
    this.bind();
  }
  get w() { return this.game.world; }
  get r() { return this.game.renderer; }
  get me() { return this.game.me; }

  uiState() {
    return {
      selection: this.selection, hover: this.hover, placing: this.placing, placeTile: this.placeTile,
      dragBox: this.dragBox, mode: this.mode, pointerWorld: this.pointerWorld,
      groupOf: (id) => { for (const k in this.groups) if (this.groups[k].includes(id)) return k; return null; },
    };
  }

  // ---------- Selection helpers ----------
  cleanSelection() {
    for (const id of this.selection) { const e = this.w.get(id); if (!e) this.selection.delete(id); }
  }
  selectedUnits() { return [...this.selection].map((id) => this.w.get(id)).filter((e) => e && e.kind === 'unit' && e.owner === this.me); }
  selectedBuildings() { return [...this.selection].map((id) => this.w.get(id)).filter((e) => e && e.kind === 'building'); }
  setSelection(ids, add = false) {
    if (!add) this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.game.ui.selectionChanged();
  }
  deselect() { this.selection.clear(); this.game.ui.selectionChanged(); }

  entityAt(wx, wy) {
    const w = this.w, me = this.me;
    const pad = 6 / this.r.cam.zoom;
    let best = null, bd = 1e9;
    for (const u of w.unitsInRect(wx - 24, wy - 24, wx + 24, wy + 24)) {
      if (!w.isAlly(u.owner, me) && !w.visibleTo(me, u.x, u.y)) continue;
      const d = dist(wx, wy, u.x, u.y);
      const rr = unitRadius(u.type) + pad + (UNITS[u.type].cat === 'infantry' ? 3 : 0);
      if (d < rr && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    const tx = tileOf(wx), ty = tileOf(wy);
    if (!w.map.inb(tx, ty)) return null;
    const b = w.get(w.map.bld[w.map.idx(tx, ty)]);
    if (b && (w.isAlly(b.owner, me) || (b.seen & (1 << me)))) return b;
    return null;
  }

  // ---------- Commands ----------
  cmd(c) { return this.w.command(this.me, c); }
  ack(kind) {
    this.game.audio.play('ack');
    if (this.game.settings.unitVoices) { const arr = ACKS[kind]; this.game.audio.say(arr[Math.floor(Math.random() * arr.length)], 'ack', 2.5); }
  }

  // Context action at world point (tap / left-click / right-click in modern scheme).
  smartAction(wx, wy, add = false, pointerType = 'mouse') {
    const w = this.w, me = this.me;
    this.cleanSelection();
    const target = this.entityAt(wx, wy);
    const tx = tileOf(wx), ty = tileOf(wy);

    if (this.placing) return this.tryPlace(tx, ty, pointerType);
    if (this.mode === 'sell') {
      if (target && target.kind === 'building' && target.owner === me) { this.cmd({ type: 'sell', target: target.id }); this.game.audio.play('cash'); }
      else this.game.audio.play('error');
      return;
    }
    if (this.mode === 'repair') {
      if (target && target.kind === 'building' && target.owner === me && target.hp < target.maxHp) { this.cmd({ type: 'repair', target: target.id }); this.game.audio.play('click'); }
      else this.game.audio.play('error');
      return;
    }
    if (this.mode === 'sw') {
      if (this.cmd({ type: 'superweapon', x: wx, y: wy })) this.setMode(null);
      return;
    }
    const units = this.selectedUnits();
    if (this.mode === 'attackmove') {
      if (units.length) { this.cmd({ type: 'attackmove', ids: units.map((u) => u.id), x: wx, y: wy }); this.r.marker(wx, wy, '#ff6060'); this.ack('attack'); }
      this.setMode(null);
      return;
    }

    if (units.length) {
      if (target && target.kind === 'unit' && target.owner === me && target.id !== units[0].id && !this.selection.has(target.id)) {
        // selecting another own unit
        this.setSelection([target.id], add); this.ack('select'); return;
      }
      if (target && this.selection.has(target.id) && units.length === 1 && UNITS[target.type]?.deploysTo) {
        this.cmd({ type: 'deploy', ids: [target.id] }); return;
      }
      if (target && w.isEnemy(me, target.owner)) {
        this.cmd({ type: 'attack', ids: units.map((u) => u.id), target: target.id });
        this.r.marker(target.x, target.y, '#ff4040'); this.ack('attack'); return;
      }
      if (target && target.kind === 'building') {
        const bd = BUILDINGS[target.type];
        const engs = units.filter((u) => UNITS[u.type].engineer);
        if (engs.length && (target.owner !== me ? !bd.wall : target.hp < target.maxHp)) {
          this.cmd({ type: 'attack', ids: engs.map((u) => u.id), target: target.id }); this.ack('move'); return;
        }
        if (target.owner === me && bd.refinery && units.some((u) => UNITS[u.type].harvester)) {
          this.cmd({ type: 'dock', ids: units.map((u) => u.id), target: target.id }); this.ack('move'); return;
        }
        if (target.owner === me && bd.depot && units.some((u) => UNITS[u.type].cat === 'vehicle')) {
          this.cmd({ type: 'repairAt', ids: units.map((u) => u.id), target: target.id }); this.ack('move'); return;
        }
        if (target.owner === me) { this.setSelection([target.id], add); this.game.audio.play('select'); return; }
        if (target.owner === w.neutralId && engs.length) { this.cmd({ type: 'attack', ids: engs.map((u) => u.id), target: target.id }); this.ack('move'); return; }
      }
      if (target && target.kind === 'unit' && target.owner === me) { this.setSelection([target.id], add); this.ack('select'); return; }
      if (!w.map.inb(tx, ty)) return;
      const vis = w.players[me].vis;
      if (vis && vis[ty * w.map.w + tx] === 0 && pointerType !== 'mouse') { /* allow moving into shroud */ }
      this.cmd({ type: 'move', ids: units.map((u) => u.id), x: wx, y: wy });
      this.r.marker(wx, wy, '#7cff7c'); this.ack('move');
      return;
    }

    // No units selected
    const bsel = this.selectedBuildings().filter((b) => b.owner === me);
    if (target) {
      if (target.owner === me || w.isAlly(target.owner, me) || true) {
        this.setSelection([target.id], add);
        if (target.owner === me) this.game.audio.play('select');
        if (target.kind === 'unit' && target.owner === me) this.ack('select');
        return;
      }
    }
    if (bsel.length === 1 && BUILDINGS[bsel[0].type].producer && BUILDINGS[bsel[0].type].producer !== 'building') {
      this.cmd({ type: 'rally', target: bsel[0].id, x: wx, y: wy }); this.r.marker(wx, wy, '#7cff7c'); this.game.audio.play('click'); return;
    }
    if (this.selection.size) this.deselect();
  }

  tryPlace(tx, ty, pointerType) {
    const d = BUILDINGS[this.placing];
    const ox = tx - Math.floor(d.w / 2), oy = ty - Math.floor(d.h / 2);
    if (pointerType === 'touch' && !d.wall) {
      if (!this.placeTile || this.placeTile[0] !== ox || this.placeTile[1] !== oy) {
        this.placeTile = [ox, oy]; this.game.ui.showPlaceConfirm(true); return;
      }
    }
    this.placeTile = [ox, oy];
    this.confirmPlace();
  }
  confirmPlace() {
    if (!this.placing || !this.placeTile) return;
    const ok = this.cmd({ type: 'place', cat: this.placeCat, item: this.placing, tx: this.placeTile[0], ty: this.placeTile[1] });
    if (ok) {
      this.game.audio.play('place');
      if (!BUILDINGS[this.placing].wall) this.stopPlacing();
    } else this.game.audio.play('error');
  }
  startPlacing(cat, type) {
    this.setMode(null);
    this.placing = type; this.placeCat = cat;
    const [cx, cy] = this.r.screenToWorld(this.r.vw / 2, this.r.vh / 2);
    const d = BUILDINGS[type];
    this.placeTile = this.pointerWorld && this.lastPointerType === 'mouse' ? [tileOf(this.pointerWorld[0]) - (d.w >> 1), tileOf(this.pointerWorld[1]) - (d.h >> 1)] : [tileOf(cx) - (d.w >> 1), tileOf(cy) - (d.h >> 1)];
    this.game.ui.showPlaceConfirm(this.lastPointerType !== 'mouse');
    this.game.ui.refreshModes();
  }
  stopPlacing() {
    if (this.placing && BUILDINGS[this.placing].wall && this.w.players[this.me].ready.defense === 'wall' && this.w.players[this.me].wallCharge) {
      this.cmd({ type: 'cancelPlace', cat: 'defense' });
    }
    this.placing = null; this.placeTile = null; this.game.ui.showPlaceConfirm(false); this.game.ui.refreshModes();
  }
  setMode(m) {
    if (m && this.placing) this.stopPlacing();
    this.mode = this.mode === m ? null : m;
    this.game.ui.refreshModes();
  }
  cancelAll() {
    if (this.placing) { this.stopPlacing(); return true; }
    if (this.mode) { this.setMode(null); return true; }
    if (this.selection.size) { this.deselect(); return true; }
    return false;
  }

  unitCommand(type) {
    const units = this.selectedUnits();
    const ids = units.map((u) => u.id);
    if (type === 'deploy') {
      const b = this.selectedBuildings().filter((x) => x.owner === this.me).map((x) => x.id);
      if (this.cmd({ type: 'deploy', ids: [...ids, ...b] })) { this.game.audio.play('click'); if (b.length) this.deselect(); }
      else this.game.audio.play('error');
      return;
    }
    if (!ids.length) return;
    this.cmd({ type, ids });
    this.game.audio.play('click');
  }

  selectAllArmy() {
    const ids = this.w.units.filter((u) => u.owner === this.me && UNITS[u.type].weapon && !UNITS[u.type].harvester).map((u) => u.id);
    this.setSelection(ids);
    if (ids.length) this.ack('select');
  }
  selectSameTypeOnScreen(type) {
    const r = this.r;
    const x0 = r.cam.x, y0 = r.cam.y, x1 = x0 + r.vw / r.cam.zoom, y1 = y0 + r.vh / r.cam.zoom;
    const t = type || (this.selectedUnits()[0] || {}).type;
    if (!t) return;
    const ids = this.w.units.filter((u) => u.owner === this.me && u.type === t && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1).map((u) => u.id);
    this.setSelection(ids);
    this.ack('select');
  }
  groupKey(n, ctrl, shift) {
    if (ctrl) {
      const ids = this.selectedUnits().map((u) => u.id);
      for (const k in this.groups) this.groups[k] = this.groups[k].filter((id) => !ids.includes(id));
      this.groups[n] = ids;
      this.game.ui.flash(`Group ${n} assigned (${ids.length})`);
      this.game.ui.refreshGroups();
      return;
    }
    const ids = (this.groups[n] || []).filter((id) => this.w.get(id));
    this.groups[n] = ids;
    if (!ids.length) return;
    const now = performance.now();
    if (this.lastGroupKey.k === n && now - this.lastGroupKey.t < 400) {
      const u = this.w.get(ids[0]);
      if (u) this.r.centerOn(u.x, u.y);
    }
    this.lastGroupKey = { k: n, t: now };
    this.setSelection(ids, shift);
    this.ack('select');
  }
  centerOnBase() {
    const b = this.w.buildings.find((x) => x.owner === this.me && x.type === 'hq') || this.w.buildings.find((x) => x.owner === this.me) || this.w.units.find((u) => u.owner === this.me);
    if (b) this.r.centerOn(b.x, b.y);
  }

  boxSelect(x0, y0, x1, y1, add) {
    const [ax, ay] = this.r.screenToWorld(Math.min(x0, x1), Math.min(y0, y1));
    const [bx, by] = this.r.screenToWorld(Math.max(x0, x1), Math.max(y0, y1));
    let units = this.w.units.filter((u) => u.owner === this.me && u.x >= ax && u.x <= bx && u.y >= ay && u.y <= by);
    // Prefer combat units over harvesters when mixed.
    const combat = units.filter((u) => !UNITS[u.type].harvester);
    if (combat.length) units = combat;
    if (units.length) { this.setSelection(units.map((u) => u.id), add); this.ack('select'); }
    else if (!add) this.deselect();
  }

  // ---------- Input binding ----------
  bind() {
    const cv = this.game.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e, true));
    cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.r.setZoom(this.r.cam.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('mouseleave', () => { this.edge.x = this.edge.y = 0; this.mouseIn = false; });
    cv.addEventListener('mouseenter', () => { this.mouseIn = true; });
    this.keydown = (e) => this.onKey(e, true);
    this.keyup = (e) => this.onKey(e, false);
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }
  unbind() {
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
  }

  local(e) { const r = this.game.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  onDown(e) {
    this.game.audio.unlock();
    this.lastPointerType = e.pointerType;
    const [x, y] = this.local(e);
    this.game.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x, y, sx: x, sy: y, button: e.button, type: e.pointerType, t: performance.now(), moved: false, cam: { ...this.r.cam } });
    if (this.pointers.size === 2) {
      // start pinch
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.r.cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.dragBox = null; clearTimeout(this.lpTimer);
      for (const p of this.pointers.values()) p.moved = true;
      return;
    }
    if (e.pointerType === 'touch') {
      clearTimeout(this.lpTimer);
      const p = this.pointers.get(e.pointerId);
      if (this.boxMode) p.box = true;
      else this.lpTimer = setTimeout(() => { if (!p.moved && this.pointers.size === 1) { p.box = true; p.moved = true; this.dragBox = { x0: p.sx, y0: p.sy, x1: p.x, y1: p.y }; navigator.vibrate?.(15); } }, 420);
    }
  }

  onMove(e) {
    const [x, y] = this.local(e);
    this.lastPointerType = e.pointerType;
    const rect = this.game.canvas.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      this.pointerWorld = this.r.screenToWorld(x, y);
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      const m = 14;
      this.edge.x = inside && this.game.settings.edgeScroll ? (x < m ? -1 : x > rect.width - m ? 1 : 0) : 0;
      this.edge.y = inside && this.game.settings.edgeScroll ? (y < m ? -1 : y > rect.height - m ? 1 : 0) : 0;
      if (this.placing) {
        const d = BUILDINGS[this.placing];
        this.placeTile = [tileOf(this.pointerWorld[0]) - (d.w >> 1), tileOf(this.pointerWorld[1]) - (d.h >> 1)];
      }
      if (inside) this.updateHover();
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = x; p.y = y;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.r.setZoom(this.pinch.z * (d / Math.max(10, this.pinch.d)), mx, my);
      this.r.cam.x -= (mx - this.pinch.mx) / this.r.cam.zoom; this.r.cam.y -= (my - this.pinch.my) / this.r.cam.zoom;
      this.pinch.mx = mx; this.pinch.my = my; this.r.clampCam();
      return;
    }
    const moved = Math.hypot(x - p.sx, y - p.sy);
    const thresh = p.type === 'touch' ? 12 : 6;
    if (!p.moved && moved > thresh) { p.moved = true; clearTimeout(this.lpTimer); }
    if (!p.moved) return;
    const scheme = this.game.settings.mouseScheme;
    const panBtn = p.type === 'mouse' && (p.button === 1 || (p.button === 2 && scheme === 'classic'));
    if (p.type === 'touch' && !p.box && !this.placing) {
      this.r.cam.x = p.cam.x - (x - p.sx) / this.r.cam.zoom; this.r.cam.y = p.cam.y - (y - p.sy) / this.r.cam.zoom; this.r.clampCam();
    } else if (p.type === 'touch' && this.placing && !p.box) {
      // drag the ghost while placing
      const [wx, wy] = this.r.screenToWorld(x, y);
      const d = BUILDINGS[this.placing];
      this.placeTile = [tileOf(wx) - (d.w >> 1), tileOf(wy) - (d.h >> 1)];
    } else if (panBtn) {
      this.r.cam.x = p.cam.x - (x - p.sx) / this.r.cam.zoom; this.r.cam.y = p.cam.y - (y - p.sy) / this.r.cam.zoom; this.r.clampCam();
    } else if ((p.type === 'mouse' && p.button === 0 && !this.placing) || p.box) {
      this.dragBox = { x0: p.sx, y0: p.sy, x1: x, y1: y };
    }
  }

  onUp(e, cancelled) {
    const p = this.pointers.get(e.pointerId);
    clearTimeout(this.lpTimer);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) { this.pinch = null; for (const q of this.pointers.values()) { q.sx = q.x; q.sy = q.y; q.cam = { ...this.r.cam }; } } return; }
    if (cancelled) { this.dragBox = null; return; }
    const [x, y] = [p.x, p.y];
    if (this.dragBox) {
      const b = this.dragBox; this.dragBox = null;
      if (Math.abs(b.x1 - b.x0) > 4 || Math.abs(b.y1 - b.y0) > 4) this.boxSelect(b.x0, b.y0, b.x1, b.y1, e.shiftKey);
      return;
    }
    if (p.moved) return;
    const [wx, wy] = this.r.screenToWorld(x, y);
    const scheme = this.game.settings.mouseScheme;
    if (p.type === 'mouse' && p.button === 2) {
      if (scheme === 'modern' && !this.placing && !this.mode && this.selectedUnits().length) { this.smartAction(wx, wy, e.shiftKey, 'mouse'); return; }
      this.cancelAll();
      return;
    }
    if (p.type === 'mouse' && p.button !== 0) return;
    // double tap/click → select all of type on screen
    const now = performance.now();
    const tgt = this.entityAt(wx, wy);
    if (tgt && tgt.kind === 'unit' && tgt.owner === this.me && this.lastTap.id === tgt.id && now - this.lastTap.t < 350 && !this.placing && !this.mode) {
      this.selectSameTypeOnScreen(tgt.type); this.lastTap = { t: 0, id: 0 }; return;
    }
    this.lastTap = { t: now, id: tgt ? tgt.id : 0 };
    if (scheme === 'modern' && p.type === 'mouse' && !this.placing && !this.mode) {
      // left = select only
      if (tgt && (tgt.owner === this.me || tgt.kind === 'building' || this.w.isEnemy(this.me, tgt.owner))) this.setSelection([tgt.id], e.shiftKey);
      else if (!e.shiftKey) this.deselect();
      return;
    }
    this.smartAction(wx, wy, e.shiftKey, p.type);
  }

  updateHover() {
    if (!this.pointerWorld) return;
    const [wx, wy] = this.pointerWorld;
    const t = this.entityAt(wx, wy);
    this.hover = t ? { id: t.id } : null;
    const cv = this.game.canvas;
    let cur = 'default';
    const units = this.selectedUnits();
    if (this.placing) cur = 'crosshair';
    else if (this.mode === 'sell') cur = t && t.kind === 'building' && t.owner === this.me ? 'copy' : 'not-allowed';
    else if (this.mode === 'repair') cur = t && t.kind === 'building' && t.owner === this.me ? 'cell' : 'not-allowed';
    else if (this.mode === 'sw' || this.mode === 'attackmove') cur = 'crosshair';
    else if (t && this.w.isEnemy(this.me, t.owner) && units.length) cur = 'crosshair';
    else if (t) cur = 'pointer';
    else if (units.length) cur = 'cell';
    cv.style.cursor = cur;
  }

  onKey(e, down) {
    if (!this.game.active) return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT') return;
    const k = e.key;
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    if (e.repeat && !k.startsWith('Arrow')) return;
    const lower = k.toLowerCase();
    if (/^[1-9]$/.test(k)) { this.groupKey(Number(k), e.ctrlKey || e.metaKey, e.shiftKey); e.preventDefault(); return; }
    switch (lower) {
      case 'escape': if (!this.cancelAll()) this.game.togglePause(); break;
      case 's': this.unitCommand('stop'); break;
      case 'g': this.unitCommand('guard'); break;
      case 'd': this.unitCommand('deploy'); break;
      case 'x': this.unitCommand('scatter'); break;
      case 'a': if (this.selectedUnits().length) this.setMode('attackmove'); break;
      case 'q': this.selectAllArmy(); break;
      case 'e': this.selectSameTypeOnScreen(); break;
      case 'h': this.centerOnBase(); break;
      case ' ': if (this.lastAlert) this.r.centerOn(this.lastAlert.x, this.lastAlert.y); e.preventDefault(); break;
      case 'z': this.setMode('sell'); break;
      case 'r': this.setMode('repair'); break;
      case 'p': case 'pause': this.game.togglePause(); break;
      case '+': case '=': this.r.setZoom(this.r.cam.zoom * 1.15); break;
      case '-': case '_': this.r.setZoom(this.r.cam.zoom / 1.15); break;
      case 'tab': this.game.ui.cycleTab(e.shiftKey ? -1 : 1); e.preventDefault(); break;
      case 'f1': this.game.showHelp(); e.preventDefault(); break;
    }
  }

  update(dt) {
    const sp = (this.game.settings.scrollSpeed || 1) * 900 * dt / this.r.cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (this.mouseIn !== false && !this.pointers.size) { dx += this.edge.x; dy += this.edge.y; }
    if (dx || dy) {
      this.r.cam.x += Math.sign(dx) * sp; this.r.cam.y += Math.sign(dy) * sp; this.r.clampCam();
      if (this.pointerWorld && this.lastPointerType === 'mouse') this.updateHover();
    }
    this.cleanSelection();
  }
}
