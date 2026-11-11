// The moving parts, and the one rule: nothing changes while it is being watched.
const Actors = {
  build(wardens) {
    const S = World.scene;
    const dyn = (geo, key, parent, o = {}) => { const m = World.add(geo, key, Object.assign({ parent }, o)); m.matrixAutoUpdate = true; return m; };
    // ── stair flight and the floor that has not yet opened ──
    this.stair = dyn(stairGeo(G.steps0), 'stone', S);
    this.fill = dyn(stairFillGeo(G.steps0), 'floor', S);
    // ── crypt door ──
    const D = buildDoorParts();
    const door = this.door = new T.Group(); S.add(door);
    dyn(D.panel, 'ashlar', door); dyn(D.surround, 'stone', door); dyn(D.passage, 'dark', door);
    this.leaves = [1, -1].map(s => {
      const g = new T.Group(); g.position.set(s * G.doorHalf, 0, -0.12); g.scale.x = s; door.add(g);
      dyn(D.leafWood, 'woodL', g); dyn(D.leafIron, 'iron', g);
      const seal = dyn(D.seal, 'brass', g); seal.position.set(-G.doorHalf, 1.16, 0.03);
      g.userData.seal = seal;
      return g;
    });
    this.fallen = [[-0.28, 0.5, 0.7], [0.42, 0.78, -1.9]].map(([x, z, ry]) => { const m = dyn(D.seal, 'brass', door); m.position.set(x, 0.02, z); m.rotation.set(-Math.PI / 2, 0, ry); m.userData.show = false; return m; });
    for (const x of [-0.98, 0.98]) for (const y of [0.3, 2.0]) { const r = dyn(D.ring, 'iron', door); r.position.set(x, y, 0.02); }
    dyn(D.wax, 'wax:11', door, { cast: false });
    this.links = dyn(D.link, 'iron', door, { count: 220 });
    this.links.frustumCulled = false;
    // ── statues ──
    this.wardens = wardens;
    this.statues = STATUE_PATHS.map(() => dyn(wardens.pray, 'stoneL', S));
    // ── sanctuary lamps ──
    this.lamps = [[0, 16.3, -4.3, 11.1], [-2.5, 15.1, -7.7, 10.2], [2.5, 15.1, -7.7, 10.2]].map(([x, y, z, len]) => {
      const g = new T.Group(); g.position.set(x, y, z); S.add(g);
      const L = lampGeo(len);
      dyn(L.iron, 'iron', g, { cast: false }); dyn(L.brass, 'brass', g); dyn(L.glass, 'lampglass', g, { cast: false });
      const tip = new T.Object3D(); tip.position.set(0, -len + 0.08, 0); g.add(tip);
      g.userData = { tip, len }; Lights.addLamp(tip);
      return g;
    });
    this.rose = World.meshes.find(m => m.userData.key === 'glass:rose');
  },
  doorTheta: [0, 0.123, 0.224, 0.356, 0.555, 0.812, 1.08],
  setStairs(s) {
    const n = G.steps0 + s;
    this.stair.geometry.dispose(); this.stair.geometry = stairGeo(n);
    const f = stairFillGeo(n);
    this.fill.geometry.dispose(); if (f) this.fill.geometry = f; this.fill.userData.show = !!f;
    this.door.position.set(0, doorBaseY(n), G.chZ);
    Lights.candles.forEach((c, i) => { if (c.follow) { c.pos[1] = doorBaseY(n) + c.follow; FX.iPos.setY(i, c.pos[1] - 0.006); FX.iPos.needsUpdate = true; } });
    if (Lights.groups[11]) Lights.groups[11].centre.y = doorBaseY(n) + 0.25;
    this.stairsN = n;
  },
  setDoor(s) {
    const th = this.doorTheta[s];
    this.leaves[0].rotation.y = -th; this.leaves[1].rotation.y = th;
    const broken = s >= 3;
    for (const l of this.leaves) l.userData.seal.userData.show = !broken;
    for (const f of this.fallen) f.userData.show = broken;
    // chains
    const lines = [];
    const sag = (a, b, sagY, n = 14) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sagY * 4 * t * (1 - t), lerp(a[2], b[2], t) + 0.05 * Math.sin(Math.PI * t)]); } return pts; };
    if (!broken) {
      const sg = s === 2 ? 0.09 : 0.02;
      lines.push(sag([-0.98, 2.0, 0.03], [0.98, 0.3, 0.03], sg), sag([0.98, 2.0, 0.03], [-0.98, 0.3, 0.03], sg));
    } else {
      lines.push([[-0.98, 2.0, 0.03], [-0.985, 1.5, 0.045], [-0.975, 0.95, 0.04]], [[0.98, 2.0, 0.03], [0.985, 1.6, 0.045], [0.99, 1.2, 0.04]]);
      lines.push([[-0.98, 0.3, 0.03], [-0.97, 0.03, 0.08], [-0.7, 0.02, 0.32], [-0.5, 0.02, 0.62], [-0.2, 0.02, 0.66]]);
      lines.push([[0.98, 0.3, 0.03], [0.96, 0.03, 0.1], [0.74, 0.02, 0.42], [0.66, 0.02, 0.8]]);
    }
    const M = new T.Matrix4(), q = new T.Quaternion(), q2 = new T.Quaternion(), up = V3(0, 1, 0), dir = V3(), p = V3(), one = V3(1, 1, 1);
    let k = 0;
    for (const pts of lines) for (let i = 0; i < pts.length - 1; i++) {
      const a = V3(...pts[i]), b = V3(...pts[i + 1]), len = a.distanceTo(b), n = Math.max(1, Math.round(len / 0.06));
      dir.subVectors(b, a).normalize(); q.setFromUnitVectors(up, dir);
      for (let j = 0; j < n && k < 220; j++, k++) {
        p.lerpVectors(a, b, (j + 0.5) / n);
        q2.setFromAxisAngle(up, (k % 2) * Math.PI / 2 + 0.3);
        M.compose(p, q.clone().multiply(q2), one);
        this.links.setMatrixAt(k, M);
      }
    }
    this.links.count = k; this.links.instanceMatrix.needsUpdate = true;
    this.doorStage = s;
  },
  cryptLightPos(out) { return out.set(0, this.door.position.y + 1.3, G.chZ - 2.7); },
  setStatue(i, s) {
    const path = STATUE_PATHS[i], n = path.pts[s], m = this.statues[i];
    const pose = s === 0 ? 'pray' : s === 1 ? 'watch' : s >= 6 ? 'reach' : 'stand';
    m.geometry = this.wardens[pose];
    const onPed = s <= 1;
    m.position.set(n[0], (onPed ? 1.2 : 0) + 0.06, n[1]);
    // closing in they face the watcher; at the last they turn, all of them, to the open door
    m.rotation.y = onPed ? path.face : s >= 6 ? Math.atan2(-n[0], G.chZ - n[1]) : Math.atan2(-n[0], -n[1]);
    m.scale.x = (s === 1 && path.mirror) ? -1 : 1;
  },
  setLamps(s) {
    const f = [0, 0.1, 0.24, 0.42, 0.62, 0.82, 1.0][s];
    const target = V3(0, this.door.position.y + 1.2, G.chZ), d = V3(), down = V3(0, -1, 0);
    for (const g of this.lamps) {
      d.subVectors(target, g.position).normalize().lerp(down, 1 - f * 0.9).normalize();
      g.quaternion.setFromUnitVectors(down, d);
    }
  },
  setRose(s) { const r = GLASS.rose.rect(s); this.rose.userData.g.uniforms.uUvRect.value.set(r[0], r[1], 0.5, 0.5); this.rose.userData.ck.uniforms.uUvRect.value.set(r[0], r[1], 0.5, 0.5); },
  // flames of one region lean toward the crypt mouth
  setLean(groups, s, dead) {
    const L = [0, 0.16, 0.36, 0.62, 0.95, 1.35, 1.8][s], ag = s / 6;
    const tx = 0, ty = this.door.position.y + 1.4, tz = G.chZ;
    Lights.candles.forEach((c, i) => {
      if (!groups.includes(c.group)) return;
      let dx = tx - c.pos[0], dy = ty - c.pos[1], dz = tz - c.pos[2]; const l = Math.hypot(dx, dy, dz);
      dx /= l; dy = clamp(dy / l, -0.45, 0.15); dz /= l;
      FX.setFlame(i, dx * L, dy * L, dz * L, dead ? 0 : 1);
      FX.iParam.setW(i, ag); c.ag = ag;
    });
    for (const g of groups) if (Lights.groups[g]) { Lights.groups[g].alive = dead ? 0 : 1; Lights.groups[g].ag = ag; }
  },
};

// stage 0–1 on the pedestal, 2… on the floor, closing in.  pts: [x, z, extra yaw]
const STATUE_PATHS = [
  { face: Math.PI / 2, mirror: false, pts: [[-3.25, -2.5], [-3.25, -2.5], [-3.4, -1.55], [-3.6, -0.55], [-3.05, 0.35], [-2.5, 0.15], [-2.0, -0.15]] },
  { face: Math.PI / 2, mirror: false, pts: [[-3.25, 2.5], [-3.25, 2.5], [-2.5, 2.4], [-2.1, 2.0], [-1.8, 1.7], [-1.55, 1.42], [-1.3, 1.15]] },
  { face: -Math.PI / 2, mirror: true, pts: [[3.25, -2.5], [3.25, -2.5], [3.4, -1.6], [3.6, -0.6], [3.05, 0.3], [2.5, 0.12], [2.0, -0.15]] },
  { face: -Math.PI / 2, mirror: true, pts: [[3.25, 2.5], [3.25, 2.5], [2.5, 2.4], [2.1, 2.0], [1.8, 1.7], [1.55, 1.42], [1.3, 1.15]] },
  { face: Math.PI, mirror: true, pts: [[-2.7, 16.3], [-2.7, 16.3], [-0.75, 14.6], [-0.7, 10.6], [-0.65, 6.7], [-0.56, 3.4], [-0.5, 1.9]] },
  { face: Math.PI, mirror: false, pts: [[2.7, 16.3], [2.7, 16.3], [0.75, 14.4], [0.7, 10.2], [0.65, 6.4], [0.56, 3.2], [0.5, 1.85]] },
];

const Dir = {
  W: 0, rate: 1 / 23, phase: 'play', finaleT: 0, time: 0, els: [], mood: 0,
  init() {
    const A = Actors, sph = (x, y, z, r) => new T.Sphere(V3(x, y, z), r);
    const el = (id, max, thr, apply, spheres, o = {}) => this.els.push(Object.assign({ id, max, thr, apply, spheres, s: 0, last: -99, away: 0, cool: 6, due: 0, cue: 'stone', pos: V3() }, o));
    const base = [0.5, 1.5, 2.5, 3.5, 4.4, 5.3];
    // statues
    STATUE_PATHS.forEach((p, i) => {
      const off = [0.0, 0.3, 0.5, 0.15, 0.25, 0.4][i];
      el('statue' + i, 6, base.map(v => v - 0.2 + off), s => A.setStatue(i, s),
        e => { const a = p.pts[e.s], b = p.pts[Math.min(6, e.s + 1)]; return [sph(a[0], e.s <= 1 ? 2.2 : 1.0, a[1], 1.9), sph(b[0], e.s + 1 <= 1 ? 2.2 : 1.0, b[1], 1.9)]; },
        { cue: 'stone', posFn: e => { const a = p.pts[e.s]; return V3(a[0], 1.2, a[1]); }, shadows: true });
    });
    // candle regions
    const lean = (id, groups, sp, off, deadAt) => el(id, 6, base.map(v => v + off), s => A.setLean(groups, s, s >= deadAt), () => sp,
      { cue: 'flame', posFn: () => sp[0].center.clone(), groups });
    lean('leanL', [0, 5], [sph(-2.2, 0.6, -1.4, 2.2), sph(-1.7, 0.4, -4.5, 2.2)], 0.0, 99);
    lean('leanR', [1, 6], [sph(2.2, 0.6, -1.6, 2.2), sph(1.7, 0.4, -4.5, 2.2)], 0.12, 99);
    lean('leanAltar', [2], [sph(0, 3.0, -10.2, 3.6)], 0.25, 99);
    lean('leanPit', [11], [sph(0, -1.2, -5.6, 3.2)], -0.15, 5);
    lean('leanAisleL', [3], [sph(-6.9, 1.8, 0.9, 3.2)], 0.05, 6);
    lean('leanAisleR', [4], [sph(6.9, 1.8, -0.9, 3.2)], 0.18, 6);
    lean('leanWest', [7, 8, 9, 10], [sph(-8.2, 1.0, 11.2, 3.0), sph(8.2, 1.0, 11.2, 3.0), sph(0, 1.2, 15.4, 4.0)], -0.1, 5);
    // lamps
    el('lamps', 6, [1.0, 2.0, 3.0, 4.0, 5.0, 5.8], s => A.setLamps(s), () => [sph(0, 6.5, -4.8, 3.6), sph(-2.4, 6.0, -7.4, 3.2), sph(2.4, 6.0, -7.4, 3.2)], { cue: 'lamp', posFn: () => V3(0, 5, -5) });
    // rose eye
    el('rose', 3, [2.2, 3.8, 5.6], s => A.setRose(s), () => [sph(0, 11.3, 17.5, 3.8)], { cue: 'glass', posFn: () => V3(0, 11.3, 17.5) });
    // stairs & door reshape light across the whole nave: they wait for closed eyes (or a gaze turned well away)
    const pit = () => [sph(0, -0.6, -3.6, 4.4), sph(0, 2.5, 0, 3.0)];
    el('stairs', 6, [1.3, 2.2, 3.1, 4.0, 4.9, 5.8], s => { A.setStairs(s); A.setLamps(this.get('lamps').s); }, pit, { cue: 'step', posFn: () => V3(0, 0, stairHeadZ(A.stairsN)), shadows: true, global: 2 });
    el('door', 6, [0.9, 1.9, 2.9, 3.8, 4.7, 5.6], s => A.setDoor(s), pit, { cue: 'door', posFn: () => V3(0, A.door.position.y + 1.2, G.chZ), shadows: true, global: 1 });
    this.frustum = new T.Frustum(); this.obsCam = new T.PerspectiveCamera(); this.pm = new T.Matrix4();
    this.forceAll(0);
  },
  get(id) { return this.els.find(e => e.id === id); },
  target(e) { let t = 0; for (const v of e.thr) if (this.W >= v) t++; return Math.min(e.max, t); },
  change(e, s, silent) {
    e.s = s; e.apply(s); e.last = this.time;
    if (e.posFn) e.pos.copy(e.posFn(e));
    Shadows.dirty.pl.fill(true);
    if (e.shadows || e.id === 'rose') { Shadows.dirty.moon = true; Shadows.dirty.crypt = true; }
    if (e.id === 'door' || e.id === 'stairs') Shadows.dirty.crypt = true;
    if (!silent && typeof Sound !== 'undefined') Sound.cue(e.cue, e.pos, e);
  },
  forceAll(s, only) {
    for (const e of this.els) { if (only && !e.id.startsWith(only)) continue; this.change(e, Math.min(e.max, e.id === 'rose' ? Math.round(s / 2) : s), true); }
    // dependent placements
    Actors.setLamps(this.get('lamps').s);
    for (const e of this.els) if (e.id.startsWith('lean')) e.apply(e.s);
    this.applyMood(true);
  },
  // global look: only ever retuned behind closed lids
  applyMood(force) {
    const door = this.get('door').s, k = this.phase === 'finale1' ? 1.7 : 1;
    const I = [0, 0.8, 1.0, 1.25, 1.6, 2.1, 2.7][door] * 42 * k;
    this.fxCrypt = [0.26 * I, 1.0 * I, 0.60 * I];
    this.mood = clamp(this.W / 6, 0, 1);
  },
  // called once at the instant the lids are fully shut
  onClosed() {
    if (this.phase !== 'play') return this.finaleStep(true);
    const pend = this.els.filter(e => this.target(e) > e.s && this.time - e.last >= e.cool * 0.5).sort((a, b) => a.due - b.due);
    let n = 0;
    for (const e of pend) { if (n >= 3) break; this.change(e, e.s + 1); n++; }
    this.applyMood();
    if (this.W >= 6.4 && this.els.every(e => e.s >= e.max)) { this.phase = 'finale0'; }
    return n;
  },
  finaleStep(onBlink) {
    const A = Actors;
    if (this.phase === 'finale0' && onBlink) {
      // every flame gone, the watchers gone, the door standing open
      for (const e of this.els) if (e.id.startsWith('lean')) A.setLean(e.groups, 6, true);
      for (const m of A.statues) m.userData.show = false;
      this.phase = 'finale1'; this.finaleT = 0; this.applyMood();
      Shadows.dirty.moon = Shadows.dirty.crypt = true; Shadows.dirty.pl.fill(true);
      if (typeof Sound !== 'undefined') Sound.finale(1);
    } else if (this.phase === 'finale1' && onBlink && this.finaleT > 2.5) {
      this.phase = 'finale2'; this.finaleT = 0;
      if (typeof Sound !== 'undefined') Sound.finale(2);
    }
  },
  reset() {
    this.W = 0; this.phase = 'play';
    for (const m of Actors.statues) m.userData.show = true;
    this.forceAll(0);
    if (typeof Sound !== 'undefined') Sound.finale(0);
  },
  update(dt, cam, eyesShut) {
    this.time += dt;
    if (this.phase === 'play' || this.phase === 'finale0') {
      const pending = this.els.filter(e => this.target(e) > e.s).length;
      this.W = Math.min(7, this.W + dt * this.rate * (pending >= 5 ? 0 : pending >= 3 ? 0.45 : 1));
    } else this.finaleT += dt;
    // widened frustum: what could possibly be seen right now
    const oc = this.obsCam;
    oc.fov = Math.min(170, cam.fov + 16); oc.aspect = cam.aspect * 1.12; oc.near = 0.05; oc.far = 120; oc.updateProjectionMatrix();
    oc.position.copy(cam.position); oc.quaternion.copy(cam.quaternion); oc.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(oc.projectionMatrix, oc.matrixWorldInverse));
    const fwd = V3(0, 0, -1).applyQuaternion(cam.quaternion);
    for (const e of this.els) {
      const tgt = this.target(e);
      if (tgt > e.s && e.due === 0) e.due = this.time; if (tgt <= e.s) e.due = 0;
      let seen = false;
      if (!eyesShut) {
        for (const s of e.spheres(e)) if (this.frustum.intersectsSphere(s)) { seen = true; break; }
        // light spilling from the crypt reaches everywhere once the door has opened far enough
        if (e.global && (this.get('door').s >= e.global + 1 || fwd.z < 0.35)) seen = true;
      }
      e.seen = seen;
      e.away = seen ? 0 : e.away + dt;
      if (this.phase === 'play' && !eyesShut && tgt > e.s && e.away > 0.45 && this.time - e.last >= e.cool) this.change(e, e.s + 1);
    }
  },
};
