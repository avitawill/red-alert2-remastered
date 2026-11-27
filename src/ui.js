// In-game HUD: sidebar, build palette, selection panel, command bar, messages, tooltips.
import { UNITS, BUILDINGS, CATEGORIES, FACTIONS, RANK_NAMES } from './config.js';
import { defOf } from './world.js';
import { drawIcon } from './sprites.js';
import { formatTime } from './util.js';

const $ = (s) => document.querySelector(s);

const VOICE = {
  ready: 'Structure ready.',
  unit_ready: 'Reinforcements ready.',
  funds: 'Insufficient funds.',
  low_power: 'Power levels critical.',
  power_restored: 'Power restored.',
  base_attack: 'Our base is under fire.',
  harv_attack: 'Harvester under fire.',
  unit_lost: "We've lost a unit.",
  bld_lost: 'Structure destroyed.',
  captured: 'Structure captured.',
  bld_captured: 'A structure was seized by enemy engineers.',
  promoted: 'Unit promoted.',
  cant_deploy: 'Unable to deploy here.',
  sold: 'Structure sold.',
  demo: 'Charge set.',
  eng_repair: 'Structure restored.',
  sw_detected: 'Warning. Enemy superweapon structure detected.',
  sw_enemy_ready: 'Warning. Enemy superweapon is armed.',
};

export class UI {
  constructor(game) {
    this.game = game;
    this.tab = 'building';
    this.msgs = [];
    this.btns = new Map();
    this.iconCache = new Map();
    this.lastSelKey = '';
    this.buildEls();
  }
  get w() { return this.game.world; }
  get me() { return this.game.me; }
  get ctl() { return this.game.controller; }

  buildEls() {
    const tabs = $('#sb-tabs');
    tabs.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'tab'; b.dataset.cat = c.id;
      b.innerHTML = `<span class="tab-l">${c.label}</span><span class="tab-s">${c.short}</span><i class="tab-prog"></i>`;
      b.onclick = () => { this.setTab(c.id); this.game.audio.play('click'); };
      tabs.appendChild(b);
    }
    this.setTab('building');
    $('#btn-sell').onclick = () => this.ctl.setMode('sell');
    $('#btn-repair').onclick = () => this.ctl.setMode('repair');
    $('#btn-sw').onclick = () => { const p = this.w.players[this.me]; if (p.sw.ready) this.ctl.setMode('sw'); else this.game.audio.play('error'); };
    $('#btn-menu').onclick = () => this.game.togglePause();
    const cb = $('#cmdbar');
    cb.querySelectorAll('[data-cmd]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const c = b.dataset.cmd;
        this.game.audio.unlock();
        if (c === 'deselect') this.ctl.deselect();
        else if (c === 'army') this.ctl.selectAllArmy();
        else if (c === 'same') this.ctl.selectSameTypeOnScreen();
        else if (c === 'attackmove') this.ctl.setMode('attackmove');
        else if (c === 'box') { this.ctl.boxMode = !this.ctl.boxMode; b.classList.toggle('on', this.ctl.boxMode); }
        else if (c === 'base') this.ctl.centerOnBase();
        else this.ctl.unitCommand(c);
      };
    });
    const gb = $('#groups');
    gb.innerHTML = '';
    for (let n = 1; n <= 5; n++) {
      const b = document.createElement('button');
      b.className = 'grp'; b.textContent = n; b.title = `Group ${n} — tap to select, hold to assign`;
      let t = null, held = false;
      b.onpointerdown = (e) => { e.stopPropagation(); held = false; t = setTimeout(() => { held = true; this.ctl.groupKey(n, true); navigator.vibrate?.(20); }, 500); };
      b.onpointerup = (e) => { e.stopPropagation(); clearTimeout(t); if (!held) this.ctl.groupKey(n, e.ctrlKey || e.metaKey, e.shiftKey); };
      b.onpointerleave = () => clearTimeout(t);
      b.oncontextmenu = (e) => e.preventDefault();
      gb.appendChild(b);
    }
    $('#place-ok').onclick = (e) => { e.stopPropagation(); this.ctl.confirmPlace(); };
    $('#place-cancel').onclick = (e) => { e.stopPropagation(); this.ctl.stopPlacing(); };
    $('#zoom-in').onclick = () => this.game.renderer.setZoom(this.game.renderer.cam.zoom * 1.25);
    $('#zoom-out').onclick = () => this.game.renderer.setZoom(this.game.renderer.cam.zoom / 1.25);

    const mm = $('#minimap');
    const mmAct = (e, cmd) => {
      const r = mm.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (mm.width / r.width), sy = (e.clientY - r.top) * (mm.height / r.height);
      const p = this.game.renderer.minimapToWorld(sx, sy);
      if (!p) return;
      if (cmd) this.ctl.smartAction(p[0], p[1], false, 'minimap');
      else this.game.renderer.centerOn(p[0], p[1]);
    };
    let mmDown = false;
    mm.onpointerdown = (e) => { e.preventDefault(); if (!this.minimapOnline) return; if (e.button === 2 || (this.ctl.selectedUnits().length && e.pointerType !== 'mouse' && this.ctl.mode)) { mmAct(e, true); return; } mmDown = true; mm.setPointerCapture(e.pointerId); mmAct(e); };
    mm.onpointermove = (e) => { if (mmDown) mmAct(e); };
    mm.onpointerup = () => { mmDown = false; };
    mm.oncontextmenu = (e) => e.preventDefault();
    this.tooltip = $('#tooltip');
  }

  setTab(cat) {
    this.tab = cat;
    document.querySelectorAll('#sb-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.cat === cat));
    this.rebuildGrid();
  }
  cycleTab(d) {
    const ids = CATEGORIES.map((c) => c.id);
    this.setTab(ids[(ids.indexOf(this.tab) + d + ids.length) % ids.length]);
  }

  typesFor(cat) {
    const p = this.w.players[this.me];
    const src = cat === 'infantry' || cat === 'vehicle' ? UNITS : BUILDINGS;
    const hqOrigins = new Set(this.w.buildings.filter((b) => b.owner === this.me && !b.dead).map((b) => b.origin));
    return Object.keys(src).filter((k) => {
      const d = src[k];
      if (d.cat !== cat || d.buildable === false) return false;
      if (d.faction && d.faction !== p.faction && !hqOrigins.has(d.faction)) return false;
      if (d.superweapon && this.w.setup.superweapons === false) return false;
      return true;
    });
  }

  icon(type) {
    const key = type + this.w.players[this.me].color;
    if (this.iconCache.has(key)) return this.iconCache.get(key);
    const c = document.createElement('canvas');
    c.width = 128; c.height = 96;
    drawIcon(c, type, this.w.players[this.me].color);
    const url = c.toDataURL();
    this.iconCache.set(key, url);
    return url;
  }

  rebuildGrid() {
    const grid = $('#build-grid');
    grid.innerHTML = '';
    this.btns.clear();
    for (const type of this.typesFor(this.tab)) {
      const d = defOf(type);
      const b = document.createElement('button');
      b.className = 'bi';
      b.innerHTML = `<img alt="" src="${this.icon(type)}"><span class="bi-name">${d.name}</span><span class="bi-cost">$${d.cost}</span><i class="bi-prog"></i><b class="bi-count"></b><em class="bi-state"></em><span class="bi-lock">🔒</span>`;
      let lpT = null, held = false;
      b.onpointerdown = (e) => {
        this.game.audio.unlock();
        held = false;
        if (e.pointerType !== 'mouse') lpT = setTimeout(() => { held = true; this.itemAlt(type); navigator.vibrate?.(20); }, 450);
      };
      b.onpointerup = (e) => {
        clearTimeout(lpT);
        if (held) return;
        if (e.button === 2) this.itemAlt(type); else this.itemClick(type, e.shiftKey ? 5 : 1);
      };
      b.onpointerleave = () => { clearTimeout(lpT); this.hideTip(); };
      b.oncontextmenu = (e) => e.preventDefault();
      b.onmouseenter = () => this.showTip(b, type);
      grid.appendChild(b);
      this.btns.set(type, b);
    }
    this.updateGrid(true);
  }

  itemClick(type, count) {
    const p = this.w.players[this.me];
    const d = defOf(type);
    const cat = d.cat;
    if ((cat === 'building' || cat === 'defense') && p.ready[cat] === type) { this.ctl.startPlacing(cat, type); this.game.audio.play('click'); return; }
    const it = p.queues[cat].find((q) => q.type === type);
    if (it && it.paused) { this.w.command(this.me, { type: 'pause', item: type }); this.game.audio.play('click'); return; }
    if (this.w.command(this.me, { type: 'queue', item: type, count })) this.game.audio.play('click');
    else {
      this.game.audio.play('error');
      if (!this.w.canBuild(this.me, type)) {
        const miss = this.w.missingReqs(this.me, type);
        this.flash(miss.length ? `Requires: ${miss.join(', ')}` : d.unique ? 'Limit reached' : 'Unavailable');
      } else this.flash('Production slot busy');
    }
  }
  itemAlt(type) {
    const p = this.w.players[this.me];
    const d = defOf(type);
    const it = p.queues[d.cat].find((q) => q.type === type);
    if (p.ready[d.cat] === type || !it || it.paused || it.progress === 0) {
      if (this.w.command(this.me, { type: 'cancel', item: type })) { this.game.audio.play('click'); if (this.ctl.placing === type) this.ctl.stopPlacing(); }
    } else { this.w.command(this.me, { type: 'pause', item: type }); this.game.audio.play('click'); }
  }

  showTip(el, type) {
    if (matchMedia('(hover: none)').matches) return;
    const d = defOf(type);
    const w = this.w;
    const miss = w.missingReqs(this.me, type);
    const pw = d.power ? `<span class="${d.power > 0 ? 'pos' : 'neg'}">Power ${d.power > 0 ? '+' : ''}${d.power}</span>` : '';
    const stats = d.weapon ? `<div class="tt-stats">Damage ${d.weapon.dmg} · Range ${d.weapon.range} · Reload ${d.weapon.rof}s</div>` : '';
    this.tooltip.innerHTML = `<b>${d.name}</b> <span class="tt-cost">$${d.cost}</span> ${pw}<div>${d.desc || ''}</div>${stats}<div class="tt-hp">Armor: ${d.armor || 'structure'} · HP ${d.hp}</div>${miss.length ? `<div class="tt-req">Requires: ${miss.join(', ')}</div>` : ''}<div class="tt-keys">Click: build${d.cat === 'infantry' || d.cat === 'vehicle' ? ' · Shift+Click: ×5' : ''} · Right-click: hold / cancel</div>`;
    const r = el.getBoundingClientRect();
    this.tooltip.style.display = 'block';
    const tw = this.tooltip.offsetWidth;
    this.tooltip.style.left = Math.max(4, r.left - tw - 8) + 'px';
    this.tooltip.style.top = Math.max(4, Math.min(window.innerHeight - this.tooltip.offsetHeight - 4, r.top)) + 'px';
  }
  hideTip() { this.tooltip.style.display = 'none'; }

  updateGrid(force) {
    const w = this.w, p = w.players[this.me];
    const types = this.typesFor(this.tab);
    if (types.length !== this.btns.size || types.some((t) => !this.btns.has(t))) { if (!force) { this.rebuildGrid(); return; } }
    for (const [type, b] of this.btns) {
      const d = defOf(type);
      const cat = d.cat;
      const avail = w.canBuild(this.me, type);
      const q = p.queues[cat];
      const items = q.filter((x) => x.type === type);
      const front = q[0] && q[0].type === type ? q[0] : null;
      const ready = p.ready[cat] === type;
      const inProd = !!items.length || ready;
      b.classList.toggle('locked', !avail && !inProd);
      b.classList.toggle('busy', !inProd && (cat === 'building' || cat === 'defense') && (q.length > 0 || !!p.ready[cat]));
      b.classList.toggle('ready', ready);
      b.classList.toggle('placing', this.ctl.placing === type);
      const prog = ready ? 1 : front ? front.progress : 0;
      b.querySelector('.bi-prog').style.setProperty('--p', `${(1 - prog) * 360}deg`);
      b.querySelector('.bi-prog').style.display = inProd && !ready ? 'block' : 'none';
      b.querySelector('.bi-count').textContent = items.length > 1 ? items.length : '';
      const paused = items.some((x) => x.paused);
      b.querySelector('.bi-state').textContent = ready ? 'READY' : paused ? 'ON HOLD' : '';
    }
    // tab progress indicators
    document.querySelectorAll('#sb-tabs .tab').forEach((t) => {
      const cat = t.dataset.cat;
      const q = p.queues[cat];
      const ready = p.ready[cat];
      const pr = t.querySelector('.tab-prog');
      pr.style.width = ready ? '100%' : q.length ? `${q[0].progress * 100}%` : '0';
      t.classList.toggle('flash', !!ready);
      t.classList.toggle('dim', !w.producers(this.me, cat).length);
    });
  }

  update() {
    const w = this.w, p = w.players[this.me];
    $('#credits').textContent = `$${Math.floor(p.credits).toLocaleString()}`;
    const maxP = Math.max(p.powerProd, p.powerUse, 100);
    $('#power-fill').style.height = `${(p.powerProd / maxP) * 100}%`;
    $('#power-use').style.bottom = `${(p.powerUse / maxP) * 100}%`;
    const pw = $('#power');
    pw.classList.toggle('low', p.lowPower);
    pw.title = `Power: ${p.powerProd} produced / ${p.powerUse} used`;
    $('#power-txt').textContent = `${p.powerProd - p.powerUse >= 0 ? '+' : ''}${p.powerProd - p.powerUse}`;
    $('#power-txt').classList.toggle('low', p.lowPower);
    const swb = $('#btn-sw');
    if (p.sw.type) {
      swb.hidden = false;
      swb.classList.toggle('ready', p.sw.ready);
      swb.querySelector('span').textContent = p.sw.ready ? 'READY' : formatTime(p.sw.max - p.sw.charge);
      swb.querySelector('i').style.width = `${(p.sw.charge / p.sw.max) * 100}%`;
    } else swb.hidden = true;
    $('#clock').textContent = formatTime(w.time);
    this.updateGrid();
    this.updateSelPanel();
    // enemy superweapon timers
    const timers = [];
    for (const o of w.players) {
      if (o.neutral || o.defeated || !o.sw.type || o.id === this.me) continue;
      timers.push(`<div class="swt" style="color:${o.color}">${o.name}: ${o.sw.ready ? 'ARMED' : formatTime(o.sw.max - o.sw.charge)}</div>`);
    }
    if (p.sw.type) timers.unshift(`<div class="swt" style="color:${p.color}">${p.sw.type === 'orbital' ? 'Orbital Lance' : 'Seismic Silo'}: ${p.sw.ready ? 'READY' : formatTime(p.sw.max - p.sw.charge)}</div>`);
    $('#sw-timers').innerHTML = timers.join('');
    // messages
    const now = performance.now();
    this.msgs = this.msgs.filter((m) => now - m.t < 5000);
    const html = this.msgs.map((m) => `<div class="msg" style="opacity:${Math.min(1, (5000 - (now - m.t)) / 800)}">${m.txt}</div>`).join('');
    if (html !== this.lastMsgHtml) { $('#messages').innerHTML = html; this.lastMsgHtml = html; }
    const hasUnits = this.ctl.selectedUnits().length > 0;
    $('#cmdbar').classList.toggle('has-units', hasUnits);
    $('#cmdbar').classList.toggle('has-sel', this.ctl.selection.size > 0);
    if (this.game.settings.showFps) $('#fps').textContent = `${this.game.fps} fps`;
  }

  selectionChanged() { this.lastSelKey = ''; this.updateSelPanel(); }

  updateSelPanel() {
    const w = this.w;
    const sel = [...this.ctl.selection].map((id) => w.get(id)).filter(Boolean);
    const el = $('#sel-info');
    if (!sel.length) { if (this.lastSelKey !== 'none') { el.innerHTML = ''; el.hidden = true; this.lastSelKey = 'none'; } return; }
    el.hidden = false;
    if (sel.length === 1) {
      const e = sel[0];
      const d = defOf(e.type);
      const mine = e.owner === this.me;
      const key = `1:${e.id}:${Math.ceil(e.hp / e.maxHp * 20)}:${e.rank || 0}:${e.repairing}:${e.primary}:${Math.floor((e.cargo || 0) / 50)}`;
      if (key === this.lastSelKey) return;
      this.lastSelKey = key;
      const owner = w.players[e.owner];
      let actions = '';
      if (mine && e.kind === 'building') {
        if (d.producer && d.producer !== 'building' || (e.type === 'hq' && w.producers(this.me, 'building').length > 1)) actions += `<button data-a="primary" class="${e.primary ? 'on' : ''}">Primary</button>`;
        actions += `<button data-a="repair" class="${e.repairing ? 'on' : ''}">Repair</button><button data-a="sell">Sell</button>`;
        if (d.undeploysTo) actions += `<button data-a="deploy">Pack Up</button>`;
      }
      if (mine && e.kind === 'unit' && UNITS[e.type].deploysTo) actions += `<button data-a="deploy">Deploy</button>`;
      const extra = e.kind === 'unit' && UNITS[e.type].harvester ? `<div class="si-sub">Cargo $${Math.round(e.cargo)} / ${UNITS[e.type].capacity}</div>` : e.kind === 'unit' && d.weapon ? `<div class="si-sub">${RANK_NAMES[e.rank]}${e.rank ? ' ' + '★'.repeat(e.rank) : ''}</div>` : d.power ? `<div class="si-sub">Power ${d.power > 0 ? '+' : ''}${d.power}</div>` : '';
      el.innerHTML = `<img src="${this.icon(e.type)}" alt=""><div class="si-txt"><b>${d.name}</b><div class="si-owner" style="color:${owner.color}">${owner.name}</div><div class="si-hp"><i style="width:${(e.hp / e.maxHp) * 100}%;background:${e.hp / e.maxHp > 0.5 ? '#4cff4c' : e.hp / e.maxHp > 0.25 ? '#ffd400' : '#ff3b3b'}"></i></div>${extra}</div><div class="si-act">${actions}</div>`;
      el.querySelectorAll('[data-a]').forEach((b) => {
        b.onclick = () => {
          const a = b.dataset.a;
          if (a === 'primary') w.command(this.me, { type: 'primary', target: e.id });
          if (a === 'repair') w.command(this.me, { type: 'repair', target: e.id });
          if (a === 'sell') { w.command(this.me, { type: 'sell', target: e.id }); this.game.audio.play('cash'); this.ctl.deselect(); }
          if (a === 'deploy') this.ctl.unitCommand('deploy');
          this.game.audio.play('click');
          this.lastSelKey = '';
        };
      });
    } else {
      const counts = {};
      for (const e of sel) counts[e.type] = (counts[e.type] || 0) + 1;
      const key = 'n:' + JSON.stringify(counts);
      if (key === this.lastSelKey) return;
      this.lastSelKey = key;
      el.innerHTML = `<div class="si-multi">${Object.entries(counts).map(([t, n]) => `<button class="si-chip" data-t="${t}" title="${defOf(t).name}"><img src="${this.icon(t)}" alt=""><b>${n}</b></button>`).join('')}</div>`;
      el.querySelectorAll('.si-chip').forEach((c) => {
        c.onclick = () => { const t = c.dataset.t; this.ctl.setSelection(sel.filter((e) => e.type === t).map((e) => e.id)); };
      });
    }
  }

  refreshModes() {
    $('#btn-sell').classList.toggle('on', this.ctl.mode === 'sell');
    $('#btn-repair').classList.toggle('on', this.ctl.mode === 'repair');
    $('#btn-sw').classList.toggle('on', this.ctl.mode === 'sw');
    document.querySelector('[data-cmd="attackmove"]').classList.toggle('on', this.ctl.mode === 'attackmove');
    const hint = $('#mode-hint');
    const m = this.ctl.placing ? (matchMedia('(hover: none)').matches ? 'Tap to position · Tap again or ✓ to build' : 'Click to place · Right-click to cancel') :
      this.ctl.mode === 'sell' ? 'Select a structure to sell' : this.ctl.mode === 'repair' ? 'Select a structure to repair' :
        this.ctl.mode === 'sw' ? 'Select a target for the superweapon' : this.ctl.mode === 'attackmove' ? 'Select attack-move destination' : '';
    hint.textContent = m; hint.hidden = !m;
  }
  refreshGroups() {
    document.querySelectorAll('#groups .grp').forEach((b, i) => b.classList.toggle('set', !!(this.ctl.groups[i + 1] || []).length));
  }
  showPlaceConfirm(show) { $('#place-confirm').hidden = !show; }

  flash(txt) {
    const now = performance.now();
    const dup = this.msgs.find((m) => m.txt === txt);
    if (dup) { dup.t = now; return; }
    this.msgs.push({ txt, t: now });
    if (this.msgs.length > 3) this.msgs.shift();
  }

  ingest(events) {
    const me = this.me, a = this.game.audio, w = this.w, r = this.game.renderer;
    const view = { cx: r.cam.x + r.vw / r.cam.zoom / 2, cy: r.cam.y + r.vh / r.cam.zoom / 2, r: Math.max(r.vw, r.vh) / r.cam.zoom / 2 };
    for (const e of events) {
      if (e.t === 'snd') { if (w.visibleTo(me, e.x, e.y) || !w.players[me].vis) a.playAt(e.snd, e.x, e.y, view); continue; }
      if (e.t === 'fx') {
        if ((e.kind === 'explode' || e.kind === 'bld_explode') && (w.visibleTo(me, e.x, e.y))) a.playAt(e.kind === 'bld_explode' ? 'boom_big' : 'boom', e.x, e.y, view);
        continue;
      }
      if (e.p !== undefined && e.p !== me) {
        if (e.t === 'defeated') { this.flash(`${w.players[e.p].name} has been eliminated.`); a.say(w.isEnemy(me, e.p) ? 'Enemy commander eliminated.' : 'An allied commander has fallen.', 'def' + e.p, 1); }
        continue;
      }
      const v = VOICE[e.t];
      switch (e.t) {
        case 'ready': this.flash(`${defOf(e.item).name} ready to place`); a.play('ready'); a.say(v, e.t, 2); break;
        case 'unit_ready': if (!e.free) { a.say(v, e.t, 3); } break;
        case 'funds': this.flash('Insufficient funds'); a.say(v, e.t, 8); break;
        case 'low_power': this.flash('Low power — production slowed, defenses offline'); a.play('alert'); a.say(v, e.t, 10); break;
        case 'power_restored': this.flash('Power restored'); a.say(v, e.t, 10); break;
        case 'base_attack': case 'harv_attack':
          this.flash(e.t === 'base_attack' ? 'Base under attack! (Space to view)' : 'Harvester under attack!'); a.play('alert'); a.say(v, e.t, 15);
          this.ctl.lastAlert = { x: e.x, y: e.y }; r.pings = r.pings || []; r.pings.push({ x: e.x, y: e.y, life: 3, max: 3 });
          break;
        case 'unit_lost': if (!e.inf || Math.random() < 0.3) a.say(v, e.t, 8); break;
        case 'bld_lost': this.flash(`${defOf(e.item).name} destroyed`); a.say(v, e.t, 5); break;
        case 'captured': this.flash(`${defOf(e.item).name} captured`); a.say(v, e.t, 3); break;
        case 'bld_captured': a.say(v, e.t, 5); this.ctl.lastAlert = { x: e.x, y: e.y }; break;
        case 'promoted': a.play('promote'); a.say(v, e.t, 6); break;
        case 'cant_deploy': this.flash('Cannot deploy here — need a clear 3×3 area'); a.play('error'); a.say(v, e.t, 3); break;
        case 'sold': a.play('cash'); a.say(v, e.t, 2); break;
        case 'demo': a.say(v, e.t, 2); break;
        case 'eng_repair': a.say(v, e.t, 2); break;
        case 'placed': a.play('place'); break;
        case 'crate': {
          a.play('crate');
          const msg = { money: `Bonus: $${e.amt}`, heal: 'Bonus: units repaired', promote: 'Bonus: unit promoted', reveal: 'Bonus: map revealed', unit: 'Bonus: reinforcements' }[e.kind];
          this.flash(msg); a.say(msg.replace('Bonus: ', '').replace('$', '') , 'crate', 2);
          break;
        }
        case 'sw_ready': this.flash(`${e.kind === 'orbital' ? 'Orbital Lance' : 'Seismic warhead'} ready!`); a.play('ready'); a.say(e.kind === 'orbital' ? 'Orbital Lance ready.' : 'Seismic warhead ready.', e.t, 5); break;
        case 'sw_enemy_ready': this.flash('Warning: enemy superweapon armed'); a.say(v, e.t, 20); break;
        case 'sw_detected': this.flash('Warning: enemy superweapon detected'); a.say(v, e.t, 20); break;
        case 'sw_launch':
          if (e.own) { a.say('Strike authorized.', 'swl', 2); }
          else { this.flash('WARNING: superweapon launch detected!'); a.play('alert'); a.say('Warning. Superweapon launch detected.', 'swl', 2); this.ctl.lastAlert = { x: e.x, y: e.y }; }
          break;
        case 'defeated': break;
      }
      if (e.t === 'sw_launch' && e.p === me && !e.own) { /* handled */ }
    }
    if (r.pings) { for (const p of r.pings) p.life -= 1 / 60; r.pings = r.pings.filter((p) => p.life > 0); }
  }
}
