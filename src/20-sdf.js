// Signed-distance sculpting → triangle meshes (naive surface nets). Used for the hooded statues.
function surfaceNets(sdf, bmin, bmax, cell) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / cell) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / cell) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / cell) + 1;
  const vals = new Float32Array(nx * ny * nz);
  // coarse pre-pass: only evaluate densely near the surface
  const B = 4, far = B * cell * 1.9 + 0.03;
  for (let bz = 0; bz < nz; bz += B) for (let by = 0; by < ny; by += B) for (let bx = 0; bx < nx; bx += B) {
    const cx = bmin[0] + (bx + B * 0.5) * cell, cy = bmin[1] + (by + B * 0.5) * cell, cz = bmin[2] + (bz + B * 0.5) * cell;
    const d = sdf(cx, cy, cz), dense = Math.abs(d) < far;
    const ex = Math.min(nx, bx + B), ey = Math.min(ny, by + B), ez = Math.min(nz, bz + B);
    for (let z = bz; z < ez; z++) for (let y = by; y < ey; y++) {
      let i = (z * ny + y) * nx + bx;
      for (let x = bx; x < ex; x++, i++) vals[i] = dense ? sdf(bmin[0] + x * cell, bmin[1] + y * cell, bmin[2] + z * cell) : d;
    }
  }
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const pos = [];
  const co = [0, 1, nx, nx + 1, nx * ny, nx * ny + 1, nx * ny + nx, nx * ny + nx + 1];
  const cdx = [0, 1, 0, 1, 0, 1, 0, 1], cdy = [0, 0, 1, 1, 0, 0, 1, 1], cdz = [0, 0, 0, 0, 1, 1, 1, 1];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const i0 = (z * ny + y) * nx + x;
    let mask = 0;
    for (let k = 0; k < 8; k++) { v[k] = vals[i0 + co[k]]; if (v[k] < 0) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      sx += cdx[a] + (cdx[b] - cdx[a]) * t; sy += cdy[a] + (cdy[b] - cdy[a]) * t; sz += cdz[a] + (cdz[b] - cdz[a]) * t; n++;
    }
    cellV[(z * (ny - 1) + y) * (nx - 1) + x] = pos.length / 3;
    pos.push(bmin[0] + (x + sx / n) * cell, bmin[1] + (y + sy / n) * cell, bmin[2] + (z + sz / n) * cell);
  }
  const idx = [];
  const cv = (x, y, z) => cellV[(z * (ny - 1) + y) * (nx - 1) + x];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i0 = (z * ny + y) * nx + x, s0 = vals[i0] < 0;
    if (x < nx - 1 && s0 !== (vals[i0 + 1] < 0)) quad(cv(x, y - 1, z - 1), cv(x, y, z - 1), cv(x, y, z), cv(x, y - 1, z), !s0);
    if (y < ny - 1 && s0 !== (vals[i0 + nx] < 0)) quad(cv(x - 1, y, z - 1), cv(x - 1, y, z), cv(x, y, z), cv(x, y, z - 1), !s0);
    if (z < nz - 1 && s0 !== (vals[i0 + nx * ny] < 0)) quad(cv(x - 1, y - 1, z), cv(x, y - 1, z), cv(x, y, z), cv(x - 1, y, z), !s0);
  }
  const P = new Float32Array(pos), N = new Float32Array(pos.length), e = cell * 0.6;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    N[i] = gx / l; N[i + 1] = gy / l; N[i + 2] = gz / l;
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(P, 3));
  g.setAttribute('normal', new T.BufferAttribute(N, 3));
  g.setIndex(new T.BufferAttribute(P.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);
function sdEll(x, y, z, rx, ry, rz) {
  const k0 = Math.hypot(x / rx, y / ry, z / rz), k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}
function sdCone(px, py, pz, ax, ay, az, bx, by, bz, r1, r2) {     // capsule with linearly varying radius
  const bax = bx - ax, bay = by - ay, baz = bz - az, pax = px - ax, pay = py - ay, paz = pz - az;
  const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (r1 + (r2 - r1) * h);
}

// A hooded, faceless warden. Feet at y = 0 on a thin integral base, facing +z.
// pose: { elbow:[x,y,z], wrist:[x,y,z] } for the right arm (mirrored for the left), hands, head pitch/yaw.
function wardenSDF(pose) {
  const E = pose.elbow, W = pose.wrist, hp = pose.headPitch || 0, hy = pose.headYaw || 0;
  const cp = Math.cos(hp), sp = Math.sin(hp), cyw = Math.cos(hy), syw = Math.sin(hy);
  const fdx = W[0] - E[0], fdy = W[1] - E[1], fdz = W[2] - E[2], fl = Math.hypot(fdx, fdy, fdz);
  const hx = W[0] + fdx / fl * 0.085, hyy = W[1] + fdy / fl * 0.085, hz = W[2] + fdz / fl * 0.085;   // hand centre
  return (x, y, z) => {
    // robe: a fluted bell
    const t = clamp(y / 1.42, 0, 1);
    const rx = 0.335 - 0.11 * t - 0.035 * t * t + 0.03 * Math.exp(-y * 9), rz = rx * 0.80;
    const th = Math.atan2(x, z);
    const fold = (0.017 * Math.sin(th * 8 + y * 1.6 + 0.6 * Math.sin(th * 3)) + 0.007 * Math.sin(th * 19 - y * 2.3)) * sstep(1.32, 0.3, y) * (0.55 + 0.45 * sstep(1.2, 0.0, y));
    let d = (Math.hypot(x / rx, z / rz) - 1) * rz + fold;
    d = smax(d, y - 1.46, 0.08);
    d = Math.max(d, -y);
    // base
    d = Math.min(d, Math.max(Math.hypot(x, z) - 0.37, Math.abs(y + 0.03) - 0.03) - 0.006);
    // shoulders and cowl
    d = smin(d, sdEll(x, y - 1.41, z, 0.27, 0.13, 0.175), 0.07);
    d = smin(d, sdEll(x, y - 1.50, z + 0.02, 0.185, 0.12, 0.165), 0.06);
    // arms (mirrored)
    const ax = Math.abs(x);
    let arm = sdCone(ax, y, z, 0.225, 1.40, 0.0, E[0], E[1], E[2], 0.082, 0.074);
    arm = smin(arm, sdCone(ax, y, z, E[0], E[1], E[2], W[0], W[1], W[2], 0.076, pose.sleeve || 0.105), 0.04);
    // hanging sleeve mouth
    arm = smin(arm, sdCone(ax, y, z, W[0], W[1] - 0.02, W[2], W[0] * 0.9 + 0.01, W[1] - (pose.drape || 0.2), W[2] - 0.02, pose.drapeR || (pose.sleeve || 0.105) * 0.8, 0.02), 0.05);
    d = smin(d, arm, 0.05);
    // hands
    let hand;
    if (pose.joined) hand = sdEll(x, y - (W[1] + 0.07), z - (W[2] + 0.035), 0.045, 0.095, 0.04);
    else if (pose.palm) {                       // open hand, palm outward, fingers spread
      const px = ax - hx, py = y - hyy - 0.02, pz = z - hz;
      hand = sdEll(px, py, pz, 0.047, 0.06, 0.022);
      for (let f = 0; f < 4; f++) {
        const fx = -0.034 + f * 0.0225;
        hand = smin(hand, sdCone(px, py, pz, fx, 0.04, 0.0, fx * 1.5, 0.132 - Math.abs(f - 1.4) * 0.013, -0.014, 0.0135, 0.0115), 0.012);
      }
      hand = smin(hand, sdCone(px, py, pz, -0.04, -0.015, 0.0, -0.082, 0.045, 0.014, 0.015, 0.0125), 0.014);
    }
    else hand = sdEll(ax - hx, y - hyy, z - hz, 0.036, 0.075, 0.03);
    d = smin(d, hand, 0.025);
    // head group, rotated about the neck
    let qx = x, qy = y - 1.52, qz = z;
    let tx = qx * cyw - qz * syw, tz = qx * syw + qz * cyw; qx = tx; qz = tz;        // yaw
    let ty = qy * cp + qz * sp; tz = -qy * sp + qz * cp; qy = ty; qz = tz;            // pitch (bow forward)
    let hood = sdEll(qx, qy - 0.165, qz + 0.01, 0.152, 0.19, 0.178);
    hood = smin(hood, Math.hypot(qx, qy - 0.30, qz + 0.10) - 0.075, 0.09);
    hood = smin(hood, sdEll(qx, qy - 0.02, qz + 0.03, 0.16, 0.10, 0.15), 0.06);       // drape onto the cowl
    const cavity = sdEll(qx, qy - 0.15, qz - 0.135, 0.103, 0.138, 0.125);
    hood = smax(hood, -cavity, 0.022);
    let face = sdEll(qx, qy - 0.145, qz - 0.04, 0.084, 0.116, 0.092);
    face = smin(face, sdCone(qx, qy, qz, 0, 0.175, 0.128, 0, 0.115, 0.142, 0.012, 0.017), 0.02);   // nose ridge
    face = smax(face, -(Math.hypot(Math.abs(qx) - 0.034, qy - 0.168, qz - 0.128) - 0.021), 0.018); // sockets
    hood = Math.min(hood, face);
    return smin(d, hood, 0.035);
  };
}
const WARDEN_POSES = {
  pray:  { elbow: [0.275, 1.11, 0.10], wrist: [0.045, 1.24, 0.25], joined: true, headPitch: 0.46, drape: 0.17 },
  watch: { elbow: [0.275, 1.11, 0.10], wrist: [0.045, 1.24, 0.25], joined: true, headPitch: -0.04, headYaw: 0.62, drape: 0.17 },
  stand: { elbow: [0.305, 1.10, 0.01], wrist: [0.30, 0.83, 0.07], headPitch: 0.06, drape: 0.10 },
  reach: { elbow: [0.25, 1.25, 0.22], wrist: [0.215, 1.40, 0.50], palm: true, headPitch: -0.12, drape: 0.17, sleeve: 0.08, drapeR: 0.045 },
};
function buildWardens() {
  const out = {}, cell = SHOT && HASH.lowgeo ? 0.03 : 0.0155;
  for (const [k, p] of Object.entries(WARDEN_POSES)) out[k] = surfaceNets(wardenSDF(p), [-0.5, -0.07, -0.42], [0.5, 1.95, 0.78], cell);
  return out;
}
