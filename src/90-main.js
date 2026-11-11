// Boot, input, the blink, and the frame loop.
const Q = (() => {
  const low = SHOT && HASH.low;
  return { moonRes: low ? 1024 : 4096, cookieRes: low ? 1024 : 2048, cryptRes: low ? 512 : 1024, pointRes: low ? 256 : 640, plPerFrame: 2, maxPixels: 2.3e6 };
})();
const canvas = document.getElementById('view'), veil = document.getElementById('veil');
const camera = new T.PerspectiveCamera(60, 16 / 9, 0.08, 90);
camera.position.set(0, G.eye, 0); camera.rotation.order = 'YXZ';
const look = { yaw: 0, pitch: 0, ty: 0, tp: 0 };
let running = false, ready = false, simTime = 0, lastNow = 0, frameEMA = 16, slowFor = 0, fastFor = 0, wantScale = 0;

// ── the eye ──
const Eye = {
  open: 0, state: 'shut', held: false, since: 0, limit: 15, strain: 0, shutFor: 0, tick: 1.5, introT: -1, minShut: 0.13,
  press() { this.held = true; if (this.state === 'open' || this.state === 'opening') this.state = 'closing'; },
  release() { this.held = false; },
  intro() { this.state = 'intro'; this.introT = 0; this.open = 0; },
  get shut() { return this.state === 'shut' || (this.state === 'intro' && this.open < 0.02); },
  update(dt) {
    if (this.state === 'intro') {             // waking: a first heavy flutter, then open
      const t = (this.introT += dt);
      this.open = t < 1.3 ? 0.36 * sstep(0.1, 1.3, t) : t < 1.9 ? 0.36 - 0.33 * sstep(1.3, 1.9, t) : 0.03 + 0.97 * sstep(1.9, 3.9, t);
      if (t >= 3.9) { this.state = 'open'; this.open = 1; this.since = 0; }
      return;
    }
    this.since += dt;
    if (this.state === 'open') {
      const lim = Dir.phase === 'finale1' ? 10 : this.limit;
      this.strain = sstep(lim - 4.5, lim, this.since);
      if (this.since > lim) this.state = 'closing';
    }
    if (this.state === 'closing') {
      this.open -= dt / 0.085;
      if (this.open <= 0) { this.open = 0; this.state = 'shut'; this.shutFor = 0; this.tick = 1.5; this.strain = 0; Dir.onClosed(); Pipe.reset = true; }
    } else if (this.state === 'shut') {
      this.shutFor += dt;
      if (Dir.phase === 'finale2') {          // this time the lids stay down
        if (this.shutFor > 8.0) { Dir.reset(); Pipe.reset = true; this.intro(); }
        return;
      }
      if (this.held && this.shutFor > this.tick) { this.tick += 1.5; Dir.onClosed(); Pipe.reset = true; }
      if (!this.held && this.shutFor >= this.minShut) { this.state = 'opening'; this.since = 0; this.limit = 13 + Math.random() * 7; }
    } else if (this.state === 'opening') {
      this.open += dt / 0.17;
      if (this.open >= 1) { this.open = 1; this.state = 'open'; }
    }
  },
};

const fx = {
  time: 0, noise: null, drift: V3(), taaBlend: 0.09,
  moonCol: new T.Color(), cryptCol: new T.Color(), ambUp: new T.Color(), ambDn: new T.Color(), fogAmb: new T.Color(),
  density: 0.010, ground: 0, volGain: 4.2, exposure: 1.5, bloom: 0.07, open: 1, strain: 0, sat: 0.95, contrast: 1.07, grain: 0.03, vig: 0.42, fade: 1,
  shadowTint: new T.Color(), highTint: new T.Color(), lift: new T.Color(),
  overlayPrep(D, w, h, N, ivp) {
    let u;
    for (const m of [FX.flameMat, FX.mirrorMat]) {
      u = m.uniforms; u.tDepth.value = D; u.tNormal.value = N; u.uRes.value.set(w, h); u.uCam.value.copy(camera.position); u.uCamF.value.copy(camera.position); u.uTime.value = simTime; u.uInvVP.value.copy(ivp);
    }
    u = FX.dustMat.uniforms; u.tDepth.value = D; u.uRes.value.set(w, h); u.uCam.value.copy(camera.position); u.uTime.value = simTime;
    u.uPx.value = h / (2 * Math.tan(camera.fov * DEG / 2)); u.uDrift.value.copy(FX.drift); u.uMoonCol.value.copy(fx.moonCol); u.uCryptCol.value.copy(fx.cryptCol);
  },
};
const tmpV = V3();
function setLook() {
  const m = Dir.mood;                       // 0 … 1, retuned only behind closed lids
  fx.moonCol.setRGB(0.50, 0.66, 1.0).multiplyScalar(9.0);
  const c = Dir.fxCrypt; fx.cryptCol.setRGB(c[0], c[1], c[2]);
  fx.ambUp.setRGB(0.010, 0.014, 0.022).multiplyScalar(1 - 0.3 * m); fx.ambDn.setRGB(0.011, 0.008, 0.006);
  fx.fogAmb.setRGB(0.004, 0.0055, 0.0085).lerp(tmpC.setRGB(0.003, 0.008, 0.006), m);
  fx.density = lerp(0.010, 0.013, m); fx.ground = 0.018 * m * m;
  fx.exposure = lerp(1.55, 1.32, m); fx.sat = lerp(0.96, 0.84, m); fx.vig = lerp(0.42, 0.62, m); fx.contrast = lerp(1.06, 1.12, m);
  fx.shadowTint.setRGB(0.87, 0.98, 1.11).lerp(tmpC.setRGB(0.80, 1.04, 1.03), m);
  fx.highTint.setRGB(1.07, 1.0, 0.90);
  fx.lift.setRGB(0.004, 0.006, 0.009);
}
const tmpC = new T.Color();

function updateShadows() {
  if (Shadows.dirty.moon) Shadows.renderMoon();
  if (Shadows.dirty.crypt) Shadows.renderCrypt(Actors.cryptLightPos(tmpV));
  let budget = Q.plPerFrame;
  for (let k = 0; k < NPL; k++) {
    const i = (Shadows.rr + k) % NPL, d = Shadows.dirty.pl[i];
    if (!d && budget <= 0) continue;
    const p = Lights.pl[i]; p.pos.copy(p.cur); Shadows.renderPoint(i, p.pos);
    if (!d) budget--;
  }
  Shadows.rr = (Shadows.rr + Q.plPerFrame) % NPL;
  Lights.pl.forEach((p, k) => { Lights.uPLPos[k * 4] = p.pos.x; Lights.uPLPos[k * 4 + 1] = p.pos.y; Lights.uPLPos[k * 4 + 2] = p.pos.z; });
}

function step(dt) {
  simTime += dt; fx.time = simTime;
  look.yaw += (look.ty - look.yaw) * Math.min(1, dt * 22); look.pitch += (look.tp - look.pitch) * Math.min(1, dt * 22);
  camera.rotation.set(look.pitch, look.yaw, 0);
  camera.updateMatrixWorld(true);
  Eye.update(dt);
  Dir.update(dt, camera, Eye.shut);
  // air: slow wander, and a pull toward the crypt mouth that strengthens as it wakes
  const m = Dir.mood;
  FX.drift.x += dt * (0.0016 - 0.0008 * m); FX.drift.y += dt * (0.0011 - 0.006 * m * m); FX.drift.z += dt * (0.0009 - 0.012 * m * m);
  fx.drift.x += dt * 0.011; fx.drift.y -= dt * 0.004; fx.drift.z += dt * (0.006 - 0.03 * m * m);
  Lights.update(simTime);
  updateShadows();
  setLook();
  const e = Eye.open; fx.open = e * e * (3 - 2 * e); fx.strain = Eye.strain;
  fx.fade = Dir.phase === 'finale1' ? 1 : 1;
  if (!step.skipRender) Pipe.render(camera, fx);
  if (Sound.on) {
    camera.getWorldDirection(tmpV); Sound.setListener(tmpV.x, tmpV.y, tmpV.z);
    Sound.update(dt, Dir.phase === 'finale1' ? 6.6 : Dir.W, Eye.shut, Dir.get('leanL').s / 6);
  }
}

function resize(scaleMul) {
  const iw = Math.max(2, window.innerWidth), ih = Math.max(2, window.innerHeight);
  if (scaleMul) Q.maxPixels = clamp(Q.maxPixels * scaleMul, 0.35e6, 3.2e6);
  const s = SHOT ? 1 : Math.min(window.devicePixelRatio || 1, Math.sqrt(Q.maxPixels / (iw * ih)));
  const w = Math.max(2, Math.floor(iw * s)), h = Math.max(2, Math.floor(ih * s));
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.fov = clamp(60 * Math.max(1, 1.35 / camera.aspect) ** 0.6, 60, 82);
  Pipe.resize(w, h);
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!running) { lastNow = now; return; }
  const raw = (now - lastNow) / 1000; lastNow = now;
  const dt = clamp(raw, 0.001, 0.05);
  step(dt);
  // adaptive resolution: only ever switched while the eyes are shut
  frameEMA += (raw * 1000 - frameEMA) * 0.05;
  if (frameEMA > 24) { slowFor += raw; fastFor = 0; } else if (frameEMA < 12.5) { fastFor += raw; slowFor = 0; } else { slowFor = fastFor = 0; }
  if (slowFor > 1.2) { wantScale = 0.72; slowFor = 0; } else if (fastFor > 8) { wantScale = 1.25; fastFor = 0; }
  if (wantScale && (Eye.open < 0.03 || (wantScale < 1 && frameEMA > 50))) { resize(wantScale); wantScale = 0; frameEMA = 16; }
}

// ── veil: an eye that opens as the cathedral is raised ──
const veilUI = {
  set(p) {
    const q = clamp(p, 0, 1), h = 30 * q;
    document.getElementById('lidTop').setAttribute('d', `M-46 0 Q0 ${-h} 46 0`);
    document.getElementById('lidBot').setAttribute('d', `M-46 0 Q0 ${h} 46 0`);
    document.getElementById('iris').setAttribute('opacity', q > 0.55 ? 1 : 0); document.getElementById('iris').setAttribute('r', Math.min(13, h * 0.5));
    document.getElementById('pupil').setAttribute('opacity', q > 0.8 ? 1 : 0);
  },
  rays() { const g = document.getElementById('rays'); for (let i = 0; i < 9; i++) { const a = (-150 + i * 15) * DEG, l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('class', 'ray'); l.setAttribute('x1', Math.cos(a) * 40); l.setAttribute('y1', Math.sin(a) * 26 - 4); l.setAttribute('x2', Math.cos(a) * 47); l.setAttribute('y2', Math.sin(a) * 32 - 4); g.appendChild(l); } },
};
const tickUI = () => new Promise(r => setTimeout(r, SHOT ? 0 : 30));

async function boot() {
  try {
    veilUI.rays(); veilUI.set(0.04);
    renderer = new T.WebGLRenderer({ canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
    if (!renderer.capabilities.isWebGL2 || !renderer.extensions.has('EXT_color_buffer_float')) throw new Error('WebGL2 with float render targets is required');
    renderer.autoClear = false; renderer.setPixelRatio(1); renderer.debug.checkShaderErrors = true;
    const maxTex = renderer.capabilities.maxTextureSize;
    if (maxTex < 4096) { Q.moonRes = Math.min(Q.moonRes, 2048); Q.pointRes = Math.min(Q.pointRes, Math.floor(maxTex / 6)); }
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    await tickUI();
    const tex = bakeSurfaces(aniso); veilUI.set(0.2); await tickUI();
    bakeGlass(aniso); fx.noise = tex.noise; veilUI.set(0.32); await tickUI();
    initMaterials(tex);
    const wardens = buildWardens(); veilUI.set(0.55); await tickUI();
    const C = buildCathedral(); veilUI.set(0.72); await tickUI();
    for (const { key, geo } of C.statics) World.add(geo, key.split(':')[0] === 'wax' ? key : key);
    Lights.init(C.candles); Shadows.init(Q); Pipe.init(Q); FX.init(C.candles);
    for (const k of ['glass:lancet', 'glass:apse', 'glass:rose']) MAT.g[k].uniforms.uMoonDir.value.copy(MOON_DIR);
    Actors.build(wardens);
    for (const m of World.meshes) if (m.userData.key.startsWith('wax:')) Lights.groups[+m.userData.key.slice(4)].wax.push(m);
    Dir.init();
    World.scene.updateMatrixWorld(true);
    resize(); veilUI.set(0.86); await tickUI();
    step(1 / 60);                              // compile every program, fill every shadow map
    veilUI.set(1);
    ready = true;
    if (SHOT) { window.__gaze.ready = true; return; }
    veil.classList.add('ready');
    window.addEventListener('resize', () => resize());
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    window.__gaze.error = String(err && err.stack || err);
    document.getElementById('fail').style.display = 'flex'; veil.style.display = 'none';
  }
}

// ── input ──
function begin() {
  if (!ready) return;
  Sound.start();
  if (canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (_) { } }
  if (!running) { running = true; veil.classList.add('gone'); if (Eye.introT < 0) Eye.intro(); }
}
function pause() { if (!running) return; running = false; veil.classList.remove('gone'); if (Sound.ctx) Sound.ctx.suspend(); }
veil.addEventListener('click', begin);
canvas.addEventListener('mousedown', e => { if (!running) return begin(); if (document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => { }); } catch (_) { } } Eye.press(); e.preventDefault(); });
window.addEventListener('mouseup', () => Eye.release());
document.addEventListener('mousemove', e => {
  if (!running) return;
  const k = 0.0021 * (camera.fov / 60);
  look.ty -= (e.movementX || 0) * k; look.tp = clamp(look.tp - (e.movementY || 0) * k, -1.25, 1.35);
});
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== canvas && running && !('ontouchstart' in window)) pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
window.addEventListener('keydown', e => {
  if (e.code === 'Space') { if (!running) begin(); else Eye.press(); e.preventDefault(); }
  const k = 0.06;
  if (e.code === 'ArrowLeft') look.ty += k; if (e.code === 'ArrowRight') look.ty -= k;
  if (e.code === 'ArrowUp') look.tp = clamp(look.tp + k, -1.25, 1.35); if (e.code === 'ArrowDown') look.tp = clamp(look.tp - k, -1.25, 1.35);
});
window.addEventListener('keyup', e => { if (e.code === 'Space') Eye.release(); });
// touch: drag to look, tap to blink
let touch = null;
canvas.addEventListener('touchstart', e => { if (!running) return begin(); const t = e.touches[0]; touch = { x: t.clientX, y: t.clientY, t: performance.now(), moved: 0 }; e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (!touch) return; const t = e.touches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y; touch.x = t.clientX; touch.y = t.clientY; touch.moved += Math.abs(dx) + Math.abs(dy);
  look.ty += dx * 0.0045; look.tp = clamp(look.tp + dy * 0.0045, -1.25, 1.35); e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => { if (touch && touch.moved < 12 && performance.now() - touch.t < 350) { Eye.press(); setTimeout(() => Eye.release(), 60); } touch = null; });

// ── status + capture hooks (the capture/soak functions are only installed under #shot, for the headless harness) ──
window.__gaze = {
  ready: false, error: null,
  stats: () => ({ ms: +frameEMA.toFixed(1), w: Pipe.w, h: Pipe.h, eye: Eye.state, open: +Eye.open.toFixed(2), W: +Dir.W.toFixed(2), phase: Dir.phase, stages: Dir.els.map(e => e.s).join(''), audio: Sound.ctx ? Sound.ctx.state : 'none', lock: document.pointerLockElement === canvas }),
};
if (SHOT) Object.assign(window.__gaze, {
  async shot(P) {
    const t0 = performance.now();
    Dir.rate = P.run ? 1 / 23 : 0;
    if (P.stage !== undefined) Dir.forceAll(+P.stage);
    for (const k of ['door', 'stairs', 'lamps', 'rose', 'statue', 'lean']) if (P[k] !== undefined) Dir.forceAll(+P[k], k);
    if (P.W !== undefined) Dir.W = +P.W; else if (P.stage !== undefined) Dir.W = +P.stage;
    if (P.pre) eval(P.pre);
    Dir.applyMood();
    look.yaw = look.ty = (+P.yaw || 0) * DEG; look.pitch = look.tp = (+P.pitch || 0) * DEG;
    if (P.fov) camera.fov = +P.fov;
    Eye.state = 'open'; Eye.open = P.open !== undefined ? +P.open : 1; Eye.since = 0; Eye.limit = 1e9;
    if (P.t) simTime = +P.t;
    Pipe.reset = true;
    const n = +(P.frames || 10);
    for (let i = 0; i < n; i++) { step(1 / 60); if (i % 3 === 2) await new Promise(r => setTimeout(r, 0)); }
    const info = { ms: Math.round(performance.now() - t0), w: Pipe.w, h: Pipe.h, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, meshes: World.meshes.length, candles: Lights.candles.length };
    if (P.dbg) info.dbg = eval(P.dbg);
    return { png: canvas.toDataURL('image/png'), info };
  },
  // logic soak test: run the director for `secs` of simulated time with a scripted gaze, no rendering
  sim(secs, opts = {}) {
    const log = []; let t = 0, nextBlink = opts.blinkEvery || 1e9, last = '';
    Dir.rate = 1 / 23; Eye.state = 'open'; Eye.open = 1; Eye.since = 0; Eye.limit = opts.auto ? 15 : 1e9;
    step.skipRender = true;
    const snap = () => Dir.els.map(e => e.s).join('');
    while (t < secs) {
      const dt = 1 / 30; t += dt;
      if (opts.sweep) look.ty = look.yaw = Math.sin(t * opts.sweep) * (opts.amp || 3.1); else if (opts.yaw !== undefined) look.ty = look.yaw = opts.yaw * DEG;
      if (t >= nextBlink) { Eye.press(); Eye.release(); nextBlink += opts.blinkEvery; }
      step(dt);
      const s = snap() + Dir.phase;
      if (s !== last) { log.push(t.toFixed(1) + ' W=' + Dir.W.toFixed(2) + ' ' + snap() + ' ' + Dir.phase + ' eye=' + Eye.state); last = s; }
    }
    step.skipRender = false;
    return log;
  },
  async audioProbe(ms) {
    Sound.start();
    const c = Sound.ctx; if (!c) return { err: 'no AudioContext' };
    const an = c.createAnalyser(); an.fftSize = 2048; Sound.master.connect(an);
    const out = [], buf = new Float32Array(2048);
    for (let k = 0; k < 6; k++) {
      await new Promise(r => setTimeout(r, ms / 6));
      Sound.update(ms / 6000, k, false, k / 6);
      if (k === 1) Sound.cue('stone', V3(-3, 1, 2)); if (k === 2) Sound.cue('door', V3(0, -1, -6.6), { s: 3 }); if (k === 3) Sound.cue('step', V3(0, 0, -2)); if (k === 4) { Sound.cue('flame', V3(2, 1, -1)); Sound.cue('glass', V3(0, 11, 17)); Sound.cue('lamp', V3(0, 5, -5)); }
      an.getFloatTimeDomainData(buf);
      let pk = 0, sq = 0; for (const v of buf) { pk = Math.max(pk, Math.abs(v)); sq += v * v; }
      out.push({ t: c.currentTime.toFixed(2), state: c.state, peak: +pk.toFixed(3), rms: +Math.sqrt(sq / buf.length).toFixed(4) });
    }
    return out;
  },
  ev: src => eval(src),
});
boot();
