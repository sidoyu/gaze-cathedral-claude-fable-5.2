// Everything audible is synthesised: a generated stone-vault reverb, room tone, wind, candle ticks,
// and — spatialised at the crypt door — something breathing that grows a pulse as the seal fails.
// Changes made behind the listener's back are betrayed only by sound.
const Sound = {
  ctx: null, level: 0, on: false, t: { breath: 2, beat: 0, tick: 0, creak: 9, wind: 0 }, quiet: 1,
  start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || this.ctx) { if (this.ctx) this.ctx.resume(); return; }
    const c = this.ctx = new AC(), sr = c.sampleRate;
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -15; comp.knee.value = 16; comp.ratio.value = 5; comp.attack.value = 0.012; comp.release.value = 0.35;
    this.master.connect(comp); comp.connect(c.destination);
    // noise stock
    const mk = (secs, kind) => {
      const b = c.createBuffer(1, Math.floor(sr * secs), sr), d = b.getChannelData(0);
      let last = 0, b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.4; }
        else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22; }
        else d[i] = w;
      }
      return b;
    };
    this.buf = { white: mk(2.5, 'white'), pink: mk(5, 'pink'), brown: mk(6, 'brown') };
    // reverb: decaying noise that darkens with time, plus a few early reflections off the piers
    const len = Math.floor(sr * 5.2), ir = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr, env = Math.pow(1 - i / len, 1.6) * Math.exp(-t * 0.62);
        lp += (0.05 + 0.85 * Math.exp(-t * 1.5)) * ((Math.random() * 2 - 1) * env - lp);
        d[i] = lp * 0.5;
      }
      for (const [ms, g] of [[11, 0.5], [23, 0.38], [37, -0.3], [58, 0.26], [83, -0.2], [121, 0.16]]) d[Math.floor(sr * (ms + ch * 3.5) / 1000)] += g * 0.5;
    }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    const rg = c.createGain(); rg.gain.value = 0.55; this.rev.connect(rg); rg.connect(this.master);
    this.send = c.createGain(); this.send.connect(this.rev);
    this.dry = c.createGain(); this.dry.connect(this.master);
    const L = c.listener;
    if (L.positionX) { L.positionX.value = 0; L.positionY.value = G.eye; L.positionZ.value = 0; } else if (L.setPosition) L.setPosition(0, G.eye, 0);
    const loop = (buf, rate = 1) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * buf.duration); return s; };
    const gain = (v, ...to) => { const g = c.createGain(); g.gain.value = v; for (const d of to) g.connect(d); return g; };
    const filt = (type, f, q, to) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; if (to) b.connect(to); return b; };
    this.h = { loop, gain, filt };
    // room tone + the wind outside
    loop(this.buf.brown, 0.8).connect(filt('lowpass', 150, 0.5, gain(0.24, this.master)));
    this.windG = gain(0.012, this.dry, this.send);
    this.windF = filt('bandpass', 380, 1.6, this.windG);
    loop(this.buf.pink, 0.7).connect(this.windF);
    // the presence below, placed at the crypt door
    this.crypt = this.spatial([0, -1, G.chZ], 0.65, 3.5);
    this.droneG = gain(0, this.crypt.in);
    this.droneDirect = gain(0, this.master);
    for (const [f, type, g] of [[41.2, 'sine', 1], [43.4, 'sine', 0.8], [82.9, 'triangle', 0.12], [61.9, 'sine', 0.3]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; const og = gain(g, this.droneG, this.droneDirect); o.connect(og); o.start();
    }
    this.breathG = gain(0, this.crypt.in);
    this.breathF = filt('bandpass', 300, 1.1, this.breathG);
    loop(this.buf.pink, 0.9).connect(this.breathF);
    const bl = filt('lowpass', 520, 0.7, this.breathG); loop(this.buf.brown, 1.3).connect(gain(0.6, bl));
    // a choir that is not quite a choir, high in the apse
    this.choir = this.spatial([0, 9, -15], 1.0, 6);
    this.choirG = gain(0, this.choir.in);
    for (const f of [146.8, 155.6, 220.0, 233.1, 311.1]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07 + Math.random() * 0.12; const lg = gain(f * 0.006); lfo.connect(lg); lg.connect(o.frequency); lfo.start();
      const vg = gain(0.2), trem = c.createOscillator(); trem.frequency.value = 0.05 + Math.random() * 0.1; const tg = gain(0.12); trem.connect(tg); tg.connect(vg.gain); trem.start();
      o.connect(vg); vg.connect(filt('bandpass', 760, 1.4, this.choirG)); vg.connect(filt('bandpass', 1150, 2.2, this.choirG)); o.start();
    }
    this.on = true;
    this.master.gain.setTargetAtTime(0.9, c.currentTime + 0.1, 1.2);
  },
  spatial(pos, wet = 0.5, ref = 2.5) {
    const c = this.ctx, p = c.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 0.9; p.maxDistance = 80;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else p.setPosition(pos[0], pos[1], pos[2]);
    const inp = c.createGain(), w = c.createGain(); w.gain.value = wet;
    inp.connect(p); p.connect(this.dry); inp.connect(w); w.connect(this.send);
    return { in: inp, panner: p };
  },
  env(g, t0, a, peak, d, hold = 0) {
    g.gain.cancelScheduledValues(t0); g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    if (hold) g.gain.setValueAtTime(Math.max(peak, 0.0002), t0 + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + hold + d);
  },
  noise(dest, t0, dur, kind, fType, f0, f1, q, peak, a = 0.03) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.buf[kind]; s.loop = true;
    const f = c.createBiquadFilter(); f.type = fType; f.Q.value = q; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); this.env(g, t0, a, peak, dur - a);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.1);
    return g;
  },
  tone(dest, t0, type, f0, f1, dur, peak, a = 0.004) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); this.env(g, t0, a, peak, dur - a);
    o.connect(g); g.connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
  },
  // one-shot betrayals of things that moved while unwatched
  cue(kind, pos, e) {
    if (!this.on) return;
    const c = this.ctx, t0 = c.currentTime + 0.02 + Math.random() * 0.12, R = Math.random;
    const sp = this.spatial([pos.x, pos.y, pos.z], kind === 'glass' ? 1.2 : 0.55, 2.2), d = sp.in;
    if (kind === 'stone') {                       // stone dragged over stone, then set down
      const dur = 0.5 + R() * 0.45;
      const g = this.noise(d, t0, dur, 'brown', 'bandpass', 240 + R() * 120, 520 + R() * 200, 2.2, 0.9, 0.06);
      const am = c.createOscillator(); am.type = 'sawtooth'; am.frequency.value = 31 + R() * 22; const ag = c.createGain(); ag.gain.value = 0.5; am.connect(ag); ag.connect(g.gain); am.start(t0); am.stop(t0 + dur + 0.1);
      this.noise(d, t0, dur, 'white', 'bandpass', 2400, 1500, 1.2, 0.05, 0.05);
      this.tone(d, t0 + dur - 0.04, 'sine', 84, 44, 0.3, 0.7);
    } else if (kind === 'door') {                 // old hinges; later, chain falling
      const dur = 1.0 + R() * 0.5, o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(64, t0); o.frequency.linearRampToValueAtTime(104 + R() * 20, t0 + dur * 0.6); o.frequency.linearRampToValueAtTime(78, t0 + dur);
      const g = c.createGain(); this.env(g, t0, 0.08, 0.34, dur - 0.08);
      const trem = c.createOscillator(); trem.type = 'square'; trem.frequency.setValueAtTime(9, t0); trem.frequency.linearRampToValueAtTime(21, t0 + dur); const tg = c.createGain(); tg.gain.value = 0.2; trem.connect(tg); tg.connect(g.gain);
      for (const [f, q] of [[760, 9], [1480, 12], [2350, 10]]) { const b = this.h.filt('bandpass', f * (0.9 + R() * 0.2), q, g); o.connect(b); }
      g.connect(d); o.start(t0); o.stop(t0 + dur + 0.1); trem.start(t0); trem.stop(t0 + dur + 0.1);
      this.tone(d, t0, 'sine', 58, 47, dur * 0.8, 0.35, 0.1);
      if (e && e.s === 3) for (let i = 0; i < 16; i++) this.tone(d, t0 + 0.2 + i * 0.045 + R() * 0.03, 'triangle', 2300 + R() * 3600, 1800 + R() * 2000, 0.07 + R() * 0.08, 0.10 * (1 - i / 22));
      if (e && e.s === 3) this.tone(d, t0 + 0.95, 'sine', 120, 60, 0.25, 0.5);
    } else if (kind === 'step') {                 // the floor giving way by one tread
      this.tone(d, t0, 'sine', 62, 34, 0.6, 1.0);
      this.noise(d, t0, 0.5, 'brown', 'lowpass', 420, 160, 0.7, 0.8, 0.02);
      this.noise(d, t0 + 0.05, 0.3, 'white', 'bandpass', 1900, 900, 1.5, 0.05, 0.02);
    } else if (kind === 'flame') {                // a draught taking the flames
      this.noise(d, t0, 0.7, 'pink', 'bandpass', 480, 1500, 0.8, 0.4, 0.25);
    } else if (kind === 'lamp') {
      for (let i = 0; i < 6; i++) this.tone(d, t0 + i * 0.09 + R() * 0.05, 'sine', 2300 + R() * 2400, 2200 + R() * 2000, 0.22, 0.06);
    } else if (kind === 'glass') {                // lead and glass settling
      for (let i = 0; i < 4; i++) this.tone(d, t0 + i * 0.13 + R() * 0.08, 'sine', 3200 + R() * 3800, 3000 + R() * 3000, 0.5, 0.085);
      this.noise(d, t0, 0.25, 'white', 'highpass', 5200, 7000, 0.7, 0.03, 0.01);
    }
    setTimeout(() => { try { sp.panner.disconnect(); sp.in.disconnect(); } catch (_) { } }, 9000);
  },
  finale(n) {
    if (!this.on) return;
    const c = this.ctx, t0 = c.currentTime;
    this.quiet = n === 1 ? 0.15 : 1;
    if (n === 2) {
      // one long breath at the listener's ear, stone closing in from all sides, and a door
      const near = this.spatial([0.25, G.eye, 0.5], 0.35, 1.0);
      this.noise(near.in, t0 + 0.6, 3.4, 'pink', 'bandpass', 260, 520, 1.0, 1.1, 1.6);
      this.noise(near.in, t0 + 4.2, 3.0, 'pink', 'bandpass', 480, 190, 1.0, 0.9, 0.5);
      for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; setTimeout(() => this.cue('stone', V3(Math.cos(a) * 1.6, 1.2, Math.sin(a) * 1.6)), 900 + i * 420 + Math.random() * 200); }
      const dd = this.spatial([0, -1, G.chZ], 0.9, 4);
      this.tone(dd.in, t0 + 5.4, 'sine', 70, 28, 1.4, 1.6, 0.005);
      this.noise(dd.in, t0 + 5.4, 0.8, 'brown', 'lowpass', 900, 120, 0.7, 1.4, 0.004);
    }
  },
  setListener(fx, fy, fz) {
    if (!this.on) return;
    const L = this.ctx.listener;
    if (L.forwardX) { L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz; L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
    else if (L.setOrientation) L.setOrientation(fx, fy, fz, 0, 1, 0);
  },
  update(dt, W, eyesShut, agitation) {
    if (!this.on) return;
    const c = this.ctx, now = c.currentTime, l = clamp(W / 6, 0, 1.1), q = this.quiet, T = this.t, R = Math.random;
    this.master.gain.setTargetAtTime(eyesShut ? 1.0 : 0.85, now, 0.25);         // shut eyes sharpen the ears a little
    this.droneG.gain.setTargetAtTime(0.7 * Math.pow(l, 1.4) + (q < 1 ? 0.5 : 0), now, 1.5);
    this.droneDirect.gain.setTargetAtTime(0.10 * Math.pow(l, 1.6) + (q < 1 ? 0.1 : 0), now, 1.5);
    this.choirG.gain.setTargetAtTime(0.11 * sstep(0.5, 1.0, l) * q, now, 3);
    // wind gusts
    T.wind -= dt;
    if (T.wind <= 0) { T.wind = 3 + R() * 6; this.windG.gain.setTargetAtTime((0.006 + R() * 0.03) * q, now, 1.8); this.windF.frequency.setTargetAtTime(260 + R() * 420, now, 2.2); }
    // breathing: in … out, slower than any person
    T.breath -= dt;
    const bAmp = 0.62 * sstep(0.08, 0.95, l) + (q < 1 ? 0.35 : 0);
    if (T.breath <= 0) {
      const period = lerp(7.5, 5.2, l); T.breath = period;
      const g = this.breathG.gain, f = this.breathF.frequency, t0 = now + 0.05;
      g.cancelScheduledValues(t0); g.setTargetAtTime(bAmp, t0, 0.7); g.setTargetAtTime(bAmp * 0.08, t0 + period * 0.36, 0.25);
      g.setTargetAtTime(bAmp * 0.85, t0 + period * 0.48, 0.5); g.setTargetAtTime(0.0001, t0 + period * 0.82, 0.5);
      f.cancelScheduledValues(t0); f.setTargetAtTime(430, t0, 0.9); f.setTargetAtTime(210, t0 + period * 0.48, 0.9);
    }
    // a pulse, once it has woken far enough
    T.beat -= dt;
    if (T.beat <= 0) {
      T.beat = 60 / lerp(44, 72, sstep(0.4, 1.0, l));
      const a = 1.1 * sstep(0.4, 0.9, l) * (q < 1 ? 1.2 : 1);
      if (a > 0.01) { this.tone(this.crypt.in, now + 0.02, 'sine', 66, 36, 0.24, a); this.tone(this.crypt.in, now + 0.21, 'sine', 58, 34, 0.2, a * 0.7); }
    }
    // candle wicks spitting
    T.tick -= dt;
    if (T.tick <= 0 && q >= 1) {
      T.tick = (0.12 + R() * 0.7) / (1 + 2 * agitation);
      const p = c.createStereoPanner ? c.createStereoPanner() : null, g = c.createGain(), s = c.createBufferSource(), hp = this.h.filt('highpass', 2600 + R() * 3000, 0.8, g);
      s.buffer = this.buf.white; this.env(g, now, 0.001, 0.012 + R() * 0.03, 0.006 + R() * 0.02);
      s.connect(hp); if (p) { p.pan.value = R() * 1.6 - 0.8; g.connect(p); p.connect(this.dry); } else g.connect(this.dry);
      s.start(now, R() * 2); s.stop(now + 0.06);
    }
    // timber and stone settling somewhere behind
    T.creak -= dt;
    if (T.creak <= 0 && q >= 1) {
      T.creak = 8 + R() * 16;
      const sp = this.spatial([R() * 12 - 6, 1 + R() * 6, 4 + R() * 12], 0.8, 3), n = 3 + Math.floor(R() * 5), f = 170 + R() * 260;
      for (let i = 0; i < n; i++) this.noise(sp.in, now + i * (0.05 + R() * 0.05), 0.06, 'white', 'bandpass', f * (1 + i * 0.04), f, 14, 0.5, 0.004);
      setTimeout(() => { try { sp.panner.disconnect(); sp.in.disconnect(); } catch (_) { } }, 6000);
    }
  },
};
