// G-buffer materials (all hand-written; three.js is only the GL plumbing).
//   gAlbedo  : rgb = sqrt(albedo), a = metalness
//   gNormal  : xyz = world normal, w = roughness
//   gEmissive: rgb = emitted radiance (HDR), a = material cavity
const GB_VERT = `precision highp float;
in vec3 position; in vec3 normal;
#ifdef USE_UV
in vec2 uv; out vec2 vUv;
#endif
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
uniform float uLocal;
out vec3 vWPos, vWNrm, vTPos, vTNrm; out float vNLen;
flat out vec3 vR0, vR1, vR2;
void main(){
  mat4 m = modelMatrix;
  #ifdef INSTANCED
  m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  mat3 m3 = mat3(m);
  vNLen = length(normal);
  vec3 wn = normalize(m3 * normal);
  vWPos = wp.xyz; vWNrm = wn;
  if (uLocal > 0.5) {
    vTPos = position * length(m3[1]);
    vTNrm = normal / max(vNLen, 1e-5);
    vR0 = normalize(m3[0]); vR1 = normalize(m3[1]); vR2 = normalize(m3[2]);
  } else {
    vTPos = wp.xyz; vTNrm = wn;
    vR0 = vec3(1.0, 0.0, 0.0); vR1 = vec3(0.0, 1.0, 0.0); vR2 = vec3(0.0, 0.0, 1.0);
  }
  #ifdef USE_UV
  vUv = uv;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GB_FRAG_HEAD = `precision highp float;
in vec3 vWPos, vWNrm, vTPos, vTNrm; in float vNLen;
flat in vec3 vR0, vR1, vR2;
#ifdef USE_UV
in vec2 vUv;
#endif
layout(location=0) out vec4 gAlbedo; layout(location=1) out vec4 gNormal; layout(location=2) out vec4 gEmissive;
uniform vec3 cameraPosition;
uniform sampler2D uNoise;
uniform vec3 uTint; uniform float uRough, uRoughVar, uMetal;
`;
const GB_FRAG_TEX = GB_FRAG_HEAD + `
uniform sampler2D uTexA, uTexB; uniform float uTexScale, uBump, uRoughMul, uSoot;
void main(){
  vec3 Ng = normalize(vTNrm);
  #ifdef DOUBLE
  if (dot(normalize(vWNrm), cameraPosition - vWPos) < 0.0) Ng = -Ng;
  #endif
  vec3 w = pow(abs(Ng), vec3(6.0)); w /= (w.x + w.y + w.z);
  vec3 p = vTPos * uTexScale;
  vec2 ux = p.zy, uy = p.xz, uz = p.xy;
  #ifdef SWAP
  ux = ux.yx; uz = uz.yx;
  #endif
  vec4 ax = texture(uTexA, ux), ay = texture(uTexA, uy), az = texture(uTexA, uz);
  vec4 bx = texture(uTexB, ux), by = texture(uTexB, uy), bz = texture(uTexB, uz);
  vec4 A = ax*w.x + ay*w.y + az*w.z, Bm = bx*w.x + by*w.y + bz*w.z;
  vec2 dx = (bx.xy*2.0 - 1.0)*uBump, dy = (by.xy*2.0 - 1.0)*uBump, dz = (bz.xy*2.0 - 1.0)*uBump;
  #ifdef SWAP
  dx = dx.yx; dz = dz.yx;
  #endif
  vec3 tx = vec3(dx, sqrt(max(0.0, 1.0 - dot(dx, dx)))), ty = vec3(dy, sqrt(max(0.0, 1.0 - dot(dy, dy)))), tz = vec3(dz, sqrt(max(0.0, 1.0 - dot(dz, dz))));
  vec3 nX = vec3(tx.xy + Ng.zy, tx.z*Ng.x), nY = vec3(ty.xy + Ng.xz, ty.z*Ng.y), nZ = vec3(tz.xy + Ng.xy, tz.z*Ng.z);
  vec3 nT = normalize(nX.zyx*w.x + nY.xzy*w.y + nZ.xyz*w.z);
  vec3 N = normalize(mat3(vR0, vR1, vR2) * nT);
  vec3 alb = A.rgb*A.rgb * uTint;
  float rough = Bm.b * uRoughMul, cav = Bm.a;
  // large-scale breakup so the tiling never reads
  float m1 = texture(uNoise, vWPos.xz*0.043 + vWPos.y*0.031).r, m2 = texture(uNoise, vWPos.zy*0.17 + vWPos.x*0.11).g;
  alb *= mix(0.66, 1.2, m1);
  rough = clamp(rough + (m2 - 0.5)*0.2, 0.05, 1.0);
  // centuries of candle soot gathering upward, damp rising from the floor
  alb *= mix(1.0, 0.62, uSoot * smoothstep(5.0, 16.5, vWPos.y) * (0.6 + 0.8*m2));
  alb *= mix(1.0, 0.80, uSoot * smoothstep(0.9, 0.0, vWPos.y) * step(0.02, vWPos.y) * m1);
  gAlbedo = vec4(sqrt(clamp(alb, 0.0, 1.0)), uMetal);
  gNormal = vec4(N, rough);
  gEmissive = vec4(0.0, 0.0, 0.0, cav);
}`;
const GB_FRAG_FLAT = GB_FRAG_HEAD + `
uniform vec3 uEmis; uniform float uGlow;
void main(){
  vec3 N = normalize(vWNrm);
  #ifdef DOUBLE
  if (dot(N, cameraPosition - vWPos) < 0.0) N = -N;
  #endif
  float n1 = texture(uNoise, vTPos.xy*1.7 + vTPos.z*1.3).g, n2 = texture(uNoise, vTPos.zy*9.0 + vTPos.x*7.0).r;
  vec3 alb = uTint * (0.75 + 0.5*n1);
  float rough = clamp(uRough + (n2 - 0.5)*uRoughVar, 0.05, 1.0);
  vec3 emis = uEmis * uGlow;
  #ifdef WAX
  float d = max(vNLen - 1.0, 0.0);                        // metres below the wick (packed into |normal|)
  emis = uEmis * uGlow * (exp(-d/0.035) + 0.12*exp(-d/0.16));
  #endif
  #ifdef CLOTH
  float weave = texture(uNoise, vTPos.xy*37.0 + vTPos.z*31.0).a;
  alb *= 0.8 + 0.4*weave;
  N = normalize(N + (vec3(n2, weave, n1) - 0.5)*0.12);
  #endif
  gAlbedo = vec4(sqrt(clamp(alb, 0.0, 1.0)), uMetal);
  gNormal = vec4(N, rough);
  gEmissive = vec4(emis, 1.0);
}`;
const GB_FRAG_GLASS = GB_FRAG_HEAD + `
uniform sampler2D uGlassTex; uniform vec4 uUvRect; uniform vec3 uSky, uMoonDir; uniform float uGlow;
void main(){
  vec4 g = texture(uGlassTex, uUvRect.xy + vUv*uUvRect.zw);
  vec3 N = normalize(vWNrm);
  vec3 Vd = normalize(vWPos - cameraPosition);
  float hot = pow(max(dot(Vd, uMoonDir), 0.0), 20.0) * smoothstep(0.5, 0.9, vNLen);   // the moon standing behind the pane
  vec3 emis = g.rgb * uSky * vNLen * uGlow * (1.0 + 5.0*hot);
  gAlbedo = vec4(sqrt(mix(vec3(0.012), g.rgb*0.04 + 0.004, g.a)), 0.0);
  gNormal = vec4(N, mix(0.75, 0.28, g.a));
  gEmissive = vec4(emis, 1.0);
}`;

// depth / shadow-caster shaders
const DEPTH_VERT = `precision highp float;
in vec3 position;
#ifdef USE_UV
in vec2 uv; out vec2 vUv;
#endif
#ifdef INSTANCED
in mat4 instanceMatrix;
#endif
uniform mat4 modelMatrix, viewMatrix, projectionMatrix;
out vec3 vW;
void main(){
  mat4 m = modelMatrix;
  #ifdef INSTANCED
  m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0); vW = wp.xyz;
  #ifdef USE_UV
  vUv = uv;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DEPTH_FRAG_DIST = `precision highp float; in vec3 vW; uniform vec3 uLPos; uniform float uInvFar; out vec4 o;
void main(){ o = vec4(length(vW - uLPos)*uInvFar); }`;
const DEPTH_FRAG_NONE = `precision highp float; out vec4 o; void main(){ o = vec4(1.0); }`;
const COOKIE_FRAG = `precision highp float; in vec2 vUv; uniform sampler2D uGlassTex; uniform vec4 uUvRect; out vec4 o;
void main(){ vec4 g = texture(uGlassTex, uUvRect.xy + vUv*uUvRect.zw); o = vec4(g.rgb, gl_FragCoord.z); }`;

// ───────────── material library ─────────────
const MAT = { g: {}, shared: {} };
function initMaterials(tex) {
  const texMat = (set, o = {}) => new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader: GB_VERT, fragmentShader: GB_FRAG_TEX,
    defines: Object.assign({}, o.double ? { DOUBLE: 1 } : {}, o.swap ? { SWAP: 1 } : {}, o.inst ? { INSTANCED: 1 } : {}),
    side: o.double ? T.DoubleSide : T.FrontSide,
    uniforms: {
      uTexA: U(tex[set].A), uTexB: U(tex[set].B), uNoise: U(tex.noise), uTexScale: U(tex[set].scale * (o.scale || 1)),
      uTint: U(new T.Color(...(o.tint || [1, 1, 1]))), uBump: U(o.bump ?? 1), uRoughMul: U(o.rough ?? 1), uMetal: U(0),
      uRough: U(0), uRoughVar: U(0), uLocal: U(o.local ? 1 : 0), uSoot: U(o.soot ?? 1),
    },
  });
  const flatMat = (tint, rough, metal, o = {}) => new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader: GB_VERT, fragmentShader: GB_FRAG_FLAT,
    defines: Object.assign({}, o.double ? { DOUBLE: 1 } : {}, o.wax ? { WAX: 1 } : {}, o.cloth ? { CLOTH: 1 } : {}, o.inst ? { INSTANCED: 1 } : {}),
    side: o.double ? T.DoubleSide : T.FrontSide,
    uniforms: {
      uNoise: U(tex.noise), uTint: U(new T.Color(...tint)), uRough: U(rough), uRoughVar: U(o.rv ?? 0.2), uMetal: U(metal),
      uEmis: U(new T.Color(...(o.emis || [0, 0, 0]))), uGlow: U(o.glow ?? 1), uLocal: U(o.local ? 1 : 0),
    },
  });
  const glassMat = (kind) => new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader: GB_VERT, fragmentShader: GB_FRAG_GLASS, defines: { USE_UV: 1 }, side: T.DoubleSide,
    uniforms: {
      uNoise: U(tex.noise), uTint: U(new T.Color(1, 1, 1)), uRough: U(0), uRoughVar: U(0), uMetal: U(0), uLocal: U(0),
      uGlassTex: U(GLASS[kind].tex), uUvRect: U(new T.Vector4(0, 0, 1, 1)), uSky: U(new T.Color(0.62, 0.78, 1.0).multiplyScalar(2.6)),
      uMoonDir: U(V3()), uGlow: U(1),
    },
  });
  const g = MAT.g;
  g.ashlar = texMat('ashlar', { bump: 1.5 });
  g.stone = texMat('stone', { bump: 1.3 });
  g.stoneL = texMat('stone', { local: true, soot: 0, tint: [0.92, 0.92, 0.94], rough: 0.9 });       // statues: object-space texture
  g.floor = texMat('floor', { soot: 0 });
  g.wood = texMat('wood', { soot: 0 });
  g.woodH = texMat('wood', { swap: true, soot: 0 });
  g.woodL = texMat('wood', { local: true, soot: 0, tint: [1.7, 1.55, 1.4], bump: 1.4 });
  g.plaster = texMat('plaster');
  g.plaster2 = texMat('plaster', { double: true });
  g.dark = texMat('ashlar', { tint: [0.5, 0.5, 0.52] });
  g.iron = flatMat([0.035, 0.032, 0.03], 0.5, 0.35);
  g.ironI = flatMat([0.10, 0.075, 0.055], 0.42, 0.6, { inst: true });
  g.brass = flatMat([0.86, 0.60, 0.26], 0.34, 1.0, { rv: 0.3 });
  g.cloth = flatMat([0.30, 0.016, 0.022], 0.92, 0.0, { cloth: true, rv: 0.1 });
  g.lampglass = flatMat([0.2, 0.01, 0.01], 0.2, 0.0, { emis: [2.6, 0.12, 0.05] });
  g.wax = () => flatMat([0.80, 0.74, 0.60], 0.5, 0.0, { wax: true, emis: [1.0, 0.42, 0.10], glow: 1, rv: 0.25 });
  g['glass:lancet'] = glassMat('lancet'); g['glass:apse'] = glassMat('apse'); g['glass:rose'] = glassMat('rose');

  const depth = (frag, o = {}) => new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: frag, side: T.DoubleSide,
    defines: o.inst ? { INSTANCED: 1 } : {}, colorWrite: o.color !== false,
    polygonOffset: true, polygonOffsetFactor: o.pf ?? 1.6, polygonOffsetUnits: o.pu ?? 3,
    uniforms: { uLPos: U(V3()), uInvFar: U(1) },
  });
  MAT.shared = {
    dist: depth(DEPTH_FRAG_DIST), distI: depth(DEPTH_FRAG_DIST, { inst: true }),
    none: depth(DEPTH_FRAG_NONE, { color: false }), noneI: depth(DEPTH_FRAG_NONE, { color: false, inst: true }),
  };
  MAT.cookie = (kind) => new T.RawShaderMaterial({
    glslVersion: T.GLSL3, vertexShader: DEPTH_VERT, fragmentShader: COOKIE_FRAG, defines: { USE_UV: 1 }, side: T.DoubleSide,
    uniforms: { uGlassTex: U(GLASS[kind].tex), uUvRect: U(new T.Vector4(0, 0, 1, 1)) },
  });
}

// ───────────── world registry: one scene, materials swapped per pass ─────────────
const World = {
  scene: new T.Scene(), meshes: [],
  add(geo, key, o = {}) {
    const inst = o.count !== undefined;
    let g;
    if (key.startsWith('wax')) g = MAT.g.wax();
    else g = o.mat || MAT.g[key + (inst ? 'I' : '')] || MAT.g[key];
    const m = inst ? new T.InstancedMesh(geo, g, o.count) : new T.Mesh(geo, g);
    const glass = key.startsWith('glass');
    m.userData = {
      key, g, show: true, glass,
      castPoint: !glass && o.cast !== false, castMoon: !glass && o.cast !== false,
      ck: glass ? MAT.cookie(key.slice(6)) : null, inst,
    };
    m.matrixAutoUpdate = false;
    (o.parent || this.scene).add(m);
    this.meshes.push(m);
    return m;
  },
  setPass(mode) {
    const S = MAT.shared;
    for (const m of this.meshes) {
      const u = m.userData;
      if (mode === 'g') { m.material = u.g; m.visible = u.show; }
      else if (mode === 'point') { m.material = u.inst ? S.distI : S.dist; m.visible = u.show && u.castPoint; }
      else if (mode === 'depth') { m.material = u.inst ? S.noneI : S.none; m.visible = u.show && u.castMoon; }
      else if (mode === 'cookie') { m.visible = u.show && u.glass; if (u.glass) m.material = u.ck; }
    }
  },
};
