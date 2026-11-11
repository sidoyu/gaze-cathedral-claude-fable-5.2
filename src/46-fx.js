// Flames (bent, camera-facing ribbons) and dust motes, drawn after the temporal resolve.
const FLAME_VERT = `precision highp float;
in vec2 aUV; in vec3 iPos; in vec4 iParam; in vec3 iLean; in float iFloor;
uniform float uMirror;
uniform mat4 viewMatrix, projectionMatrix; uniform vec3 uCam; uniform float uTime;
out vec2 vUV; out float vSeed, vAlive, vT;
${GLSL_HASH}
float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f); return mix(hash11(i), hash11(i + 1.0), f); }
void main(){
  float seed = iParam.y, t = aUV.y, uAgit = iParam.w, tm = uTime*(1.0 + 1.3*uAgit);
  float ll = length(iLean);
  float hh = iParam.x*(0.84 + 0.32*n1(tm*7.0 + seed*13.0))*(1.0 + 0.55*ll);
  vec3 sway = vec3(n1(tm*3.1 + seed*7.0) - 0.5, 0.0, n1(tm*2.7 + seed*3.0) - 0.5)*(0.10 + 0.5*uAgit);
  vec3 lean = iLean + sway;
  vec3 up = vec3(0.0, 1.0, 0.0)/(1.0 + 0.6*ll);
  vec3 c = iPos + up*(hh*t) + lean*(hh*t*t);
  vec3 tang = normalize(up + lean*2.0*t);
  vec3 side = normalize(cross(tang, normalize(uCam - c)));
  vec3 wp = c + side*aUV.x*hh*0.21;
  vUV = aUV; vSeed = seed; vAlive = iParam.z; vT = tm;
  bool cull = iParam.z < 0.01;
  if (uMirror > 0.5) {                        // reflection in the polished nave floor (plane y = 0), smeared downward by its roughness
    wp = c + side*aUV.x*hh*0.55;
    wp.y = -(iPos.y + (wp.y - iPos.y)*4.0 - hh*0.8);
    cull = cull || iFloor < 0.5;
  }
  gl_Position = cull ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix*viewMatrix*vec4(wp, 1.0);
}`;
const FLAME_FRAG = `precision highp float;
in vec2 vUV; in float vSeed, vAlive, vT; out vec4 o;
uniform sampler2D tDepth, tNormal; uniform vec2 uRes; uniform float uGain, uMirror; uniform vec3 uTintF, uCamF; uniform mat4 uInvVP;
${GLSL_HASH}
float n1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f); return mix(hash11(i), hash11(i + 1.0), f); }
void main(){
  vec2 suv = gl_FragCoord.xy/uRes; float sd = texture(tDepth, suv).r, refl = 1.0;
  if (uMirror > 0.5) {
    vec4 wp = uInvVP*vec4(suv*2.0 - 1.0, sd*2.0 - 1.0, 1.0); vec3 P = wp.xyz/wp.w;
    vec4 gn = texture(tNormal, suv);
    if (abs(P.y) > 0.03 || gn.y < 0.8) discard;                               // only where the visible surface is the floor itself
    vec3 V = normalize(uCamF - P);
    float gloss = 1.0 - gn.w;
    refl = (0.04 + 0.96*pow(1.0 - max(V.y, 0.0), 5.0)) * gloss*gloss * 1.6;
  } else if (gl_FragCoord.z > sd + 0.00003) discard;
  float t = vUV.y;
  float prof = sin(3.14159*pow(clamp(t, 0.0, 1.0), 0.58));
  float wob = (n1(vT*9.0 + t*4.0 + vSeed*31.0) - 0.5)*0.22*t;
  float d = abs(vUV.x - wob)/max(prof, 1e-3);
  float body = smoothstep(1.0, 0.2, d);
  float core = smoothstep(0.8, 0.0, d)*smoothstep(0.02, 0.32, t)*smoothstep(1.0, 0.4, t);
  vec3 col = mix(vec3(1.0, 0.40, 0.07), vec3(1.0, 0.84, 0.52), core);
  float base = smoothstep(0.24, 0.0, t);
  col = mix(col, vec3(0.10, 0.24, 0.95), base*0.85);
  float inten = body*(0.22 + 1.35*core)*mix(1.0, 0.2, base)*smoothstep(0.0, 0.05, t);
  inten *= 1.0 - 0.65*smoothstep(0.4, 0.0, d)*smoothstep(0.32, 0.05, t);      // the dark cone round the wick
  if (uMirror > 0.5) {                        // a rough floor returns only a soft warm streak
    float g = exp(-d*d*2.2)*smoothstep(0.0, 0.25, t)*smoothstep(1.0, 0.45, t);
    o = vec4(vec3(1.0, 0.62, 0.26)*g*uGain*0.11*vAlive*refl, 1.0);
    return;
  }
  o = vec4(col*uTintF*inten*uGain*vAlive, 1.0);
}`;
const DUST_VERT = `precision highp float; precision highp sampler2DShadow;
in vec3 position; in float aSeed;
uniform mat4 viewMatrix, projectionMatrix, uMoonMat; uniform vec3 uCam, uBoxMin, uBoxSize, uDrift, uMoonCol, uMoonDir, uCryptCol, uCryptPos;
uniform sampler2DShadow tMoonDepth; uniform sampler2D tMoonCookie; uniform float uTime, uPx, uGain;
uniform vec4 uPLPos[${NPL}], uPLCol[${NPL}];
out vec3 vCol;
void main(){
  vec3 p = fract(position + uDrift*(0.6 + 0.8*aSeed) + 0.012*vec3(sin(uTime*0.21 + position.y*40.0), sin(uTime*0.17 + position.z*37.0), sin(uTime*0.19 + position.x*43.0)));
  vec3 wp = uBoxMin + p*uBoxSize;
  vec4 sc = uMoonMat*vec4(wp, 1.0);
  vec3 rd = normalize(wp - uCam);
  vec3 light = uMoonCol*textureLod(tMoonCookie, sc.xy, 1.0).rgb*texture(tMoonDepth, vec3(sc.xy, sc.z - 0.001))*(0.5 + 2.2*pow(max(dot(rd, uMoonDir), 0.0), 3.0));
  for (int i = 0; i < ${NPL}; i++){ vec3 d = uPLPos[i].xyz - wp; light += uPLCol[i].rgb*(0.10/(dot(d, d) + 0.5)); }
  vec3 dc = uCryptPos - wp; light += uCryptCol*(0.02/(dot(dc, dc) + 2.0));
  vec4 vp = viewMatrix*vec4(wp, 1.0);
  gl_Position = projectionMatrix*vp;
  float dist = -vp.z, size = uPx*(0.0035 + 0.006*aSeed)/max(dist, 0.05);
  gl_PointSize = clamp(size, 1.0, 6.0);
  vec3 e = min(p, 1.0 - p);
  float fade = smoothstep(0.3, 1.3, dist)*smoothstep(0.0, 0.07, min(e.x, min(e.y, e.z)));
  vCol = light*fade*min(1.0, size*size)*uGain;
}`;
const DUST_FRAG = `precision highp float;
in vec3 vCol; out vec4 o; uniform sampler2D tDepth; uniform vec2 uRes;
void main(){
  if (gl_FragCoord.z > texture(tDepth, gl_FragCoord.xy/uRes).r) discard;
  vec2 q = gl_PointCoord*2.0 - 1.0;
  o = vec4(vCol*smoothstep(1.0, 0.1, length(q)), 1.0);
}`;

const FX = {
  init(candles, noise) {
    // flames
    const S = 8, uv = [], idx = [];
    for (let j = 0; j <= S; j++) { uv.push(-1, j / S, 1, j / S); if (j < S) { const a = j * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); } }
    const g = new T.InstancedBufferGeometry();
    g.setAttribute('aUV', new T.BufferAttribute(new Float32Array(uv), 2));
    g.setIndex(idx);
    const n = candles.length;
    this.iPos = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.iParam = new T.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.iLean = new T.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const iFloor = new T.InstancedBufferAttribute(new Float32Array(n), 1);
    candles.forEach((c, i) => {
      this.iPos.setXYZ(i, c.pos[0], c.pos[1] - 0.006, c.pos[2]); this.iParam.setXYZW(i, c.size, c.seed, 1, 0);
      iFloor.setX(i, [0, 1, 3, 4, 7, 8, 9, 10].includes(c.group) || (c.group >= 5 && c.group <= 6 && c.pos[1] < 0.55 && c.pos[2] > -4.4) ? 1 : 0);
    });
    g.setAttribute('iFloor', iFloor);
    g.setAttribute('iPos', this.iPos); g.setAttribute('iParam', this.iParam); g.setAttribute('iLean', this.iLean);
    g.instanceCount = n;
    const add = { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor, transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide };
    this.flameMat = new T.RawShaderMaterial(Object.assign({
      glslVersion: T.GLSL3, vertexShader: FLAME_VERT, fragmentShader: FLAME_FRAG,
      uniforms: { uCam: U(V3()), uCamF: U(V3()), uTime: U(0), uAgit: U(0), tDepth: U(null), tNormal: U(null), uRes: U(new T.Vector2()), uGain: U(46), uTintF: U(new T.Color(1, 1, 1)), uMirror: U(0), uInvVP: U(new T.Matrix4()) },
    }, add));
    const fm = new T.Mesh(g, this.flameMat); fm.frustumCulled = false;
    this.mirrorMat = this.flameMat.clone(); this.mirrorMat.uniforms.uMirror.value = 1;
    const rm = new T.Mesh(g, this.mirrorMat); rm.frustumCulled = false;
    Pipe.overlay.add(rm); Pipe.overlay.add(fm);
    // dust
    const ND = SHOT && HASH.lowgeo ? 2500 : 7000, rng = mulberry32(99), pos = new Float32Array(ND * 3), seed = new Float32Array(ND);
    for (let i = 0; i < ND; i++) { pos[i * 3] = rng(); pos[i * 3 + 1] = rng(); pos[i * 3 + 2] = rng(); seed[i] = rng(); }
    const dg = new T.BufferGeometry();
    dg.setAttribute('position', new T.BufferAttribute(pos, 3)); dg.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    this.dustMat = new T.RawShaderMaterial(Object.assign({
      glslVersion: T.GLSL3, vertexShader: DUST_VERT, fragmentShader: DUST_FRAG,
      uniforms: {
        uCam: U(V3()), uBoxMin: U(V3(-5.5, 0.05, -9.5)), uBoxSize: U(V3(11, 8, 15)), uDrift: U(V3()), uTime: U(0), uPx: U(1000), uGain: U(1.0),
        uMoonMat: U(Shadows.moonMat), tMoonDepth: U(Shadows.moonRT.depthTexture), tMoonCookie: U(Shadows.cookieRT.texture), uMoonCol: U(new T.Color()), uMoonDir: U(MOON_DIR),
        uCryptCol: U(new T.Color(0, 0, 0)), uCryptPos: U(Shadows.cryptPos), uPLPos: U(Lights.uPLPos), uPLCol: U(Lights.uPLCol), tDepth: U(null), uRes: U(new T.Vector2()),
      },
    }, add));
    const dm = new T.Points(dg, this.dustMat); dm.frustumCulled = false;
    Pipe.overlay.add(dm);
    this.drift = V3();
  },
  // lean: world-space offset of the flame tip per unit height; alive 0/1
  setFlame(i, lx, ly, lz, alive) { this.iLean.setXYZ(i, lx, ly, lz); this.iParam.setZ(i, alive); this.iLean.needsUpdate = true; this.iParam.needsUpdate = true; },
};
