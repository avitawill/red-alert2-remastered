// Fully synthesized audio: weapon SFX, UI sounds, procedural soundtrack, spoken alerts.
export class Audio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.last = new Map();
    this.voiceQ = [];
    this.voiceLast = new Map();
    this.musicOn = false;
  }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfx = this.ctx.createGain(); this.sfx.connect(this.master);
    this.mus = this.ctx.createGain(); this.mus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }
  applyVolumes() {
    if (!this.ctx) return;
    this.sfx.gain.value = this.settings.sfx;
    this.mus.gain.value = this.settings.music * 0.35;
  }

  noiseBurst(dur, freq, q, vol, type = 'lowpass', when = 0, sweepTo) {
    const c = this.ctx, t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, vol, type = 'sine', when = 0, slideTo) {
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  play(name, vol = 1) {
    if (!this.ctx || this.settings.sfx <= 0) return;
    const now = this.ctx.currentTime;
    const gap = { rifle: 0.05, mg: 0.06, cannon: 0.06, rocket: 0.06, flame: 0.12, beam: 0.08, arty: 0.1, sniper: 0.1, boom: 0.05 }[name] || 0.03;
    if (now - (this.last.get(name) || 0) < gap) return;
    this.last.set(name, now);
    const v = vol;
    switch (name) {
      case 'rifle': this.noiseBurst(0.08, 2500, 1, 0.25 * v, 'bandpass'); break;
      case 'mg': this.noiseBurst(0.05, 3000, 1.2, 0.2 * v, 'bandpass'); this.noiseBurst(0.05, 3000, 1.2, 0.15 * v, 'bandpass', 0.06); break;
      case 'sniper': this.noiseBurst(0.25, 1800, 0.8, 0.45 * v, 'bandpass', 0, 300); this.tone(1800, 0.06, 0.1 * v, 'square'); break;
      case 'cannon': this.noiseBurst(0.35, 900, 0.7, 0.55 * v, 'lowpass', 0, 120); this.tone(90, 0.25, 0.4 * v, 'sine', 0, 40); break;
      case 'rocket': this.noiseBurst(0.4, 1500, 0.6, 0.3 * v, 'bandpass', 0, 4000); break;
      case 'arty': this.noiseBurst(0.6, 600, 0.6, 0.6 * v, 'lowpass', 0, 80); this.tone(60, 0.4, 0.5 * v, 'sine', 0, 30); break;
      case 'flame': this.noiseBurst(0.3, 700, 0.4, 0.3 * v, 'lowpass'); break;
      case 'beam': this.tone(1200, 0.3, 0.18 * v, 'sawtooth', 0, 300); this.tone(2400, 0.2, 0.08 * v, 'sine', 0, 900); break;
      case 'boom': this.noiseBurst(0.7, 500, 0.5, 0.6 * v, 'lowpass', 0, 60); this.tone(70, 0.5, 0.5 * v, 'sine', 0, 25); break;
      case 'boom_big': this.noiseBurst(1.4, 400, 0.4, 0.9 * v, 'lowpass', 0, 40); this.tone(55, 1, 0.7 * v, 'sine', 0, 20); break;
      case 'superblast': this.noiseBurst(3, 300, 0.3, 1 * v, 'lowpass', 0, 30); this.tone(40, 2.5, 0.9 * v, 'sine', 0, 18); break;
      case 'click': this.tone(900, 0.04, 0.12 * v, 'square'); break;
      case 'select': this.tone(660, 0.05, 0.08 * v, 'triangle'); this.tone(990, 0.05, 0.06 * v, 'triangle', 0.04); break;
      case 'ack': this.tone(520, 0.05, 0.08 * v, 'triangle'); this.tone(780, 0.07, 0.07 * v, 'triangle', 0.05); break;
      case 'error': this.tone(200, 0.15, 0.15 * v, 'square'); this.tone(150, 0.2, 0.12 * v, 'square', 0.12); break;
      case 'place': this.noiseBurst(0.3, 400, 0.6, 0.5 * v, 'lowpass'); this.tone(120, 0.2, 0.3 * v); break;
      case 'ready': this.tone(523, 0.1, 0.12 * v, 'triangle'); this.tone(659, 0.1, 0.12 * v, 'triangle', 0.1); this.tone(784, 0.15, 0.12 * v, 'triangle', 0.2); break;
      case 'alert': this.tone(880, 0.12, 0.15 * v, 'square'); this.tone(660, 0.12, 0.15 * v, 'square', 0.15); this.tone(880, 0.12, 0.15 * v, 'square', 0.3); break;
      case 'cash': this.tone(1320, 0.05, 0.06 * v, 'square'); break;
      case 'crate': this.tone(660, 0.08, 0.12, 'triangle'); this.tone(990, 0.08, 0.12, 'triangle', 0.08); this.tone(1320, 0.12, 0.12, 'triangle', 0.16); break;
      case 'promote': this.tone(784, 0.1, 0.12, 'triangle'); this.tone(1046, 0.18, 0.12, 'triangle', 0.1); break;
    }
  }

  // Positional-ish: attenuate by distance from view center.
  playAt(name, x, y, view) {
    if (!view) return this.play(name);
    const { cx, cy, r } = view;
    const d = Math.hypot(x - cx, y - cy);
    if (d > r * 1.6) return;
    this.play(name, Math.max(0.15, 1 - d / (r * 1.6)));
  }

  say(text, key = text, cooldown = 4) {
    if (!this.settings.voice || typeof speechSynthesis === 'undefined') return;
    const now = performance.now() / 1000;
    if (now - (this.voiceLast.get(key) || -99) < cooldown) return;
    this.voiceLast.set(key, now);
    try {
      if (speechSynthesis.speaking && this.voiceQ.length > 1) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 0.75; u.volume = Math.min(1, this.settings.sfx + 0.2);
      const v = speechSynthesis.getVoices().find((x) => /en[-_]/i.test(x.lang) && /female|zira|samantha|google uk english female/i.test(x.name)) || speechSynthesis.getVoices().find((x) => /en[-_]/i.test(x.lang));
      if (v) u.voice = v;
      this.voiceQ.push(u);
      u.onend = () => { this.voiceQ.shift(); };
      speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  // --------- Procedural soundtrack ---------
  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    this.step = 0;
    this.nextT = this.ctx.currentTime + 0.1;
    this.section = 0;
    const tick = () => {
      if (!this.musicOn) return;
      while (this.nextT < this.ctx.currentTime + 0.3) { this.scheduleStep(this.step, this.nextT); this.nextT += 60 / 128 / 4; this.step++; }
      this.musicTimer = setTimeout(tick, 100);
    };
    tick();
  }
  stopMusic() { this.musicOn = false; clearTimeout(this.musicTimer); }
  scheduleStep(s, t) {
    if (this.settings.music <= 0) return;
    const c = this.ctx;
    const bar = Math.floor(s / 16) % 16, st = s % 16;
    const prog = [0, 0, 3, 3, 5, 5, 2, 4, 0, 0, 3, 3, 7, 5, 3, 2];
    const root = 36 + prog[bar] + (bar >= 8 ? 0 : 0);
    const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
    const env = (node, vol, dur) => { const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); node.connect(g); g.connect(this.mus); return g; };
    // kick
    if (st % 4 === 0) { const o = c.createOscillator(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15); env(o, 0.9, 0.25); o.start(t); o.stop(t + 0.3); }
    // snare
    if (st === 4 || st === 12) { const n = c.createBufferSource(); n.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500; n.connect(f); env(f, 0.35, 0.18); n.start(t, Math.random() * 0.5); n.stop(t + 0.2); }
    // hats
    if (st % 2 === 1) { const n = c.createBufferSource(); n.buffer = this.noise; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; n.connect(f); env(f, 0.08, 0.05); n.start(t, Math.random() * 0.5); n.stop(t + 0.06); }
    // driving bass ostinato
    const bassPat = [0, 0, 12, 0, 0, 10, 0, 7, 0, 0, 12, 0, 3, 0, 5, 7];
    { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(root + bassPat[st]); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + 0.12); o.connect(f); env(f, 0.22, 0.13); o.start(t); o.stop(t + 0.15); }
    // stab chords every half bar
    if ((st === 0 || st === 10) && bar % 2 === 0) {
      for (const iv of [12, 15, 19]) { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(root + iv + 12); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800; o.connect(f); env(f, 0.05, 0.4); o.start(t); o.stop(t + 0.45); }
    }
    // lead motif on second half
    if (bar >= 8) {
      const lead = [24, -1, 22, -1, 19, -1, 22, 24, -1, 27, -1, 24, 22, -1, 19, -1];
      const n = lead[st];
      if (n >= 0 && bar % 4 !== 3) { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(root + n + 12); env(o, 0.06, 0.25); o.start(t); o.stop(t + 0.3); }
    }
  }
}
