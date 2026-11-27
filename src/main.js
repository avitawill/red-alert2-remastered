// Bootstrap: menus, settings, skirmish setup, game loop, save/load, PWA.
import { DT, FACTIONS, PLAYER_COLORS, DIFFICULTY, UNITS, BUILDINGS, TILE } from './config.js';
import { World } from './world.js';
import { updateAI } from './ai.js';
import { Renderer } from './render.js';
import { Controller } from './controller.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { generateMap, T } from './map.js';
import { drawIcon } from './sprites.js';
import { formatTime } from './util.js';

const $ = (s) => document.querySelector(s);
const SAVE_KEY = 'ironmeridian.save';
const SET_KEY = 'ironmeridian.settings';
const SETUP_KEY = 'ironmeridian.setup';

const defaults = { sfx: 0.7, music: 0.45, voice: true, unitVoices: false, edgeScroll: true, scrollSpeed: 1, mouseScheme: 'classic', ui: 1, showFps: false };
let settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };

const audio = new Audio(settings);
const game = {
  world: null, renderer: null, controller: null, ui: null, audio, settings, me: 0, active: false, paused: false,
  canvas: $('#view'), fps: 0, speed: 1,
  togglePause, showHelp: () => { pause(true); showScreen('help'); helpReturn = 'pause'; },
};
window.__game = game; // debugging / automated tests

// ---------------- Screens ----------------
let helpReturn = 'main', settingsReturn = 'main';
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `scr-${id}`));
  $('#menu').hidden = false;
  $('#menu').classList.toggle('overlay', game.active);
  if (id === 'main') $('#btn-continue').hidden = !hasSave();
  if (id === 'skirmish') renderSlots();
  if (id === 'intel') renderIntel();
}
function hideMenu() { $('#menu').hidden = true; }
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => { audio.unlock(); audio.play('click'); showScreen(b.dataset.go); if (b.dataset.go === 'settings') settingsReturn = 'main'; if (b.dataset.go === 'help') helpReturn = 'main'; }));
$('#help-back').onclick = () => showScreen(helpReturn);
$('#settings-back').onclick = () => showScreen(settingsReturn);

// ---------------- Settings ----------------
function bindSettings() {
  const bind = (sel, key, type = 'value', conv = (v) => v) => {
    const el = $(sel);
    if (type === 'checked') el.checked = !!settings[key]; else el.value = settings[key];
    el.oninput = el.onchange = () => {
      settings[key] = conv(type === 'checked' ? el.checked : el.value);
      saveSettings(); audio.applyVolumes(); applyUiScale();
      if (key === 'music') { if (settings.music > 0 && game.active) audio.startMusic(); }
    };
  };
  bind('#set-sfx', 'sfx', 'value', Number); bind('#set-music', 'music', 'value', Number);
  bind('#set-voice', 'voice', 'checked'); bind('#set-unitvoices', 'unitVoices', 'checked');
  bind('#set-edge', 'edgeScroll', 'checked'); bind('#set-scroll', 'scrollSpeed', 'value', Number);
  bind('#set-mouse', 'mouseScheme'); bind('#set-ui', 'ui', 'value', Number); bind('#set-fps', 'showFps', 'checked');
}
function applyUiScale() {
  document.documentElement.style.setProperty('--ui', settings.ui);
  if (game.renderer) requestAnimationFrame(() => game.renderer.resize());
}
bindSettings(); applyUiScale();

// ---------------- Skirmish setup ----------------
const NAMES = ['Vasquez', 'Okonkwo', 'Lindqvist', 'Tanaka', 'Moreau', 'Haddad', 'Kowalski', 'Reyes'];
let setup;
try { setup = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null'); } catch { setup = null; }
if (!setup || !setup.players) {
  setup = {
    players: [
      { name: 'Commander', faction: 'accord', color: PLAYER_COLORS[0].hex, ai: false, team: 0 },
      { name: 'Gen. Okonkwo', faction: 'dominion', color: PLAYER_COLORS[1].hex, ai: true, difficulty: 'normal', team: 1 },
    ],
    size: 96, credits: 10000, startUnits: 'crawler', fog: true, superweapons: true, crates: true, speed: 1,
  };
}
setup.seed = 1 + Math.floor(Math.random() * 999998);

function renderSlots() {
  const box = $('#slots');
  box.innerHTML = '';
  setup.players.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'slot';
    const facOpts = Object.entries(FACTIONS).map(([k, f]) => `<option value="${k}" ${p.faction === k ? 'selected' : ''}>${f.name}</option>`).join('');
    const diffOpts = Object.entries(DIFFICULTY).map(([k, d]) => `<option value="${k}" ${p.difficulty === k ? 'selected' : ''}>${d.label}</option>`).join('');
    const teamOpts = [0, 1, 2, 3].map((t) => `<option value="${t}" ${p.team === t ? 'selected' : ''}>Team ${t + 1}</option>`).join('');
    row.innerHTML = `
      ${p.ai ? `<span class="nm">${p.name}</span>` : `<input class="nm" type="text" maxlength="16" value="${p.name.replace(/"/g, '')}">`}
      <select class="fac">${facOpts}</select>
      ${p.ai ? `<select class="diff">${diffOpts}</select>` : '<span class="diff-ph"></span>'}
      <select class="team">${teamOpts}</select>
      <span class="row"><button class="sw" style="background:${p.color}" title="Change color"></button>${p.ai && setup.players.length > 2 ? '<button class="rm" title="Remove">✕</button>' : ''}</span>
      <div class="faction-desc">${FACTIONS[p.faction].desc}</div>`;
    const nm = row.querySelector('input.nm');
    if (nm) nm.oninput = () => { p.name = nm.value || 'Commander'; };
    row.querySelector('.fac').onchange = (e) => { p.faction = e.target.value; renderSlots(); };
    const df = row.querySelector('.diff'); if (df) df.onchange = (e) => { p.difficulty = e.target.value; };
    row.querySelector('.team').onchange = (e) => { p.team = Number(e.target.value); };
    row.querySelector('.sw').onclick = () => {
      const used = new Set(setup.players.map((q) => q.color));
      let k = PLAYER_COLORS.findIndex((c) => c.hex === p.color);
      for (let n = 0; n < PLAYER_COLORS.length; n++) { k = (k + 1) % PLAYER_COLORS.length; if (!used.has(PLAYER_COLORS[k].hex)) break; }
      p.color = PLAYER_COLORS[k].hex; renderSlots();
    };
    const rm = row.querySelector('.rm'); if (rm) rm.onclick = () => { setup.players.splice(i, 1); renderSlots(); };
    box.appendChild(row);
  });
  $('#add-ai').hidden = setup.players.length >= 4;
  $('#opt-size').value = setup.size; $('#opt-credits').value = setup.credits; $('#opt-start').value = setup.startUnits;
  $('#opt-fog').checked = setup.fog; $('#opt-sw').checked = setup.superweapons; $('#opt-crates').checked = setup.crates;
  $('#opt-speed').value = String(setup.speed || 1);
  $('#opt-seed').value = setup.seed;
  drawPreview();
}
$('#add-ai').onclick = () => {
  if (setup.players.length >= 4) return;
  const used = new Set(setup.players.map((q) => q.color));
  const col = PLAYER_COLORS.find((c) => !used.has(c.hex)).hex;
  const nm = NAMES.find((n) => !setup.players.some((q) => q.name.includes(n))) || 'AI';
  setup.players.push({ name: `Gen. ${nm}`, faction: Math.random() < 0.5 ? 'accord' : 'dominion', color: col, ai: true, difficulty: 'normal', team: setup.players.length });
  renderSlots();
};
$('#opt-size').onchange = (e) => { setup.size = Number(e.target.value); drawPreview(); };
$('#opt-credits').onchange = (e) => { setup.credits = Number(e.target.value); };
$('#opt-start').onchange = (e) => { setup.startUnits = e.target.value; };
$('#opt-speed').onchange = (e) => { setup.speed = Number(e.target.value); };
$('#opt-fog').onchange = (e) => { setup.fog = e.target.checked; };
$('#opt-sw').onchange = (e) => { setup.superweapons = e.target.checked; };
$('#opt-crates').onchange = (e) => { setup.crates = e.target.checked; };
$('#opt-seed').onchange = (e) => { setup.seed = Math.max(1, Number(e.target.value) || 1); drawPreview(); };
$('#reseed').onclick = () => { setup.seed = 1 + Math.floor(Math.random() * 999998); $('#opt-seed').value = setup.seed; drawPreview(); };

const PREV_COL = { [T.GRASS]: [88, 117, 58], [T.DIRT]: [125, 106, 70], [T.SAND]: [187, 166, 116], [T.WATER]: [40, 84, 115], [T.ROCK]: [93, 90, 85], [T.TREE]: [52, 82, 34], [T.SPIRE]: [200, 200, 200] };
function drawPreview() {
  const { map, starts } = generateMap(setup.seed, setup.size, setup.players.length);
  const c = $('#map-preview');
  c.width = map.w; c.height = map.h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) {
    let col = PREV_COL[map.terrain[i]];
    if (map.ore[i]) col = map.oreKind[i] === 2 ? [95, 208, 255] : [240, 178, 51];
    img.data.set([...col, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  starts.forEach((s) => { ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 2, s.y - 2, 5, 5); });
}

$('#btn-start').onclick = () => {
  audio.unlock(); audio.play('click');
  if (setup.players.filter((p) => !p.ai).length !== 1) return;
  const teams = new Set(setup.players.map((p) => p.team));
  if (teams.size < 2) { alert('All commanders are on the same team — put at least one opponent on another team.'); return; }
  try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* ignore */ }
  const s = JSON.parse(JSON.stringify(setup));
  startGame(new World(s));
};

// ---------------- Field manual ----------------
function renderIntel() {
  const box = $('#intel');
  if (box.dataset.done) return;
  box.dataset.done = '1';
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const card = (k, d) => {
    drawIcon(c, k, d.faction === 'dominion' ? '#e8553a' : '#3d9cf0');
    const fac = d.faction ? FACTIONS[d.faction].short + ' only' : 'Both factions';
    const w = d.weapon ? `Dmg ${d.weapon.dmg} · Rng ${d.weapon.range}` : '';
    const pw = d.power ? ` · Power ${d.power > 0 ? '+' : ''}${d.power}` : '';
    return `<div class="card"><img src="${c.toDataURL()}" alt=""><div><b>${d.name}</b><div class="meta">$${d.cost} · HP ${d.hp}${pw}</div><div class="fx">${fac}${w ? ' · ' + w : ''}</div><div>${d.desc}</div></div></div>`;
  };
  let html = '<h3>Factions</h3>' + Object.values(FACTIONS).map((f) => `<div class="card"><div><b>${f.name}</b><div>${f.desc}</div></div></div>`).join('');
  html += '<h3>Infantry</h3>' + Object.entries(UNITS).filter(([, d]) => d.cat === 'infantry').map(([k, d]) => card(k, d)).join('');
  html += '<h3>Vehicles</h3>' + Object.entries(UNITS).filter(([, d]) => d.cat === 'vehicle').map(([k, d]) => card(k, d)).join('');
  html += '<h3>Structures</h3>' + Object.entries(BUILDINGS).filter(([, d]) => d.cat === 'building').map(([k, d]) => card(k, d)).join('');
  html += '<h3>Defenses</h3>' + Object.entries(BUILDINGS).filter(([, d]) => d.cat === 'defense').map(([k, d]) => card(k, d)).join('');
  box.innerHTML = html;
}

// ---------------- Game lifecycle ----------------
let rafId = 0, acc = 0, last = 0, frameCount = 0, fpsT = 0, uiT = 0, mmT = 0, ended = false;
const pending = [];

function startGame(world) {
  stopGame();
  game.world = world;
  game.me = world.players.findIndex((p) => !p.ai && !p.neutral);
  game.speed = world.setup.speed || 1;
  $('#game').hidden = false;
  document.body.classList.add('in-game');
  game.renderer = new Renderer(game.canvas, world, game.me);
  if (game.controller) game.controller.unbind();
  game.controller = new Controller(game);
  game.ui = new UI(game);
  game.active = true; game.paused = false; ended = false;
  hideMenu();
  const me = world.players[game.me];
  const start = world.units.find((u) => u.owner === game.me) || world.buildings.find((b) => b.owner === game.me);
  game.renderer.setZoom(matchMedia('(pointer: coarse)').matches ? 0.9 : 1);
  if (start) game.renderer.centerOn(start.x, start.y);
  const crawler = world.units.find((u) => u.owner === game.me && u.type === 'crawler');
  if (crawler && world.time < 1) { game.controller.setSelection([crawler.id]); game.ui.flash('Tap the Base Crawler again (or press D) to deploy your Command Yard'); }
  audio.unlock();
  if (settings.music > 0) audio.startMusic();
  audio.say(`Welcome, Commander. ${FACTIONS[me.faction].name} forces standing by.`, 'welcome', 1);
  tryFullscreen();
  last = performance.now();
  rafId = requestAnimationFrame(frame);
}
function stopGame() {
  cancelAnimationFrame(rafId);
  game.active = false;
  audio.stopMusic();
}
function quitToMenu() {
  stopGame();
  $('#game').hidden = true;
  document.body.classList.remove('in-game');
  game.world = null;
  showScreen('main');
}

function pause(p) { game.paused = p; }
function togglePause() {
  if (!game.active || ended) return;
  if (game.paused) { pause(false); hideMenu(); }
  else { pause(true); showScreen('pause'); $('#p-load').hidden = !hasSave(); }
}
$('#p-resume').onclick = () => togglePause();
$('#p-save').onclick = () => { saveGame(); showToast('Game saved'); };
$('#p-load').onclick = () => loadGame();
$('#p-settings').onclick = () => { settingsReturn = 'pause'; showScreen('settings'); };
$('#p-help').onclick = () => { helpReturn = 'pause'; showScreen('help'); };
$('#p-restart').onclick = () => { if (confirm('Restart this battle?')) { const s = { ...game.world.setup }; startGame(new World(s)); } };
$('#p-surrender').onclick = () => { if (confirm('Surrender this battle?')) endGame(false, true); };
$('#p-quit').onclick = () => { if (confirm('Quit to main menu? Unsaved progress will be lost.')) quitToMenu(); };
$('#e-again').onclick = () => { const s = { ...game.world.setup, seed: 1 + Math.floor(Math.random() * 999998) }; startGame(new World(s)); };
$('#e-menu').onclick = () => quitToMenu();

function showToast(t) { if (game.ui) game.ui.flash(t); togglePause(); }

function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
function saveGame() {
  try {
    const data = { world: game.world.toJSON(), cam: game.renderer.cam, groups: game.controller.groups, savedAt: Date.now() };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (e) { alert('Could not save: ' + e.message); }
}
function loadGame() {
  try {
    const data = JSON.parse(localStorage.getItem(SAVE_KEY));
    const w = World.fromJSON(data.world);
    startGame(w);
    Object.assign(game.renderer.cam, data.cam); game.renderer.clampCam();
    game.controller.groups = data.groups || {};
    game.controller.deselect();
    game.ui.refreshGroups();
  } catch (e) { alert('Could not load saved game: ' + e.message); }
}
$('#btn-continue').onclick = () => { audio.unlock(); loadGame(); };

function endGame(won, surrendered) {
  if (ended) return;
  ended = true;
  game.paused = true;
  const w = game.world;
  const t = $('#end-title');
  t.textContent = won ? 'Victory' : 'Defeat';
  t.className = won ? 'victory' : 'defeat';
  $('#end-sub').textContent = `${surrendered ? 'You surrendered after' : won ? 'All hostile forces eliminated in' : 'Your forces were eliminated after'} ${formatTime(w.time)}.`;
  const rows = [['Units trained', 'unitsBuilt'], ['Units lost', 'unitsLost'], ['Enemy units destroyed', 'unitsKilled'], ['Structures built', 'bldBuilt'], ['Structures lost', 'bldLost'], ['Enemy structures destroyed', 'bldKilled'], ['Credits harvested', 'harvested']];
  const ps = w.players.filter((p) => !p.neutral);
  $('#end-stats').innerHTML = `<tr><th></th>${ps.map((p) => `<th style="color:${p.color}">${p.name}</th>`).join('')}</tr>` +
    rows.map(([lab, k]) => `<tr><th>${lab}</th>${ps.map((p) => `<td>${Math.round(p.stats[k]).toLocaleString()}</td>`).join('')}</tr>`).join('');
  audio.say(won ? 'Mission accomplished. The battlefield is ours.' : 'Mission failed. Our forces have been routed.', 'end', 1);
  setTimeout(() => showScreen('end'), surrendered ? 0 : 1500);
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const w = game.world;
  if (!w) return;
  frameCount++; fpsT += dt;
  if (fpsT >= 1) { game.fps = frameCount; frameCount = 0; fpsT = 0; }
  if (!game.paused) {
    acc += dt * game.speed;
    let steps = 0;
    while (acc >= DT && steps < 8) {
      for (const p of w.players) if (p.ai) updateAI(w, p);
      w.tick();
      pending.push(...w.events); w.events.length = 0;
      acc -= DT; steps++;
    }
    if (steps >= 8) acc = 0;
    if (w.over && !ended) {
      const won = w.over.team === w.players[game.me].team;
      endGame(won);
    } else if (w.players[game.me].defeated && !ended) endGame(false);
  }
  game.renderer.updateFx(game.paused ? 0 : dt);
  if (pending.length) {
    game.renderer.ingest(pending);
    game.ui.ingest(pending);
    pending.length = 0;
  }
  game.controller.update(dt);
  game.renderer.draw(game.paused ? 1 : Math.min(1, acc / DT), game.controller.uiState());
  uiT += dt; mmT += dt;
  if (uiT > 0.1) { uiT = 0; game.ui.update(); }
  if (mmT > 0.2) {
    mmT = 0;
    const p = w.players[game.me];
    const online = (w.hasBuilding(game.me, 'radar') && !p.lowPower) || w.setup.fog === false;
    game.ui.minimapOnline = online;
    game.renderer.drawMinimap($('#minimap'), online);
  }
}

window.addEventListener('resize', () => { if (game.renderer) game.renderer.resize(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.active && !game.paused && !ended) togglePause();
});

function tryFullscreen() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
  if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
}

// ---------------- PWA ----------------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btn-install').hidden = false; });
$('#btn-install').onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $('#btn-install').hidden = true; };
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !/[?&]nosw/.test(location.search)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// first gesture unlocks audio
window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
showScreen('main');
