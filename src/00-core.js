// Core helpers: math, RNG, geometry plumbing, fullscreen passes, shared GLSL.
const T = THREE;
const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V3 = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// smooth 1-D value noise for flicker etc.
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash1(i), hash1(i + 1), u); }

const HASH = location.hash.slice(1).split('&').reduce((o, s) => { const [k, v] = s.split('='); if (k) o[k] = v === undefined ? '1' : v; return o; }, {});
const SHOT = 'shot' in HASH;

// ───────────── geometry plumbing ─────────────
function bare(g) {            // keep only what the G-buffer needs
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  return g;
}
function xf(g, { p, r, s, m } = {}) {   // transform a geometry in place
  if (m) { g.applyMatrix4(m); return g; }
  const M = new T.Matrix4();
  const q = new T.Quaternion();
  if (r) q.setFromEuler(new T.Euler(r[0], r[1], r[2], 'YXZ'));
  M.compose(p ? V3(p[0], p[1], p[2]) : V3(), q, s ? (typeof s === 'number' ? V3(s, s, s) : V3(s[0], s[1], s[2])) : V3(1, 1, 1));
  g.applyMatrix4(M);
  return g;
}
function mergeGeos(list, withUV = false) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = withUV ? new Float32Array(nv * 2) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array.subarray(0, c * 3), vo * 3);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, c * 2), vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
    else { for (let i = 0; i < c; i++) idx[io + i] = vo + i; io += c; }
    vo += c;
  }
  const out = new T.BufferGeometry();
  out.setAttribute('position', new T.BufferAttribute(pos, 3));
  out.setAttribute('normal', new T.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new T.BufferAttribute(uv, 2));
  out.setIndex(new T.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}
// Crease-angle normal smoothing for triangle soups (ExtrudeGeometry output is faceted).
function smoothNormals(g, creaseDeg = 40) {
  if (g.index) g = g.toNonIndexed();
  const p = g.attributes.position.array, n = p.length / 3;
  const fn = new Float32Array(n * 3);
  const a = V3(), b = V3(), c = V3(), e1 = V3(), e2 = V3();
  for (let i = 0; i < n; i += 3) {
    a.fromArray(p, i * 3); b.fromArray(p, i * 3 + 3); c.fromArray(p, i * 3 + 6);
    e1.subVectors(b, a); e2.subVectors(c, a); e1.cross(e2);          // area-weighted
    for (let k = 0; k < 3; k++) { fn[(i + k) * 3] = e1.x; fn[(i + k) * 3 + 1] = e1.y; fn[(i + k) * 3 + 2] = e1.z; }
  }
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const key = Math.round(p[i * 3] * 2000) + '_' + Math.round(p[i * 3 + 1] * 2000) + '_' + Math.round(p[i * 3 + 2] * 2000);
    let l = map.get(key); if (!l) map.set(key, l = []); l.push(i);
  }
  const out = new Float32Array(n * 3), cosT = Math.cos(creaseDeg * DEG);
  for (const l of map.values()) {
    for (const i of l) {
      const fx = fn[i * 3], fy = fn[i * 3 + 1], fz = fn[i * 3 + 2], fl = Math.hypot(fx, fy, fz) || 1;
      let sx = 0, sy = 0, sz = 0;
      for (const j of l) {
        const gx = fn[j * 3], gy = fn[j * 3 + 1], gz = fn[j * 3 + 2], gl = Math.hypot(gx, gy, gz) || 1;
        if ((fx * gx + fy * gy + fz * gz) / (fl * gl) >= cosT) { sx += gx; sy += gy; sz += gz; }
      }
      const sl = Math.hypot(sx, sy, sz) || 1;
      out[i * 3] = sx / sl; out[i * 3 + 1] = sy / sl; out[i * 3 + 2] = sz / sl;
    }
  }
  g.setAttribute('normal', new T.BufferAttribute(out, 3));
  return g;
}
// Extrude a polygon (array of [x,y]) with optional holes along +z by `depth`; smooth curved sides.
function extrudePoly(outer, holes, depth, crease = 38) {
  const sh = new T.Shape(outer.map(p => new T.Vector2(p[0], p[1])));
  for (const h of holes || []) sh.holes.push(new T.Path(h.map(p => new T.Vector2(p[0], p[1]))));
  const g = new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false, steps: 1 });
  return bare(smoothNormals(g, crease));
}
// Pointed (two-centred) arch outline. Returns points from left springing over the apex to right springing.
// a = half span, R = arc radius (R = 2a → equilateral), y0 = springing height.
function archPts(a, R, y0, n = 14, cx = 0) {
  const pts = [], c = R - a, thA = Math.acos(-c / R);       // left arc centre at +c
  for (let i = 0; i <= n; i++) { const th = Math.PI - (Math.PI - thA) * (i / n); pts.push([cx + c + R * Math.cos(th), y0 + R * Math.sin(th)]); }
  for (let i = n - 1; i >= 0; i--) pts.push([cx - (pts[i][0] - cx), pts[i][1]]);
  return pts;
}
const archRise = (a, R) => Math.sqrt(2 * R * a - a * a);
// Lancet opening outline (counter-clockwise from bottom-left): jambs + pointed head.
function lancetPts(a, sill, spring, R, n = 12, cx = 0) {
  const top = archPts(a, R, spring, n, cx);       // left → right
  return [[cx - a, sill], [cx + a, sill], ...top.reverse()];
}
// normalised pointed profile: 1 at t=0 (apex) → 0 at t=1 (springing)
function vaultProfile(t, R = 1.7) { t = clamp(Math.abs(t), 0, 1); return Math.sqrt(Math.max(0, R * R - (t + R - 1) * (t + R - 1))) / Math.sqrt(2 * R - 1); }

// Collects geometry per material key and region, then emits merged meshes.
class Batch {
  constructor() { this.groups = new Map(); }
  add(key, g, tr) {
    if (tr) xf(g, tr);
    bare(g);
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(V3());
    const cell = key + '|' + Math.floor((c.x + 60) / 10) + '_' + Math.floor((c.z + 60) / 10);
    let l = this.groups.get(cell); if (!l) this.groups.set(cell, l = { key, list: [] });
    l.list.push(g);
    return g;
  }
  build() {
    const out = [];
    for (const { key, list } of this.groups.values()) out.push({ key, geo: mergeGeos(list, key.startsWith('glass')) });
    return out;
  }
}

// ───────────── fullscreen pass plumbing ─────────────
const FS_VERT = `precision highp float;
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
let renderer = null;
const fsGeo = new T.BufferGeometry();
fsGeo.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsMesh = new T.Mesh(fsGeo, null); fsMesh.frustumCulled = false;
const fsScene = new T.Scene(); fsScene.add(fsMesh);
const fsCam = new T.Camera();
function fsMat(frag, uniforms = {}, extra = {}) {
  return new T.RawShaderMaterial(Object.assign({
    glslVersion: T.GLSL3, vertexShader: FS_VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false,
  }, extra));
}
function fsPass(mat, target) { fsMesh.material = mat; renderer.setRenderTarget(target || null); renderer.render(fsScene, fsCam); }
const U = (v) => ({ value: v });

// ───────────── shared GLSL ─────────────
const GLSL_HASH = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2  hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3  hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;
// tileable noise for the texture bakers (period in lattice cells)
const GLSL_PNOISE = `
float pnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  vec2 g00 = hash22(mod(i, per))*2.0-1.0, g10 = hash22(mod(i+vec2(1,0), per))*2.0-1.0;
  vec2 g01 = hash22(mod(i+vec2(0,1), per))*2.0-1.0, g11 = hash22(mod(i+vec2(1,1), per))*2.0-1.0;
  float a = dot(g00, f), b = dot(g10, f-vec2(1,0)), c = dot(g01, f-vec2(0,1)), d = dot(g11, f-vec2(1,1));
  return clamp(mix(mix(a,b,u.x), mix(c,d,u.x), u.y)*0.75+0.5, 0.0, 1.0);
}
float pnoise(vec2 p, float per){ return pnoise(p, vec2(per)); }
float pfbm(vec2 p, vec2 per, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a*pnoise(p, per); n += a; p = p*2.0 + 17.3; per *= 2.0; a *= 0.5; }
  return s/n;
}
float pfbm(vec2 p, float per, int oct){ return pfbm(p, vec2(per), oct); }
// periodic cellular noise: x = F1, y = F2, z = cell hash
vec3 pworley(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y)); vec2 c = mod(i+o, per); vec2 r = o + hash22(c) - f; float d = dot(r, r);
    if (d < f1){ f2 = f1; f1 = d; id = hash12(c+3.7); } else if (d < f2) f2 = d;
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
vec3 pworley(vec2 p, float per){ return pworley(p, vec2(per)); }
`;
const GLSL_COLOR = `
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;
