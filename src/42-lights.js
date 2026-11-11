// Light rig: candle clusters (shadowed keys + small per-flame pools + airlight glows), bounce fills, flicker.
const NSL = 56, NGL = 16;
const CANDLE_COL = [1.0, 0.50, 0.17];
const Lights = {
  candles: [], groups: [],            // groups[g] = { idx:[], centre:V3, alive:1, flick:1, wax:[] }
  pl: [], sl: [], gl: [],
  agitation: 0,                       // 0 calm … 1 guttering in a draught
  uPLPos: new Float32Array(NPL * 4), uPLCol: new Float32Array(NPL * 4),
  uSLPos: new Float32Array(NSL * 4), uSLCol: new Float32Array(NSL * 4), slN: 0,
  uGLPos: new Float32Array(NGL * 4), uGLCol: new Float32Array(NGL * 4), glN: 0,
  init(candles) {
    this.candles = candles;
    for (const c of candles) {
      let g = this.groups[c.group]; if (!g) g = this.groups[c.group] = { idx: [], centre: V3(), alive: 1, flick: 1, wax: [] };
      g.idx.push(candles.indexOf(c)); g.centre.add(V3(...c.pos));
      c.f = 1;
    }
    for (const g of this.groups) if (g) g.centre.multiplyScalar(1 / g.idx.length);
    const key = (grp, I, range, size, lift = 0.05) => ({ grp, I, range, size, base: this.groups[grp].centre.clone().add(V3(0, lift, 0)), pos: V3(), cur: V3() });
    this.pl = [key(0, 5.2, 30, 0.16), key(1, 5.2, 30, 0.16), key(2, 11, 38, 0.34, 0.1), key(3, 6.0, 26, 0.2), key(4, 6.0, 26, 0.2)];
    for (const p of this.pl) p.pos.copy(p.base);
    const small = (pos, col, I, range, o = {}) => this.sl.push(Object.assign({ pos: V3(...pos), col, I, range, type: 0, grp: -1, cand: -1 }, o));
    candles.forEach((c, i) => {
      if (c.group === 0 || c.group === 1) small(c.pos, CANDLE_COL, 0.16, 2.0, { cand: i });
      else if (c.group === 5 || c.group === 6) small(c.pos, CANDLE_COL, 0.42, 3.4, { cand: i });
      else if (c.group === 11) small(c.pos, CANDLE_COL, 0.5, 3.2, { cand: i });
    });
    for (const g of [7, 8]) small(this.groups[g].centre.toArray(), CANDLE_COL, 1.5, 7, { grp: g });
    for (const g of [9, 10]) small(this.groups[g].centre.toArray(), CANDLE_COL, 0.9, 7.5, { grp: g });
    // bounce fills (diffuse-only, wrapped): warm near the clusters, cold where moonlight lands
    const fill = (pos, col, I, range, grp = -1) => small(pos, col, I, range, { type: 1, grp });
    fill([0, 1.3, -1.8], [1.0, 0.56, 0.24], 0.55, 9, 0);
    fill([0, 3.2, -9.2], [1.0, 0.56, 0.24], 1.0, 12, 2);
    fill([-6.6, 2.6, 0.9], [1.0, 0.56, 0.24], 0.5, 8, 3); fill([6.6, 2.6, -0.9], [1.0, 0.56, 0.24], 0.5, 8, 4);
    fill([-4.2, 1.2, -1.6], [0.42, 0.55, 1.0], 0.55, 9); fill([-4.2, 1.2, 3.4], [0.42, 0.55, 1.0], 0.5, 9);
    fill([0, 7.5, -3.0], [1.0, 0.60, 0.30], 1.5, 15, 0); fill([0, 7.5, -10.0], [1.0, 0.60, 0.30], 1.6, 14, 2);        // candle glow reaching up into the vaults
    fill([0.0, 5.5, -12.0], [0.45, 0.58, 1.0], 0.7, 11); fill([6.6, 0.8, -5], [0.42, 0.55, 1.0], 0.3, 8);
    fill([0, 3.2, 9.0], [0.40, 0.52, 1.0], 1.0, 13); fill([0, 8.5, 14.5], [0.45, 0.50, 1.0], 0.9, 12);            // night sky through the west windows
    // airlight glows
    const glow = (grp, k, eps) => this.gl.push({ grp, k, eps, pos: this.groups[grp].centre.clone() });
    for (let g = 0; g <= 11; g++) glow(g, 0.0011, g === 2 ? 0.45 : g >= 9 ? 0.18 : 0.3);
    this.lampLights = [];
  },
  addLamp(obj) {        // red sanctuary lamp: position supplied each frame by its owner
    const l = { pos: V3(), col: [1.0, 0.1, 0.05], I: 0.5, range: 4.2, type: 0, grp: -1, cand: -1, lamp: obj };
    this.sl.push(l); this.lampLights.push(l);
    this.gl.push({ grp: -1, k: 0.0012, eps: 0.2, pos: l.pos, col: [1.0, 0.1, 0.05] });
  },
  update(t) {
    for (const c of this.candles) {
      const ag = c.ag || 0, amp = 0.11 + 0.26 * ag, sp = 1 + 1.3 * ag;
      c.f = 1 + amp * ((vnoise1(t * 6.3 * sp + c.seed * 17.1) - 0.5) * 1.5 + (vnoise1(t * 15.7 * sp + c.seed * 5.3) - 0.5) * 0.8);
      if (ag > 0.5) c.f *= 1 - 0.5 * sstep(0.72, 0.95, vnoise1(t * 2.1 + c.seed * 3.3)) * (ag - 0.5) * 2;   // near-snuffing gusts
    }
    for (const g of this.groups) {
      if (!g) continue;
      let s = 0; for (const i of g.idx) s += this.candles[i].f;
      g.flick = s / g.idx.length * g.alive;
      for (const m of g.wax) m.userData.g.uniforms.uGlow.value = g.flick * 1.3;
    }
    // keys
    this.pl.forEach((p, k) => {
      const g = this.groups[p.grp];
      p.cur.copy(p.base);
      for (const i of g.idx) { const c = this.candles[i]; p.cur.x += (c.f - 1) * (c.pos[0] - g.centre.x) * 0.5; p.cur.y += (c.f - 1) * 0.05; p.cur.z += (c.f - 1) * (c.pos[2] - g.centre.z) * 0.5; }
      const I = p.I * g.flick;
      this.uPLPos.set([p.pos.x, p.pos.y, p.pos.z, p.range], k * 4);
      this.uPLCol.set([CANDLE_COL[0] * I, CANDLE_COL[1] * I, CANDLE_COL[2] * I, p.size], k * 4);
    });
    let n = 0;
    for (const l of this.sl) {
      let f = 1;
      if (l.cand >= 0) { const c = this.candles[l.cand]; f = c.f * this.groups[c.group].alive; l.pos.set(c.pos[0], c.pos[1], c.pos[2]); }
      else if (l.grp >= 0) f = this.groups[l.grp].flick;
      if (l.lamp) l.lamp.getWorldPosition(l.pos);
      const I = l.I * f; if (I <= 1e-4 || n >= NSL) continue;
      this.uSLPos.set([l.pos.x, l.pos.y, l.pos.z, l.range], n * 4);
      this.uSLCol.set([l.col[0] * I, l.col[1] * I, l.col[2] * I, l.type], n * 4);
      n++;
    }
    this.slN = n;
    n = 0;
    for (const g of this.gl) {
      const f = g.grp >= 0 ? this.groups[g.grp].flick * this.groups[g.grp].idx.length : 1, col = g.col || CANDLE_COL, k = g.k * f;
      if (k <= 1e-5 || n >= NGL) continue;
      this.uGLPos.set([g.pos.x, g.pos.y, g.pos.z, g.eps], n * 4);
      this.uGLCol.set([col[0] * k, col[1] * k, col[2] * k, 0], n * 4);
      n++;
    }
    this.glN = n;
  },
};
