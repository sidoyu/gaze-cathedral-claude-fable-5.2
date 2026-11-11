// The cathedral, built from measurements. Player stands at the origin looking down −Z toward the apse.
const G = {
  eye: 1.62,
  nx: 4.6, wt: 0.9, xin: 4.15, xout: 5.05,          // arcade wall centre line, thickness, faces
  ax: 9.0,                                          // aisle wall inner face
  capY: 5.2, top: 17.4,
  naveHs: 11.0, naveRise: 5.6, aisleHs: 5.8, aisleRise: 2.9,
  bays: [17.5, 12.5, 7.5, 2.5, -2.5, -7.5, -12.5],
  apseR: 4.15, apseHs: 13.6, apseRise: 3.0, apseZ: -12.5,
  chY: 1.3, chZ: -6.6,                              // raised chancel: floor height, front wall plane
  pitX: 1.3, pitNear: -0.4, stairEnd: -5.5, tread: 0.34, riser: 0.17, steps0: 10, stepsMax: 16, pitDeep: -4.6,
  railX: 1.43,
  doorHalf: 0.8, doorSpring: 1.55, doorR: 1.1,
};
const box = (w, h, d, x, y, z) => xf(new T.BoxGeometry(w, h, d), { p: [x, y, z] });
const boxMM = (x0, x1, y0, y1, z0, z1) => box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
const cyl = (r0, r1, h, seg, x, y, z) => xf(new T.CylinderGeometry(r1, r0, h, seg, 1, false), { p: [x, y + h / 2, z] });
const lathe = (pts, seg = 24) => new T.LatheGeometry(pts.map(p => new T.Vector2(p[0], p[1])), seg);
const ball = (r, x, y, z, ws = 10, hs = 8) => xf(new T.SphereGeometry(r, ws, hs), { p: [x, y, z] });
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } return g; }
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name], s = at.itemSize, a = at.array;
    for (let i = 0; i < at.count; i += 3) for (let k = 0; k < s; k++) { const t = a[(i + 1) * s + k]; a[(i + 1) * s + k] = a[(i + 2) * s + k]; a[(i + 2) * s + k] = t; }
  }
  return g;
}
// place a geometry authored in a local (X = u, Y = up, Z = n) frame
function frame(g, origin, u, n) {
  const m = new T.Matrix4().makeBasis(V3(u[0], u[1], u[2]), V3(0, 1, 0), V3(n[0], n[1], n[2])).setPosition(origin[0], origin[1], origin[2]);
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
  return g;
}
class FnCurve extends T.Curve { constructor(fn) { super(); this.fn = fn; } getPoint(t, target = V3()) { return this.fn(t, target); } }
const tube = (fn, segs, r, rs = 7) => new T.TubeGeometry(new FnCurve(fn), segs, r, rs, false);

function vaultWeb(x0, x1, z0, z1, Hs, rise, n = 20) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const R = 1.7, c0 = Math.sqrt(2 * R - 1);
  const dvp = t => { const a = Math.abs(t) + R - 1; return clamp(-Math.sign(t) * a / (Math.sqrt(Math.max(1e-4, R * R - a * a)) * c0), -7, 7); };
  const H = (x, z) => Hs + rise * Math.max(vaultProfile((x - cx) / hx), vaultProfile((z - cz) / hz));
  const P = [], N = [];
  const put = (x, z, bx) => {
    P.push(x, H(x, z), z);
    let nx = 0, nz = 0;
    if (bx) nx = rise * dvp((x - cx) / hx) / hx; else nz = rise * dvp((z - cz) / hz) / hz;
    const l = Math.hypot(nx, 1, nz); N.push(nx / l, -1 / l, nz / l);
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const xa = lerp(x0, x1, i / n), xb = lerp(x0, x1, (i + 1) / n), za = lerp(z0, z1, j / n), zb = lerp(z0, z1, (j + 1) / n);
    const tris = ((xa + xb) / 2 - cx) * ((za + zb) / 2 - cz) < 0
      ? [[xa, za, xb, za, xa, zb], [xb, za, xb, zb, xa, zb]]
      : [[xa, za, xb, za, xb, zb], [xa, za, xb, zb, xa, zb]];
    for (const t of tris) {
      const mx = (t[0] + t[2] + t[4]) / 3, mz = (t[1] + t[3] + t[5]) / 3;
      const bx = vaultProfile((mx - cx) / hx) >= vaultProfile((mz - cz) / hz);
      put(t[0], t[1], bx); put(t[2], t[3], bx); put(t[4], t[5], bx);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new T.BufferAttribute(new Float32Array(N), 3));
  return g;
}
function vaultRibs(B, x0, x1, z0, z1, Hs, rise, o = {}) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, drop = 0.05;
  const s = t => t * 2 - 1;
  const rd = o.diag || 0.12, rt = o.trans || 0.2, rw = o.wall || 0.09;
  for (const sg of [1, -1]) B.add('stone', tube((t, v) => v.set(cx + hx * s(t), Hs + rise * vaultProfile(s(t)) - drop, cz + sg * hz * s(t)), 30, rd));
  if (o.transA !== false) B.add('stone', tube((t, v) => v.set(cx + hx * s(t), Hs + rise * vaultProfile(s(t)) - drop, z0), 30, rt, 8));
  if (o.transB) B.add('stone', tube((t, v) => v.set(cx + hx * s(t), Hs + rise * vaultProfile(s(t)) - drop, z1), 30, rt, 8));
  for (const x of [x0, x1]) B.add('stone', tube((t, v) => v.set(x, Hs + rise * vaultProfile(s(t)) - drop, cz + hz * s(t)), 24, rw, 6));
  if (o.ridge) B.add('stone', tube((t, v) => v.set(cx, Hs + rise - drop, cz + hz * s(t)), 4, 0.07, 6));
  B.add('stone', xf(new T.SphereGeometry(o.boss || 0.3, 14, 10), { p: [cx, Hs + rise - 0.1, cz], s: [1, 0.55, 1] }));
}
// A single stained-glass pane as a world-space quad. |normal| carries the pane's sky brightness.
function glassQuad(B, kind, variant, c, u, w, h, nIn, glow) {
  const [u0, v0, u1, v1] = kind === 'rose' ? [0, 0, 1, 1] : GLASS[kind].rect(variant);   // rose variants are switched by uniform
  const p = (a, b) => [c[0] + u[0] * a * w / 2, c[1] + b * h, c[2] + u[2] * a * w / 2];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(new Float32Array([...p(-1, 0), ...p(1, 0), ...p(1, 1), ...p(-1, 1)]), 3));
  g.setAttribute('normal', new T.BufferAttribute(new Float32Array([0, 1, 2, 3].flatMap(() => [nIn[0] * glow, nIn[1] * glow, nIn[2] * glow])), 3));
  g.setAttribute('uv', new T.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  let l = B.groups.get('glass:' + kind); if (!l) B.groups.set('glass:' + kind, l = { key: 'glass:' + kind, list: [] });
  l.list.push(g);
}

function pierGeo() {
  const parts = [];
  parts.push(xf(new T.CylinderGeometry(0.97, 0.97, 0.36, 8), { p: [0, 0.18, 0], r: [0, Math.PI / 8, 0] }));
  parts.push(lathe([[0.93, 0.36], [0.93, 0.42], [0.90, 0.455], [0.84, 0.47], [0.80, 0.50], [0.80, 0.53], [0.84, 0.56], [0.82, 0.60], [0.74, 0.63], [0.70, 0.64]], 32));
  parts.push(cyl(0.57, 0.57, 3.95, 28, 0, 0.62, 0));
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4, major = k % 2 === 0, d = major ? 0.60 : 0.565, r = major ? 0.17 : 0.10;
    parts.push(cyl(r, r, 3.95, major ? 14 : 10, Math.sin(a) * d, 0.62, Math.cos(a) * d));
    if (major) parts.push(xf(new T.TorusGeometry(r + 0.012, 0.022, 6, 14), { p: [Math.sin(a) * d, 2.6, Math.cos(a) * d], r: [Math.PI / 2, 0, 0] }));
  }
  parts.push(lathe([[0.60, 4.50], [0.69, 4.53], [0.72, 4.57], [0.69, 4.61], [0.635, 4.635], [0.625, 4.70], [0.64, 4.78], [0.70, 4.86], [0.79, 4.915], [0.805, 4.94], [0.77, 4.957], [0.80, 4.975], [0.90, 5.02], [0.95, 5.05]], 40));
  parts.push(xf(new T.CylinderGeometry(1.0, 0.97, 0.15, 8), { p: [0, 5.125, 0], r: [0, Math.PI / 8, 0] }));
  return mergeGeos(parts.map(bare));
}
function colonnette(B, x, z, y0, y1, r, key = 'stone') {
  B.add(key, cyl(r, r, y1 - y0 - 0.3, 10, x, y0 + 0.1, z));
  B.add(key, xf(lathe([[r * 1.5, 0], [r * 1.5, 0.05], [r * 1.15, 0.1], [r, 0.1]], 12), { p: [x, y0, z] }));
  B.add(key, xf(lathe([[r, 0], [r * 1.15, 0.04], [r * 1.1, 0.08], [r * 1.5, 0.17], [r * 1.65, 0.2]], 12), { p: [x, y1 - 0.2, z] }));
}

// candles: wax geometry + a record for the flame/light system
function addCandle(B, list, x, y, z, r, h, group, o = {}) {
  // |normal| − 1 encodes metres below the wick, so the wax can glow from its flame downward
  const pack = (g, top, extra) => { const n = g.attributes.normal, p = g.attributes.position; for (let i = 0; i < n.count; i++) { const k = 1 + Math.max(0, top - p.getY(i)) + extra; n.setXYZ(i, n.getX(i) * k, n.getY(i) * k, n.getZ(i) * k); } return g; };
  B.add('wax:' + group, pack(bare(cyl(r, r * 0.94, h, 10, x, y, z)), y + h, 0));
  if (o.puddle) B.add('wax:' + group, pack(bare(cyl(r * 2.6, r * 1.6, 0.007, 12, x + r * 0.5, y, z + r * 0.3)), y + h, 0.05));
  B.add('iron', cyl(0.0028, 0.0022, 0.016, 5, x, y + h, z));
  list.push({ pos: [x, y + h + 0.012, z], size: (o.size || 1) * (0.052 + r * 0.9), group, seed: list.length * 1.618 });
}
function ironStand(B, list, x, y, z, h, group, o = {}) {
  B.add('iron', cyl(0.014, 0.011, h, 8, x, y, z));
  B.add('iron', cyl(0.15, 0.13, 0.018, 16, x, y, z));
  for (let k = 0; k < 3; k++) { const a = k * 2.094 + (o.rot || 0); B.add('iron', xf(new T.BoxGeometry(0.02, 0.02, 0.22), { p: [x + Math.sin(a) * 0.11, y + 0.045, z + Math.cos(a) * 0.11], r: [0.25, a, 0] })); }
  B.add('iron', xf(new T.TorusGeometry(0.02, 0.008, 6, 10), { p: [x, y + h * 0.55, z], r: [Math.PI / 2, 0, 0] }));
  B.add('iron', xf(lathe([[0.012, 0], [0.085, 0.012], [0.09, 0.03], [0.082, 0.03], [0.02, 0.018]], 14), { p: [x, y + h, z] }));
  addCandle(B, list, x, y + h + 0.018, z, o.r || 0.024, o.ch || 0.22, group, o);
}

function buildCathedral() {
  const B = new Batch(), rng = mulberry32(7);
  const candles = [];
  const { xin, xout, ax, capY, top } = G;

  // ── floors ──
  B.add('floor', boxMM(-9.8, -G.pitX, -0.4, 0, -13.4, 18.6));
  B.add('floor', boxMM(G.pitX, 9.8, -0.4, 0, -13.4, 18.6));
  B.add('floor', boxMM(-G.pitX, G.pitX, -0.4, 0, G.pitNear, 18.6));
  // pit walls below the floor slabs, and its bottom
  for (const s of [-1, 1]) B.add('ashlar', boxMM(s > 0 ? G.pitX : -G.pitX - 0.3, s > 0 ? G.pitX + 0.3 : -G.pitX, G.pitDeep, -0.4, G.chZ, G.pitNear));
  B.add('ashlar', boxMM(-G.pitX, G.pitX, G.pitDeep, -0.4, G.pitNear, G.pitNear + 0.3));
  // stone coping over the slab edges round the pit
  for (const s of [-1, 1]) B.add('stone', boxMM(s > 0 ? G.pitX - 0.025 : -G.pitX, s > 0 ? G.pitX : -G.pitX + 0.025, -0.42, -0.001, G.chZ, G.pitNear));
  B.add('stone', boxMM(-G.pitX, G.pitX, -0.42, -0.001, G.pitNear - 0.025, G.pitNear));
  B.add('ashlar', boxMM(-1.6, 1.6, G.pitDeep - 0.3, G.pitDeep, G.chZ, G.pitNear + 0.3));

  // ── arcades, clerestory, piers, vault shafts ──
  const pier = pierGeo();
  for (const s of [-1, 1]) {
    for (let b = 0; b < 6; b++) {
      const zA = G.bays[b], zc = zA - 2.5;
      // wall slab over the arcade, pierced by the clerestory lancet (local u runs so that extrusion points outward)
      const outer = [[0, capY], [0.55, capY], ...archPts(1.95, 3.9, capY, 16, 2.5).slice(1, -1), [4.45, capY], [5, capY], [5, top], [0, top]];
      const w = extrudePoly(outer, [lancetPts(0.75, 9.9, 13.0, 1.5, 12, 2.5)], G.wt);
      B.add('ashlar', frame(w, [s * xin, 0, s > 0 ? zA : zA - 5], [0, 0, -s], [s, 0, 0]));
      // moulded arch orders, both faces
      for (const [face, dir] of [[xin, -1], [xout, 1]]) {
        const band = [...archPts(1.95 + 0.2, 3.9 + 0.2, capY, 16, 2.5), ...archPts(1.95, 3.9, capY, 16, 2.5).reverse()];
        const g = extrudePoly(band, null, 0.07);
        B.add('stone', frame(g, [s * (face + (dir < 0 ? -0.07 : 0)), 0, s > 0 ? zA : zA - 5], [0, 0, -s], [s, 0, 0]));
      }
      // window surround on the nave face
      {
        B.add('stone', frame(extrudePoly(lancetPts(0.75 + 0.14, 9.9 - 0.14, 13.0, 1.5 + 0.14, 12, 2.5), [lancetPts(0.75, 9.9, 13.0, 1.5, 12, 2.5)], 0.05), [s * (xin - 0.05), 0, s > 0 ? zA : zA - 5], [0, 0, -s], [s, 0, 0]));
      }
      // string courses
      B.add('stone', boxMM(s * xin - 0.07, s * xin + 0.07, 9.18, 9.32, zA - 5, zA));
      B.add('stone', boxMM(s * xin - 0.04, s * xin + 0.04, 9.32, 9.40, zA - 5, zA));
      glassQuad(B, 'lancet', (b * 3 + (s > 0 ? 1 : 4)) % 8, [s * G.nx, 9.9, zc], [0, 0, 1], 1.5, 4.4, [-s, 0, 0], s > 0 ? 1.0 : 0.34);
    }
    for (const z of G.bays) {
      B.add('stone', xf(pier.clone(), { p: [s * G.nx, 0, z] }));
      colonnette(B, s * (xin - 0.11), z, capY, G.naveHs + 0.05, 0.14);
      colonnette(B, s * (xin - 0.05), z + 0.27, capY, G.naveHs + 0.05, 0.075);
      colonnette(B, s * (xin - 0.05), z - 0.27, capY, G.naveHs + 0.05, 0.075);
      colonnette(B, s * (xout + 0.08), z, capY, G.aisleHs + 0.05, 0.13);
    }
  }

  // ── nave vault ──
  for (let b = 0; b < 6; b++) {
    const zA = G.bays[b], zB = zA - 5;
    B.add('plaster2', vaultWeb(-xin, xin, zB, zA, G.naveHs, G.naveRise, 22));
    vaultRibs(B, -xin, xin, zB, zA, G.naveHs, G.naveRise, { transB: b === 0, ridge: true });
  }
  // chancel arch: a heavier order where nave meets apse
  B.add('stone', tube((t, v) => v.set(xin * (t * 2 - 1), G.naveHs + G.naveRise * vaultProfile(t * 2 - 1) - 0.12, G.apseZ - 0.1), 36, 0.3, 8));

  // ── aisles: outer walls with lancets, vaults ──
  for (const s of [-1, 1]) {
    for (let b = 0; b < 6; b++) {
      const zA = G.bays[b], zc = zA - 2.5;
      const w = extrudePoly([[0, 0], [5, 0], [5, 9.6], [0, 9.6]], [lancetPts(0.75, 2.2, 5.3, 1.5, 12, 2.5)], 0.8);
      B.add('ashlar', frame(w, [s * ax, 0, s > 0 ? zA : zA - 5], [0, 0, -s], [s, 0, 0]));
      B.add('stone', frame(extrudePoly(lancetPts(0.75 + 0.13, 2.2 - 0.13, 5.3, 1.5 + 0.13, 12, 2.5), [lancetPts(0.75, 2.2, 5.3, 1.5, 12, 2.5)], 0.05), [s * (ax - 0.05), 0, s > 0 ? zA : zA - 5], [0, 0, -s], [s, 0, 0]));
      B.add('stone', boxMM(s * ax - (s > 0 ? 0.09 : 0), s * ax + (s > 0 ? 0 : 0.09), 1.88, 2.0, zA - 5, zA));       // dado course
      B.add('stone', boxMM(s * ax - (s > 0 ? 0.28 : 0), s * ax + (s > 0 ? 0 : 0.28), 0, 0.46, zA - 5, zA));        // wall bench
      glassQuad(B, 'lancet', (b * 5 + (s > 0 ? 0 : 3)) % 8, [s * (ax + 0.4), 2.2, zc], [0, 0, 1], 1.5, 4.4, [-s, 0, 0], s > 0 ? 0.9 : 0.3);
      const x0 = Math.min(s * xout, s * ax), x1 = Math.max(s * xout, s * ax);
      B.add('plaster2', vaultWeb(x0, x1, zA - 5, zA, G.aisleHs, G.aisleRise, 14));
      vaultRibs(B, x0, x1, zA - 5, zA, G.aisleHs, G.aisleRise, { diag: 0.085, trans: 0.13, wall: 0.07, boss: 0.18, transB: b === 0 });
    }
    for (const z of G.bays) colonnette(B, s * (ax - 0.1), z, 0.46, G.aisleHs + 0.05, 0.13);
    // aisle end walls
    B.add('ashlar', boxMM(Math.min(s * xout, s * 9.8), Math.max(s * xout, s * 9.8), 0, 9.6, 17.5, 18.4));
    B.add('ashlar', boxMM(Math.min(s * xout, s * 9.8), Math.max(s * xout, s * 9.8), 0, 9.6, -13.4, -12.5));
  }

  // ── west front: portal, doors, rose ──
  {
    const circ = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; circ.push([Math.cos(a) * 3.0, 11.3 + Math.sin(a) * 3.0]); }
    const portal = archPts(1.5, 3.0, 3.2, 14);
    const outer = [[-xout, 0], [-1.5, 0], ...portal, [1.5, 0], [xout, 0], [xout, top], [-xout, top]];
    B.add('ashlar', frame(extrudePoly(outer, [circ], 1.0), [0, 0, 17.5], [1, 0, 0], [0, 0, 1]));
    B.add('stone', frame(extrudePoly(circ.map(p => [p[0] * 1.1, 11.3 + (p[1] - 11.3) * 1.1]), [circ], 0.08), [0, 0, 17.42], [1, 0, 0], [0, 0, 1]));
    const pband = [[-1.5 - 0.22, 0], ...archPts(1.5 + 0.22, 3.0 + 0.22, 3.2, 14), [1.5 + 0.22, 0], [1.5, 0], ...archPts(1.5, 3.0, 3.2, 14).reverse(), [-1.5, 0]];
    B.add('stone', frame(extrudePoly(pband, null, 0.09), [0, 0, 17.41], [1, 0, 0], [0, 0, 1]));
    // doors (closed), boarded oak with iron straps
    const leaf = [[-1.5, 0], [1.5, 0], ...archPts(1.5, 3.0, 3.2, 14).reverse()];
    B.add('wood', frame(extrudePoly(leaf, null, 0.12), [0, 0, 17.85], [1, 0, 0], [0, 0, 1]));
    for (const y of [0.6, 1.8, 3.0]) for (const s of [-1, 1]) B.add('iron', boxMM(s > 0 ? 0.06 : -1.45, s > 0 ? 1.45 : -0.06, y - 0.045, y + 0.045, 17.83, 17.86));
    B.add('iron', boxMM(-0.02, 0.02, 0, 5.7, 17.83, 17.86));
    for (const s of [-1, 1]) B.add('iron', xf(new T.TorusGeometry(0.09, 0.014, 6, 16), { p: [s * 0.3, 1.25, 17.82] }));
    glassQuad(B, 'rose', 0, [0, 8.3, 18.0], [1, 0, 0], 6, 6, [0, 0, -1], 0.42);
    colonnette(B, -xin + 0.1, 17.4, 0, G.naveHs + 0.05, 0.14);
    colonnette(B, xin - 0.1, 17.4, 0, G.naveHs + 0.05, 0.14);
  }

  // ── apse: five-sided, tall lancets, ribbed semi-dome ──
  {
    const C = [0, 0, G.apseZ], rv = G.apseR, n = 5, seg = Math.PI / n;
    const V = k => [C[0] + rv * Math.cos(k * seg), 0, C[2] - rv * Math.sin(k * seg)];
    for (let k = 0; k < n; k++) {
      const a = V(k), b = V(k + 1), L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const u = [(b[0] - a[0]) / L, 0, (b[2] - a[2]) / L], th = (k + 0.5) * seg, nOut = [Math.cos(th), 0, -Math.sin(th)];
      const w = extrudePoly([[0, 0.9], [L, 0.9], [L, top], [0, top]], [lancetPts(0.75, 5.0, 11.9, 1.5, 12, L / 2)], 0.9);
      B.add('ashlar', frame(w, a, u, nOut));
      B.add('stone', frame(extrudePoly(lancetPts(0.75 + 0.13, 5.0 - 0.13, 11.9, 1.5 + 0.13, 12, L / 2), [lancetPts(0.75, 5.0, 11.9, 1.5, 12, L / 2)], 0.05), [a[0] - nOut[0] * 0.05, 0, a[2] - nOut[2] * 0.05], u, nOut));
      const mid = [(a[0] + b[0]) / 2 + nOut[0] * 0.45, 5.0, (a[2] + b[2]) / 2 + nOut[2] * 0.45];
      const moonFacing = [1.0, 1.0, 0.85, 0.45, 0.3][k];
      glassQuad(B, 'apse', k, mid, u, 1.5, 8.2, [-nOut[0], 0, -nOut[2]], moonFacing);
      // string course under the sills
      const sc = box(L, 0.14, 0.12, 0, 0, 0);
      B.add('stone', frame(sc, [a[0] + u[0] * L / 2 - nOut[0] * 0.05, 4.7, a[2] + u[2] * L / 2 - nOut[2] * 0.05], u, nOut));
    }
    const apo = rv * Math.cos(seg / 2);
    const Rth = th => { const m = ((th % seg) + seg) % seg - seg / 2; return apo / Math.cos(m) - 0.02; };
    // dome
    {
      const P = [], N = [], nr = 12, na = 40;
      const pt = (i, j) => { const th = Math.PI * j / na, rho = i / nr, R = Rth(th) * rho; return [C[0] + R * Math.cos(th), G.apseHs + G.apseRise * vaultProfile(rho), C[2] - R * Math.sin(th)]; };
      for (let i = 0; i < nr; i++) for (let j = 0; j < na; j++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        for (const tri of [[a, b, c], [a, c, d]]) {
          const e1 = V3().subVectors(V3(...tri[1]), V3(...tri[0])), e2 = V3().subVectors(V3(...tri[2]), V3(...tri[0])), nn = e1.cross(e2).normalize();
          if (nn.y > 0) nn.negate();
          for (const p of tri) { P.push(...p); N.push(nn.x, nn.y, nn.z); }
        }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(P), 3));
      g.setAttribute('normal', new T.BufferAttribute(new Float32Array(N), 3));
      B.add('plaster2', smoothNormals(g, 50));
    }
    for (let k = 0; k <= n; k++) {
      const v = V(k);
      if (k > 0 && k < n) colonnette(B, v[0] * 0.975, C[2] + (v[2] - C[2]) * 0.975, G.chY, G.apseHs + 0.05, 0.13);
      B.add('stone', tube((t, o) => o.set(C[0] + (v[0] - C[0]) * (1 - t) * 0.985, G.apseHs + G.apseRise * vaultProfile(1 - t) - 0.05, C[2] + (v[2] - C[2]) * (1 - t) * 0.985), 24, 0.11));
    }
    B.add('stone', xf(new T.SphereGeometry(0.34, 14, 10), { p: [C[0], G.apseHs + G.apseRise - 0.1, C[2]], s: [1, 0.55, 1] }));
  }

  // ── raised chancel over the crypt ──
  {
    for (const s of [-1, 1]) {
      B.add('ashlar', boxMM(s > 0 ? 1.0 : -4.0, s > 0 ? 4.0 : -1.0, G.pitDeep, G.chY, G.chZ - 0.5, G.chZ));
      B.add('ashlar', boxMM(s > 0 ? 3.7 : -4.0, s > 0 ? 4.0 : -3.7, 0, G.chY, G.apseZ, G.chZ - 0.5));
      // flanking stairs up
      for (let k = 0; k < 7; k++) B.add('stone', boxMM(s > 0 ? 1.9 : -3.9, s > 0 ? 3.9 : -1.9, 0, (k + 1) * G.chY / 7, G.chZ, -4.5 - 0.3 * k));
      B.add('stone', boxMM(s > 0 ? 1.84 : -1.9, s > 0 ? 1.9 : -1.84, 0, 0.14, G.chZ, -4.5));
    }
    B.add('floor', boxMM(-4.0, 4.0, 0.9, G.chY, -17.2, G.chZ - 0.5));
    // parapet over the crypt door (also hides the sliding door panel's top)
    B.add('stone', boxMM(-1.62, 1.62, G.chY, 2.36, G.chZ - 0.54, G.chZ + 0.02));
    B.add('stone', boxMM(-1.7, 1.7, 2.36, 2.47, G.chZ - 0.6, G.chZ + 0.08));
    for (let k = 0; k < 7; k++) {                       // blind arcade on the parapet face
      const cx = -1.26 + k * 0.42;
      B.add('stone', frame(extrudePoly(lancetPts(0.17, G.chY + 0.12, G.chY + 0.6, 0.34, 6, cx), [lancetPts(0.13, G.chY + 0.16, G.chY + 0.6, 0.26, 6, cx)], 0.035), [0, 0, G.chZ + 0.02], [1, 0, 0], [0, 0, 1]));
    }
    // altar on its predella
    B.add('stone', boxMM(-2.3, 2.3, G.chY, 1.45, -11.4, -8.9));
    B.add('stone', boxMM(-1.9, 1.9, 1.45, 1.6, -11.2, -9.3));
    B.add('stone', boxMM(-1.3, 1.3, 1.6, 2.58, -10.8, -9.9));
    B.add('stone', boxMM(-1.38, 1.38, 2.58, 2.66, -10.88, -9.82));
    for (const s of [-1, 1]) B.add('stone', cyl(0.09, 0.09, 0.98, 10, s * 1.18, 1.6, -9.86));
    B.add('cloth', boxMM(-1.42, 1.42, 2.66, 2.685, -10.92, -9.78));
    B.add('cloth', boxMM(-1.42, 1.42, 2.22, 2.675, -9.795, -9.78));
    for (const s of [-1, 1]) B.add('cloth', boxMM(s > 0 ? 1.405 : -1.42, s > 0 ? 1.42 : -1.405, 2.05, 2.675, -10.92, -9.78));
    B.add('brass', boxMM(-1.42, 1.42, 2.28, 2.33, -9.776, -9.772));
    // six altar candlesticks and the radiant emblem
    const stick = h => lathe([[0.075, 0], [0.08, 0.015], [0.05, 0.04], [0.022, 0.07], [0.018, h * 0.45], [0.034, h * 0.5], [0.018, h * 0.55], [0.016, h - 0.05], [0.05, h - 0.02], [0.055, h], [0.02, h]], 14);
    [-1.1, -0.7, -0.3, 0.3, 0.7, 1.1].forEach((x, i) => {
      const h = 0.46;
      B.add('brass', xf(stick(h), { p: [x, 2.685, -10.55] }));
      addCandle(B, candles, x, 2.685 + h, -10.55, 0.021, 0.52 - Math.abs(x) * 0.12, 2);
    });
    B.add('brass', xf(stick(0.5), { p: [0, 2.685, -10.62] }));
    B.add('brass', xf(new T.CylinderGeometry(0.15, 0.15, 0.02, 24), { p: [0, 3.36, -10.62], r: [Math.PI / 2, 0, 0] }));
    B.add('brass', xf(new T.TorusGeometry(0.15, 0.014, 8, 24), { p: [0, 3.36, -10.62] }));
    B.add('iron', ball(0.05, 0, 3.36, -10.605, 10, 8));
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, len = k % 2 ? 0.11 : 0.19;
      B.add('brass', xf(new T.ConeGeometry(0.02, len, 4), { p: [Math.cos(a) * (0.165 + len / 2), 3.36 + Math.sin(a) * (0.165 + len / 2), -10.62], r: [0, 0, a - Math.PI / 2] }));
    }
    // reredos: stone screen with gilded niches
    const holes = [-1.76, -0.88, 0, 0.88, 1.76].map(cx => lancetPts(0.33, 0.55, 2.55 + (cx === 0 ? 0.35 : 0), 0.66, 8, cx));
    const outer = [[-2.4, 0], [2.4, 0], [2.4, 3.75], [0.55, 3.75], [0, 4.75], [-0.55, 3.75], [-2.4, 3.75]];
    B.add('stone', frame(extrudePoly(outer, holes, 0.32), [0, G.chY, -11.95], [1, 0, 0], [0, 0, 1]));
    B.add('brass', boxMM(-2.3, 2.3, G.chY + 0.3, G.chY + 3.7, -11.9, -11.86));
    for (const x of [-2.36, -1.32, -0.44, 0.44, 1.32, 2.36]) {
      B.add('stone', cyl(0.07, 0.07, 3.75, 8, x, G.chY, -11.6));
      B.add('stone', xf(new T.ConeGeometry(0.11, 0.7, 4), { p: [x, G.chY + 3.75 + 0.35, -11.6], r: [0, Math.PI / 4, 0] }));
    }
    B.add('stone', xf(new T.ConeGeometry(0.13, 0.8, 4), { p: [0, G.chY + 4.75 + 0.36, -11.78], r: [0, Math.PI / 4, 0] }));
    // tall paschal candlesticks flanking the altar
    for (const s of [-1, 1]) {
      B.add('brass', xf(lathe([[0.17, 0], [0.18, 0.03], [0.10, 0.09], [0.035, 0.16], [0.03, 0.55], [0.06, 0.60], [0.03, 0.66], [0.028, 1.12], [0.085, 1.18], [0.095, 1.21], [0.03, 1.21]], 16), { p: [s * 2.0, G.chY, -9.25] }));
      addCandle(B, candles, s * 2.0, G.chY + 1.21, -9.25, 0.042, 0.6, 2, { size: 1.25 });
    }
  }

  // ── pews ──
  {
    const end = extrudePoly([[0, 0], [0.56, 0], [0.56, 0.5], [0.36, 0.58], [0.34, 0.86], [0.28, 1.0], [0.2, 1.12], [0.12, 1.0], [0.06, 0.86], [0.04, 0.58], [0, 0.5]], null, 0.05, 10);
    for (const s of [-1, 1]) for (let k = 0; k < 11; k++) {
      const z = 4.0 + k * 1.05, x0 = s > 0 ? 1.25 : -3.55, x1 = x0 + 2.3;
      B.add('woodH', boxMM(x0, x1, 0.43, 0.475, z - 0.02, z + 0.4));
      B.add('woodH', xf(new T.BoxGeometry(2.3, 0.56, 0.035), { p: [(x0 + x1) / 2, 0.72, z + 0.44], r: [-0.12, 0, 0] }));
      B.add('woodH', boxMM(x0, x1, 0.08, 0.12, z - 0.26, z - 0.14));
      for (const x of [x0 - 0.05, x1]) B.add('wood', frame(end.clone(), [x, 0, z + 0.5], [0, 0, -1], [1, 0, 0]));
    }
  }

  // ── the railed way to the crypt stair ──
  {
    for (const s of [-1, 1]) {
      const x = s * G.railX;
      for (let k = 0; k <= 10; k++) {
        const z = -0.5 - k * 0.6, gate = k === 0;
        B.add('iron', boxMM(x - (gate ? 0.024 : 0.014), x + (gate ? 0.024 : 0.014), 0, gate ? 1.06 : 0.95, z - (gate ? 0.024 : 0.014), z + (gate ? 0.024 : 0.014)));
        if (!gate) B.add('iron', ball(0.028, x, 0.985, z, 8, 6));
        if (k < 10) for (let j = 1; j < 4; j++) B.add('iron', boxMM(x - 0.006, x + 0.006, 0.12, 0.93, z - j * 0.15 - 0.006, z - j * 0.15 + 0.006));
      }
      B.add('iron', boxMM(x - 0.019, x + 0.019, 0.93, 0.96, -6.55, -0.5));
      B.add('iron', boxMM(x - 0.011, x + 0.011, 0.10, 0.125, -6.55, -0.5));
      // pricket candle on each gate post
      B.add('iron', xf(lathe([[0.012, 0], [0.07, 0.012], [0.075, 0.028], [0.066, 0.028], [0.02, 0.016]], 12), { p: [x, 1.06, -0.5] }));
      addCandle(B, candles, x, 1.078, -0.5, 0.026, 0.17, s < 0 ? 0 : 1);
    }
  }

  // ── candles ──
  const cluster = (cx, cz, n, rad, group, y = 0) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.283, d = Math.sqrt(rng()) * rad;
      addCandle(B, candles, cx + Math.cos(a) * d, y, cz + Math.sin(a) * d, 0.022 + rng() * 0.02, 0.07 + rng() * rng() * 0.42, group, { puddle: true });
    }
  };
  cluster(-2.25, -1.55, 6, 0.42, 0); cluster(2.2, -1.75, 6, 0.42, 1);
  cluster(-1.64, -3.5, 3, 0.16, 5); cluster(1.64, -3.3, 3, 0.16, 6);
  cluster(-1.66, -5.3, 2, 0.14, 5); cluster(1.66, -5.5, 2, 0.14, 6);
  for (const s of [-1, 1]) for (const k of [1, 3, 5]) addCandle(B, candles, s * 2.02, (k + 1) * G.chY / 7, -4.5 - 0.3 * k - 0.13, 0.026, 0.12 + rng() * 0.12, s < 0 ? 5 : 6, { puddle: true });
  ironStand(B, candles, -2.95, 0, -0.55, 1.36, 0, { rot: 0.4 }); ironStand(B, candles, 2.9, 0, -0.7, 1.42, 1, { rot: 1.3 });
  // aisle candelabra
  for (const [s, z, grp] of [[-1, 0.9, 3], [1, -0.9, 4]]) {
    const x = s * 6.9;
    B.add('iron', cyl(0.024, 0.018, 1.62, 10, x, 0, z));
    B.add('iron', cyl(0.22, 0.19, 0.03, 18, x, 0, z));
    B.add('iron', xf(new T.TorusGeometry(0.3, 0.012, 6, 28), { p: [x, 1.5, z], r: [Math.PI / 2, 0, 0] }));
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * 6.283, px = x + Math.cos(a) * 0.3, pz = z + Math.sin(a) * 0.3;
      B.add('iron', xf(new T.BoxGeometry(0.3, 0.012, 0.012), { p: [x + Math.cos(a) * 0.15, 1.5, z + Math.sin(a) * 0.15], r: [0, -a, 0] }));
      B.add('iron', xf(lathe([[0.008, 0], [0.05, 0.01], [0.055, 0.022], [0.048, 0.022], [0.012, 0.012]], 10), { p: [px, 1.51, pz] }));
      addCandle(B, candles, px, 1.522, pz, 0.019, 0.16 + rng() * 0.1, grp);
    }
    B.add('iron', xf(lathe([[0.01, 0], [0.06, 0.012], [0.066, 0.026], [0.058, 0.026], [0.014, 0.014]], 12), { p: [x, 1.62, z] }));
    addCandle(B, candles, x, 1.634, z, 0.026, 0.3, grp);
  }
  // votive racks far down the aisles, and stands by the west door
  for (const s of [-1, 1]) {
    const x = s * 8.2, z = 11.2;
    for (let t = 0; t < 3; t++) {
      B.add('iron', boxMM(x - 0.2 - (s > 0 ? 0 : 0), x + 0.2, 0.82 + t * 0.13, 0.835 + t * 0.13, z - 0.55, z + 0.55));
      for (let k = 0; k < 6; k++) if (rng() < 0.8) addCandle(B, candles, x + s * (t - 1) * 0.11, 0.835 + t * 0.13, z - 0.45 + k * 0.18, 0.017, 0.05 + rng() * 0.06, s < 0 ? 7 : 8, { size: 0.8 });
    }
    for (const dz of [-0.55, 0.55]) B.add('iron', boxMM(x - 0.2, x + 0.2, 0, 1.1, z + dz - 0.012, z + dz + 0.012));
    ironStand(B, candles, s * 2.45, 0, 15.4, 1.5, s < 0 ? 9 : 10, { rot: s });
  }

  // two candles on the landing before the sealed door; they sink with it
  for (const [x, h] of [[-0.64, 0.26], [0.62, 0.19]]) candles.push({ pos: [x, doorBaseY(G.steps0) + h + 0.012, G.chZ + 0.42], size: 0.08, group: 11, seed: candles.length * 1.618, follow: h + 0.012 });

  // ── statue pedestals ──
  const pedestal = () => lathe([[0.44, 0], [0.44, 0.13], [0.38, 0.18], [0.34, 0.25], [0.34, 0.96], [0.38, 1.03], [0.44, 1.08], [0.44, 1.2], [0.0, 1.2]], 24);
  const pedestals = [[-3.25, -2.5], [-3.25, 2.5], [3.25, -2.5], [3.25, 2.5], [-2.7, 16.3], [2.7, 16.3]];
  for (const [x, z] of pedestals) B.add('stone', xf(pedestal(), { p: [x, 0, z] }));

  return { statics: B.build(), candles, pedestals };
}

// ───────────── moving parts ─────────────
// Stair flight for n risers: treads descend toward −Z from the head; everything below is solid.
function stairGeo(n) {
  const parts = [], zHead = G.stairEnd + G.tread * (n - 1);
  for (let j = 1; j < n; j++) {
    const yT = -G.riser * j, zf = zHead - G.tread * (j - 1), zb = zHead - G.tread * j;
    parts.push(boxMM(-G.pitX, G.pitX, G.pitDeep, yT - 0.045, zb, zf));
    parts.push(boxMM(-G.pitX, G.pitX, yT - 0.045, yT, zb, zf + 0.022));                 // nosing
  }
  parts.push(boxMM(-G.pitX, G.pitX, G.pitDeep, -G.riser * n, G.chZ - 0.02, G.stairEnd));   // landing
  return mergeGeos(parts.map(bare));
}
function stairFillGeo(n) {
  const zHead = G.stairEnd + G.tread * (n - 1);
  if (zHead >= G.pitNear - 1e-3) return null;
  return bare(boxMM(-G.pitX, G.pitX, G.pitDeep, 0, zHead, G.pitNear));
}
const stairHeadZ = n => G.stairEnd + G.tread * (n - 1);
const doorBaseY = n => -G.riser * n;

// Crypt door assembly, authored relative to the door's base centre (x=0, y=landing, z=door plane).
function buildDoorParts() {
  const a = G.doorHalf, sp = G.doorSpring, R = G.doorR, apex = sp + archRise(a, R);
  const out = {};
  // sliding stone panel with the doorway cut through it
  const panel = extrudePoly([[-1.0, -0.9], [1.0, -0.9], [1.0, 4.1], [-1.0, 4.1]], [lancetPts(a, 0, sp, R, 12)], 0.5);
  out.panel = frame(panel, [0, 0, 0], [1, 0, 0], [0, 0, -1]);
  const band = [[-a - 0.16, 0], ...archPts(a + 0.16, R + 0.16, sp, 12), [a + 0.16, 0], [a, 0], ...archPts(a, R, sp, 12).reverse(), [-a, 0]];
  out.surround = mergeGeos([
    bare(frame(extrudePoly(band, null, 0.06), [0, 0, 0.0], [1, 0, 0], [0, 0, 1])),
    bare(xf(new T.CylinderGeometry(0.13, 0.13, 0.05, 20), { p: [0, apex + 0.34, 0.03], r: [Math.PI / 2, 0, 0] })),
    bare(xf(new T.TorusGeometry(0.13, 0.02, 6, 20), { p: [0, apex + 0.34, 0.055] })),
  ]);
  // the passage beyond
  out.passage = mergeGeos([
    boxMM(-1.25, 1.25, -0.3, 0, -4.2, -0.5), boxMM(-1.25, 1.25, 2.72, 2.92, -4.2, -0.5),
    boxMM(-1.25, -0.95, 0, 2.72, -4.2, -0.5), boxMM(0.95, 1.25, 0, 2.72, -4.2, -0.5), boxMM(-1.25, 1.25, -0.3, 2.92, -4.5, -4.2),
  ].map(bare));
  // one leaf, authored hinge-local: hinge axis at x = 0, leaf spans x ∈ [-a, 0]
  const half = archPts(a, R, sp, 12).filter(p => p[0] >= -1e-6).map(p => [p[0] - a, p[1]]);     // apex → right springing, shifted
  const leafPoly = [[-a + 0.004, 0.012], [-0.012, 0.012], ...half.reverse().map(p => [Math.min(p[0], -0.012), p[1] - 0.012])];
  leafPoly[leafPoly.length - 1][0] = -a + 0.004;
  out.leafWood = bare(frame(extrudePoly(leafPoly, null, 0.085), [0, 0, -0.085], [1, 0, 0], [0, 0, 1]));
  const iron = [];
  for (const y of [0.32, 1.0, 1.68]) {
    iron.push(boxMM(-0.66, 0, y - 0.03, y + 0.03, 0, 0.012));
    iron.push(xf(new T.ConeGeometry(0.05, 0.1, 4), { p: [-0.70, y, 0.006], r: [0, 0, Math.PI / 2], s: [1, 1, 0.12] }));
    for (let k = 0; k < 5; k++) iron.push(ball(0.014, -0.08 - k * 0.14, y, 0.014, 6, 4));
    iron.push(cyl(0.022, 0.022, 0.16, 8, 0.0, y - 0.08, 0.0));
  }
  iron.push(xf(new T.TorusGeometry(0.055, 0.011, 6, 14), { p: [-a + 0.12, 1.02, 0.03] }));
  iron.push(boxMM(-a + 0.004, -a + 0.03, 0.02, sp + 0.9, 0, 0.01));
  out.leafIron = mergeGeos(iron.map(bare));
  // chain link + seal halves
  out.link = bare(xf(new T.TorusGeometry(0.026, 0.0075, 5, 10), { s: [1, 1.5, 1] }));
  const sealHalf = new T.CylinderGeometry(0.17, 0.17, 0.035, 20, 1, false, 0, Math.PI);
  out.seal = mergeGeos([bare(xf(sealHalf, { r: [Math.PI / 2, 0, 0] })), bare(xf(new T.TorusGeometry(0.115, 0.014, 6, 12, Math.PI), { r: [0, 0, -Math.PI / 2], p: [0, 0, 0.02] })), ball(0.035, 0.035, 0, 0.022, 8, 6)]);
  out.ring = bare(xf(new T.TorusGeometry(0.05, 0.012, 6, 12), {}));
  const pack = (g, top, extra) => { const n = g.attributes.normal, p = g.attributes.position; for (let i = 0; i < n.count; i++) { const k = 1 + Math.max(0, top - p.getY(i)) + extra; n.setXYZ(i, n.getX(i) * k, n.getY(i) * k, n.getZ(i) * k); } return g; };
  out.wax = mergeGeos([[-0.64, 0.26], [0.62, 0.19]].flatMap(([x, h]) => [pack(bare(cyl(0.032, 0.03, h, 10, x, 0, 0.42)), h, 0), pack(bare(cyl(0.085, 0.05, 0.007, 12, x + 0.01, 0, 0.43)), h, 0.05)]));
  return out;
}

// Hanging sanctuary lamp, authored hanging from the origin down −Y.
function lampGeo(len) {
  const iron = [cyl(0.006, 0.006, len - 0.5, 5, 0, -(len - 0.5), 0)];
  for (let k = 0; k < 3; k++) { const a = k * 2.094; iron.push(xf(new T.CylinderGeometry(0.004, 0.004, 0.52, 4), { p: [Math.cos(a) * 0.07, -len + 0.25, Math.sin(a) * 0.07], r: [-Math.sin(a) * 0.27, 0, Math.cos(a) * 0.27] })); }
  const brass = [
    xf(lathe([[0.0, 0], [0.05, 0.02], [0.13, 0.10], [0.155, 0.18], [0.14, 0.19], [0.12, 0.11], [0.045, 0.035], [0.0, 0.03]], 16), { p: [0, -len - 0.19, 0] }),
    xf(lathe([[0.012, 0], [0.03, 0.03], [0.012, 0.07], [0.0, 0.07]], 10), { p: [0, -len - 0.26, 0] }),
    xf(new T.TorusGeometry(0.145, 0.012, 6, 20), { p: [0, -len, 0], r: [Math.PI / 2, 0, 0] }),
  ];
  const glass = [xf(lathe([[0.03, 0], [0.06, 0.02], [0.07, 0.09], [0.055, 0.15], [0.0, 0.15]], 12), { p: [0, -len - 0.02, 0] })];
  return { iron: mergeGeos(iron.map(bare)), brass: mergeGeos(brass.map(bare)), glass: mergeGeos(glass.map(bare)) };
}
