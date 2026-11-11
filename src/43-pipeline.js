// Deferred pipeline: G-buffer → GTAO → lighting (PCSS candle shadows, moon through glass, crypt light)
// → ray-marched dust scattering → TAA (rotation-only reprojection) → flames/dust overlay → bloom → grade.
const GLSL_COMMON = `precision highp float; precision highp sampler2DShadow;
in vec2 vUv;
${GLSL_HASH}${GLSL_COLOR}
const float PI = 3.14159265, TAU = 6.2831853;
vec2 vogel(int i, int n, float phi){ float r = sqrt((float(i) + 0.5)/float(n)); float th = float(i)*2.39996323 + phi; return r*vec2(cos(th), sin(th)); }
`;

// ── ground-truth style ambient occlusion: one slice per pixel, rotated over a 4×4 tile and over time ──
const AO_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tDepth, tNormal; uniform mat4 uProj, uInvProj, uView; uniform vec2 uRes; uniform float uFrame;
vec3 vpos(vec2 uv){ float d = texture(tDepth, uv).r; vec4 c = uInvProj * vec4(uv*2.0 - 1.0, d*2.0 - 1.0, 1.0); return c.xyz/c.w; }
void main(){
  float d = texture(tDepth, vUv).r;
  if (d >= 1.0) { o = vec4(1.0); return; }
  vec3 P = vpos(vUv), V = normalize(-P);
  vec3 N = normalize(mat3(uView) * texture(tNormal, vUv).xyz);
  const float R = 0.85;
  float rPx = min(R * uProj[1][1] * 0.5 * uRes.y / -P.z, 120.0);
  if (rPx < 2.5) { o = vec4(1.0); return; }
  ivec2 pc = ivec2(gl_FragCoord.xy);
  float n4 = float((pc.x & 3) + ((pc.y & 3) << 2));
  float phi = fract(n4*0.5625 + uFrame*0.38196601) * PI;
  float off = fract(ign(gl_FragCoord.xy) + uFrame*0.61803399);
  vec2 dir = vec2(cos(phi), sin(phi));
  vec3 sd = vec3(dir, 0.0);
  vec3 od = sd - dot(sd, V)*V, axis = normalize(cross(sd, V));
  vec3 pn = N - axis*dot(N, axis); float pl = length(pn);
  float cosN = clamp(dot(pn, V)/max(pl, 1e-4), 0.0, 1.0), n = sign(dot(od, pn))*acos(cosN);
  float hcP = -1.0, hcM = -1.0;
  const int STEPS = 6;
  for (int s = 0; s < STEPS; s++){
    float t = (float(s) + off)/float(STEPS); t *= t;
    vec2 o2 = dir*(1.5 + t*rPx)/uRes;
    vec3 a = vpos(vUv + o2) - P; float la = length(a); hcP = max(hcP, mix(-1.0, dot(a, V)/la, clamp(1.0 - la*la/(R*R), 0.0, 1.0)));
    vec3 b = vpos(vUv - o2) - P; float lb = length(b); hcM = max(hcM, mix(-1.0, dot(b, V)/lb, clamp(1.0 - lb*lb/(R*R), 0.0, 1.0)));
  }
  float hP = n + min(acos(hcP) - n, PI*0.5), hM = n + max(-acos(hcM) - n, -PI*0.5);
  float vis = pl*0.25*((cosN + 2.0*hP*sin(n) - cos(2.0*hP - n)) + (cosN + 2.0*hM*sin(n) - cos(2.0*hM - n)));
  o = vec4(clamp(vis, 0.0, 1.0));
}`;
const AO_BLUR_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tAO, tDepth; uniform vec2 uRes, uNF;
float lin(float d){ return uNF.x*uNF.y/(uNF.y - d*(uNF.y - uNF.x)); }
void main(){
  float dc = lin(texture(tDepth, vUv).r), s = 0.0, ws = 0.0;
  for (int y = -2; y < 2; y++) for (int x = -2; x < 2; x++){
    vec2 uv = vUv + vec2(float(x), float(y))/uRes;
    float w = max(0.0, 1.0 - abs(lin(texture(tDepth, uv).r) - dc)/(0.04*dc + 0.03)) + 1e-4;
    s += texture(tAO, uv).r*w; ws += w;
  }
  o = vec4(s/ws);
}`;

// ── deferred lighting ──
const LIGHT_UNIFORMS = `
uniform sampler2DShadow tMoonDepth; uniform sampler2D tMoonCookie; uniform mat4 uMoonMat; uniform vec3 uMoonDir, uMoonCol; uniform vec4 uMoonP;
uniform sampler2DShadow tCryptDepth; uniform mat4 uCryptMat; uniform vec3 uCryptPos, uCryptCol; uniform float uCryptTexel;
`;
const LIGHT_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tAlbedo, tNormal, tEmissive, tDepth, tAO;
uniform mat4 uInvVP; uniform vec3 uCam; uniform float uFrame;
${LIGHT_UNIFORMS}
#define NPL ${NPL}
uniform vec4 uPLPos[NPL], uPLCol[NPL]; uniform sampler2DShadow tPLDepth; uniform sampler2D tPLDist; uniform vec4 uPLA; uniform vec2 uPLNF;
#define NSL ${NSL}
uniform vec4 uSLPos[NSL], uSLCol[NSL]; uniform int uSLN;
#define NGL ${NGL}
uniform vec4 uGLPos[NGL], uGLCol[NGL]; uniform int uGLN;
uniform vec3 uAmbUp, uAmbDn;

vec3 brdf(vec3 N, vec3 V, vec3 L, vec3 alb, vec3 F0, float rough, float metal, out float ndl){
  ndl = max(dot(N, L), 0.0);
  if (ndl <= 0.0) return vec3(0.0);
  vec3 H = normalize(V + L);
  float ndh = max(dot(N, H), 0.0), ndv = max(dot(N, V), 1e-3), vdh = max(dot(V, H), 0.0);
  float a = rough*rough, a2 = a*a, dd = ndh*ndh*(a2 - 1.0) + 1.0, D = a2/(PI*dd*dd);
  float k = (rough + 1.0); k = k*k/8.0;
  float G = (ndv/(ndv*(1.0 - k) + k)) * (ndl/(ndl*(1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0)*pow(1.0 - vdh, 5.0);
  vec3 spec = min(D*G*F/(4.0*ndv*ndl + 1e-4), vec3(40.0));
  return (alb*(1.0 - metal)/PI + spec)*ndl;
}
// cube-atlas lookup: d = light → point. returns atlas uv + reference depth
vec3 plCoord(vec3 d, float row){
  vec3 a = abs(d); float zd, face; vec2 xy;
  if (a.x >= a.y && a.x >= a.z) { zd = a.x; if (d.x > 0.0) { face = 0.0; xy = vec2(d.z, d.y); } else { face = 1.0; xy = vec2(-d.z, d.y); } }
  else if (a.y >= a.z) { zd = a.y; if (d.y > 0.0) { face = 2.0; xy = vec2(d.x, d.z); } else { face = 3.0; xy = vec2(-d.x, d.z); } }
  else { zd = a.z; if (d.z > 0.0) { face = 4.0; xy = vec2(-d.x, d.y); } else { face = 5.0; xy = vec2(d.x, d.y); } }
  vec2 fuv = clamp(xy/(zd*uPLA.z)*0.5 + 0.5, vec2(0.002), vec2(0.998));
  float n = uPLNF.x, f = uPLNF.y, zb = zd - (0.010 + 0.004*zd);
  return vec3((face + fuv.x)*uPLA.x, (row + fuv.y)*uPLA.y, 0.5*(f + n)/(f - n) - f*n/((f - n)*zb) + 0.5);
}
// percentage-closer soft shadows: blocker search on linear distance, then filtered hardware compares
float plShadow(int i, vec3 P, vec3 N, vec3 Lp, float lsize, float rot){
  vec3 d = P - Lp; float dist = length(d);
  d = (P + N*(0.010 + 0.006*dist)) - Lp; dist = length(d);
  vec3 dn = d/dist;
  vec3 t1 = normalize(cross(dn, abs(dn.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), t2 = cross(dn, t1);
  float row = float(i);
  float sR = min(lsize*3.0, 0.12*dist) + 0.012*dist, sumB = 0.0, nB = 0.0;
  for (int k = 0; k < 6; k++){
    vec2 v = vogel(k, 6, rot); vec3 dd = d + (t1*v.x + t2*v.y)*sR;
    float bd = texture(tPLDist, plCoord(dd, row).xy).r * uPLNF.y, rd = length(dd);
    if (bd < rd - (0.03 + 0.012*rd)) { sumB += bd; nB += 1.0; }
  }
  if (nB < 0.5) return 1.0;
  if (nB > 5.5) return 0.0;
  float db = sumB/nB;
  float pen = clamp(lsize*(dist - db)/db, 0.0035*dist, sR);
  float s = 0.0;
  for (int k = 0; k < 8; k++){
    vec2 v = vogel(k, 8, rot + 1.7); vec3 dd = d + (t1*v.x + t2*v.y)*pen;
    s += texture(tPLDepth, plCoord(dd, row));
  }
  return s/8.0;
}
vec3 moonLight(vec3 P, vec3 N, float ndl, float rot){
  vec4 sc = uMoonMat * vec4(P + N*(0.02 + 0.05*(1.0 - ndl)), 1.0);
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0) return vec3(0.0);
  float gz = textureLod(tMoonCookie, sc.xy, 0.0).a;
  float behind = max(0.0, sc.z - gz)*uMoonP.y;                 // metres travelled since the glass
  float blur = 0.03 + behind*0.018;                             // penumbra of a half-degree moon through old glass
  vec3 ck = textureLod(tMoonCookie, sc.xy, log2(max(1.0, blur/uMoonP.z))).rgb;
  if (ck.r + ck.g + ck.b < 1e-4) return vec3(0.0);
  float rad = clamp(blur/uMoonP.w, 1.0, 7.0)*uMoonP.x, s = 0.0;
  for (int k = 0; k < 8; k++) s += texture(tMoonDepth, vec3(sc.xy + vogel(k, 8, rot)*rad, sc.z - 0.0010));
  return uMoonCol * ck * (s/8.0);
}
vec3 cryptLight(vec3 P, vec3 N, float rot, out vec3 L){
  vec3 d = uCryptPos - P; float d2 = dot(d, d), dist = sqrt(d2); L = d/dist;
  vec4 sc = uCryptMat * vec4(P + N*(0.015 + 0.004*dist), 1.0);
  if (sc.w <= 0.0) return vec3(0.0);
  vec3 c = sc.xyz/sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return vec3(0.0);
  float s = 0.0;
  for (int k = 0; k < 8; k++) s += texture(tCryptDepth, vec3(c.xy + vogel(k, 8, rot)*uCryptTexel*2.6, c.z - 0.00012));
  return uCryptCol * (s/8.0) / (d2 + 1.5);
}
void main(){
  float depth = texture(tDepth, vUv).r;
  vec4 wp = uInvVP * vec4(vUv*2.0 - 1.0, depth*2.0 - 1.0, 1.0); vec3 P = wp.xyz/wp.w;
  vec3 rd = normalize(P - uCam); float T = depth >= 1.0 ? 80.0 : length(P - uCam);
  vec3 col = vec3(0.0);
  if (depth < 1.0) {
    vec4 ga = texture(tAlbedo, vUv), gn = texture(tNormal, vUv), ge = texture(tEmissive, vUv);
    vec3 alb = ga.rgb*ga.rgb; float metal = ga.a, rough = gn.w;
    vec3 N = normalize(gn.xyz), V = -rd, F0 = mix(vec3(0.04), alb, metal);
    float ao = texture(tAO, vUv).r, aoc = ao*mix(0.55, 1.0, ge.a), dAO = mix(1.0, aoc, 0.5);
    float rot = fract(ign(gl_FragCoord.xy) + uFrame*0.61803399)*TAU, ndl;
    vec3 f = brdf(N, V, uMoonDir, alb, F0, rough, metal, ndl);
    if (ndl > 0.0) col += f * moonLight(P, N, ndl, rot) * dAO;
    if (uCryptCol.r + uCryptCol.g + uCryptCol.b > 0.0) {
      vec3 L; vec3 e = cryptLight(P, N, rot, L);
      if (e.r + e.g + e.b > 0.0) { f = brdf(N, V, L, alb, F0, rough, metal, ndl); col += f*e*dAO; }
    }
    for (int i = 0; i < NPL; i++){
      vec3 Lp = uPLPos[i].xyz, d = Lp - P; float d2 = dot(d, d), r = uPLPos[i].w;
      if (d2 > r*r) continue;
      vec3 L = d*inversesqrt(d2);
      f = brdf(N, V, L, alb, F0, rough, metal, ndl);
      if (ndl <= 0.0) continue;
      float w = 1.0 - d2/(r*r);
      vec3 e = f * uPLCol[i].rgb * (w*w/(d2 + 0.03));
      if (max(e.r, max(e.g, e.b)) < 0.0004) continue;
      col += e * plShadow(i, P, N, Lp, uPLCol[i].a, rot) * dAO;
    }
    for (int i = 0; i < NSL; i++){
      if (i >= uSLN) break;
      vec3 d = uSLPos[i].xyz - P; float d2 = dot(d, d), r = uSLPos[i].w;
      if (d2 > r*r) continue;
      float w = 1.0 - d2/(r*r), att = w*w/(d2 + 0.004); vec3 L = d*inversesqrt(d2);
      if (uSLCol[i].a > 0.5) col += alb*(1.0 - metal)/PI * uSLCol[i].rgb * att * clamp((dot(N, L) + 0.6)/1.6, 0.0, 1.0) * aoc;
      else { f = brdf(N, V, L, alb, F0, rough, metal, ndl); col += f * uSLCol[i].rgb * att * dAO; }
    }
    col += alb*(1.0 - 0.7*metal) * mix(uAmbDn, uAmbUp, N.y*0.5 + 0.5) * aoc;
    col += ge.rgb;
  }
  // closed-form airlight: the halo of each candle cluster in the dusty air, cut off at the first surface
  for (int i = 0; i < NGL; i++){
    if (i >= uGLN) break;
    vec3 oc = uGLPos[i].xyz - uCam; float t0 = dot(oc, rd);
    float h = sqrt(max(dot(oc, oc) - t0*t0, 0.0) + uGLPos[i].w*uGLPos[i].w);
    col += uGLCol[i].rgb * (atan((T - t0)/h) - atan(-t0/h))/h;
  }
  o = vec4(col, 1.0);
}`;

// ── volumetric single scattering in dusty air (half resolution, temporally accumulated) ──
const VOL_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tDepth, tNoise, tHist;
uniform mat4 uInvVP, uReproj; uniform vec3 uCam, uDrift, uFogAmb; uniform float uFrame, uBlend, uDensity, uGround, uGain;
${LIGHT_UNIFORMS}
float density(vec3 X){
  vec3 q = X*0.19 + uDrift;
  float n = textureLod(tNoise, q.xz + q.y*0.37, 0.0).r*0.6 + textureLod(tNoise, q.zy*1.9 + q.x*0.53, 0.0).g*0.4;
  return uDensity*(0.45 + 1.1*n) + uGround*exp(-max(X.y + 0.2, 0.0)*1.5)*(0.3 + 1.4*n);
}
void main(){
  float dep = texture(tDepth, vUv).r;
  vec4 wp = uInvVP * vec4(vUv*2.0 - 1.0, dep*2.0 - 1.0, 1.0); vec3 P = wp.xyz/wp.w;
  vec3 rd = P - uCam; float T = length(rd); rd /= T; T = min(T, 52.0);
  const int N = 24;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame*0.61803399), dt = T/float(N);
  float cm = dot(rd, uMoonDir), g = 0.55;
  float phM = 0.45 + 0.62*(1.0 - g*g)/pow(1.0 + g*g - 2.0*g*cm, 1.5);       // forward-peaked dust phase
  bool crypt = uCryptCol.r + uCryptCol.g + uCryptCol.b > 0.0;
  vec3 L = vec3(0.0); float tr = 1.0;
  for (int i = 0; i < N; i++){
    vec3 X = uCam + rd*((float(i) + jit)*dt);
    vec3 Li = uFogAmb;
    vec4 sc = uMoonMat * vec4(X, 1.0);
    if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0) {
      float sh = texture(tMoonDepth, vec3(sc.xy, sc.z - 0.0008));
      if (sh > 0.0) Li += uMoonCol * textureLod(tMoonCookie, sc.xy, 1.6).rgb * (sh*phM);
    }
    if (crypt) {
      vec4 cc = uCryptMat * vec4(X, 1.0);
      if (cc.w > 0.0) {
        vec3 c = cc.xyz/cc.w;
        if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) {
          vec3 dl = X - uCryptPos;
          Li += uCryptCol * texture(tCryptDepth, vec3(c.xy, c.z - 0.00012)) * (0.085/(dot(dl, dl) + 1.5));
        }
      }
    }
    float a = 1.0 - exp(-density(X)*dt);
    L += tr*Li*a; tr *= 1.0 - a;
  }
  vec4 cur = vec4(L*uGain, tr);
  vec4 pc = uReproj * vec4(vUv*2.0 - 1.0, 1.0, 1.0); vec2 puv = pc.xy/pc.w*0.5 + 0.5;
  float b = uBlend;
  if (pc.w <= 0.0 || puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) b = 1.0;
  o = mix(texture(tHist, puv), cur, b);
}`;
// depth-aware upsample; drawn over the lit image with blend (ONE, SRC_ALPHA): rgb = in-scatter, a = transmittance
const FOG_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tVol, tDepth; uniform vec2 uVolRes, uNF;
float lin(float d){ return uNF.x*uNF.y/(uNF.y - d*(uNF.y - uNF.x)); }
void main(){
  float dc = lin(texture(tDepth, vUv).r);
  vec2 p = vUv*uVolRes - 0.5, f = fract(p), b = (floor(p) + 0.5)/uVolRes;
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++){
    vec2 uv = b + vec2(float(i), float(j))/uVolRes;
    float w = (i == 0 ? 1.0 - f.x : f.x)*(j == 0 ? 1.0 - f.y : f.y);
    w *= max(0.002, 1.0 - abs(lin(texture(tDepth, uv).r) - dc)/(0.06*dc + 0.05));
    acc += texture(tVol, uv)*w; ws += w;
  }
  o = acc/ws;
}`;

// ── temporal anti-aliasing. The viewer never moves, only turns, so history reprojection is an exact homography ──
const TAA_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tCur, tHist; uniform mat4 uReproj; uniform vec2 uRes; uniform float uBlend;
vec3 toY(vec3 c){ return vec3(dot(c, vec3(0.25, 0.5, 0.25)), dot(c, vec3(0.5, 0.0, -0.5)), dot(c, vec3(-0.25, 0.5, -0.25))); }
vec3 fromY(vec3 c){ return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
vec3 catrom(sampler2D tex, vec2 uv){
  vec2 sp = uv*uRes, tp1 = floor(sp - 0.5) + 0.5, f = sp - tp1;
  vec2 w0 = f*(-0.5 + f*(1.0 - 0.5*f)), w1 = 1.0 + f*f*(-2.5 + 1.5*f), w2 = f*(0.5 + f*(2.0 - 1.5*f)), w3 = f*f*(-0.5 + 0.5*f);
  vec2 w12 = w1 + w2, o12 = w2/w12;
  vec2 t0 = (tp1 - 1.0)/uRes, t3 = (tp1 + 2.0)/uRes, t12 = (tp1 + o12)/uRes;
  vec3 r = textureLod(tex, vec2(t0.x, t0.y), 0.0).rgb*(w0.x*w0.y) + textureLod(tex, vec2(t12.x, t0.y), 0.0).rgb*(w12.x*w0.y) + textureLod(tex, vec2(t3.x, t0.y), 0.0).rgb*(w3.x*w0.y)
         + textureLod(tex, vec2(t0.x, t12.y), 0.0).rgb*(w0.x*w12.y) + textureLod(tex, vec2(t12.x, t12.y), 0.0).rgb*(w12.x*w12.y) + textureLod(tex, vec2(t3.x, t12.y), 0.0).rgb*(w3.x*w12.y)
         + textureLod(tex, vec2(t0.x, t3.y), 0.0).rgb*(w0.x*w3.y) + textureLod(tex, vec2(t12.x, t3.y), 0.0).rgb*(w12.x*w3.y) + textureLod(tex, vec2(t3.x, t3.y), 0.0).rgb*(w3.x*w3.y);
  return max(r, vec3(0.0));
}
void main(){
  vec3 cur = texture(tCur, vUv).rgb;
  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec3 c = toY(texture(tCur, vUv + vec2(float(x), float(y))/uRes).rgb); m1 += c; m2 += c*c;
  }
  vec3 mu = m1/9.0, sg = sqrt(max(m2/9.0 - mu*mu, vec3(0.0)));
  vec4 pc = uReproj * vec4(vUv*2.0 - 1.0, 1.0, 1.0); vec2 puv = pc.xy/pc.w*0.5 + 0.5;
  float b = uBlend;
  if (pc.w <= 0.0 || puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) b = 1.0;
  vec3 hist = fromY(clamp(toY(catrom(tHist, puv)), mu - 1.6*sg - 0.002, mu + 1.6*sg + 0.002));
  float wc = b/(1.0 + luma(cur)), wh = (1.0 - b)/(1.0 + luma(hist));
  o = vec4(max((cur*wc + hist*wh)/(wc + wh), vec3(0.0)), 1.0);
}`;

// ── bloom ──
const BLOOM_DOWN = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tSrc, tSrc2; uniform vec2 uTexel; uniform float uFirst;
vec3 S(vec2 d){ vec2 uv = vUv + d*uTexel; vec3 c = texture(tSrc, uv).rgb; if (uFirst > 0.5) c = min(c + texture(tSrc2, uv).rgb, vec3(90.0)); return c; }
void main(){
  vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0));
  vec3 g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2)), j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
  o = vec4(e*0.125 + (a + c + g + i)*0.03125 + (b + d + f + h)*0.0625 + (j + k + l + m)*0.125, 1.0);
}`;
const BLOOM_UP = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
void main(){
  vec2 t = uTexel;
  vec3 c = texture(tSrc, vUv).rgb*4.0;
  c += (texture(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture(tSrc, vUv + vec2(0.0, t.y)).rgb + texture(tSrc, vUv - vec2(0.0, t.y)).rgb)*2.0;
  c += texture(tSrc, vUv + t).rgb + texture(tSrc, vUv - t).rgb + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  o = vec4(c/16.0*uWeight, 1.0);
}`;

// ── final: lens, grade, film response, eyelids ──
const FINAL_FRAG = GLSL_COMMON + `
out vec4 o;
uniform sampler2D tScene, tOverlay, tBloom, tBlur;
uniform vec2 uRes; uniform float uTime, uExposure, uBloom, uOpen, uStrain, uSat, uContrast, uGrain, uVig, uFade;
uniform vec3 uShadowTint, uHighTint, uLift;
const mat3 ACES_IN = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const mat3 ACES_OUT = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
vec3 filmic(vec3 c){ c = ACES_IN*c; vec3 a = c*(c + 0.0245786) - 0.000090537, b = c*(0.983729*c + 0.4329510) + 0.238081; return clamp(ACES_OUT*(a/b), 0.0, 1.0); }
void main(){
  vec2 p = vUv*2.0 - 1.0; float r2 = dot(p*vec2(1.0, uRes.y/uRes.x*1.25), p*vec2(1.0, uRes.y/uRes.x*1.25));
  // slight lateral chromatic aberration and a gentle unsharp mask on the resolved scene
  vec2 ca = p*r2*0.0011;
  vec3 c = vec3(texture(tScene, vUv + ca).r, texture(tScene, vUv).g, texture(tScene, vUv - ca).b);
  vec2 px = 1.0/uRes;
  vec3 nb = (texture(tScene, vUv + vec2(px.x, 0.0)).rgb + texture(tScene, vUv - vec2(px.x, 0.0)).rgb + texture(tScene, vUv + vec2(0.0, px.y)).rgb + texture(tScene, vUv - vec2(0.0, px.y)).rgb)*0.25;
  c = max(c + (c - nb)*0.22, vec3(0.0));
  c += texture(tOverlay, vUv).rgb;
  vec3 bloom = texture(tBloom, vUv).rgb*(1.0/6.0), blur = texture(tBlur, vUv).rgb;
  c = mix(c, bloom, uBloom);
  // tired or closing eyes lose focus toward the rim first
  float soft = clamp((1.0 - uOpen)*1.1 + uStrain*(0.25 + 0.75*r2), 0.0, 1.0);
  c = mix(c, bloom, soft*0.85);
  c *= uExposure;
  // grade: desaturate, split-tone (cold shadows, warm lights), contrast about mid-grey
  float l = luma(c);
  c = mix(vec3(l), c, uSat - 0.25*uStrain);
  c *= mix(uShadowTint, uHighTint, smoothstep(0.015, 0.45, l));
  c = 0.18*pow(max(c, vec3(0.0))/0.18, vec3(uContrast));
  c = filmic(c);
  c = c*(1.0 - uLift) + uLift;
  c *= 1.0 - uVig*smoothstep(0.25, 1.9, r2) - 0.3*uStrain*smoothstep(0.2, 1.4, r2);
  // eyelids: upper lid travels most; edges are soft because they are far out of focus
  float op = uOpen;
  float top = mix(-0.14, 1.75, op) - 0.34*p.x*p.x*(1.0 - 0.6*op), bot = mix(-0.14, -1.75, op) + 0.24*p.x*p.x*(1.0 - 0.6*op);
  float sf = 0.10 + 0.34*(1.0 - op);
  float lid = smoothstep(top, top - sf, p.y)*smoothstep(bot, bot + sf, p.y);
  c *= lid*mix(0.5, 1.0, smoothstep(0.0, 0.55, op));
  // candle and moonlight glowing dully through closed lids
  vec3 through = blur*uExposure*vec3(0.55, 0.075, 0.035);
  c += (1.0 - lid)*through/(1.0 + through)*0.085;
  c *= uFade;
  c = mix(c*12.92, 1.055*pow(max(c, vec3(1e-5)), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
  // film grain in display space, strongest in the lower mid-tones; doubles as dither
  float gr = hash12(gl_FragCoord.xy + fract(uTime*7.13)*vec2(311.0, 173.0)) + hash12(gl_FragCoord.xy*1.37 + fract(uTime*3.71)*vec2(97.0, 251.0)) - 1.0;
  float gl = luma(c);
  c += gr*(uGrain*(0.25 + 0.75*smoothstep(0.0, 0.25, gl)*(1.0 - 0.6*gl))*lid + 1.0/255.0);
  o = vec4(c, 1.0);
}`;

const Pipe = {
  init(q) {
    this.q = q; this.frame = 0;
    this.m = {
      ao: fsMat(AO_FRAG, { tDepth: U(null), tNormal: U(null), uProj: U(new T.Matrix4()), uInvProj: U(new T.Matrix4()), uView: U(new T.Matrix4()), uRes: U(new T.Vector2()), uFrame: U(0) }),
      aoBlur: fsMat(AO_BLUR_FRAG, { tAO: U(null), tDepth: U(null), uRes: U(new T.Vector2()), uNF: U(new T.Vector2()) }),
      light: fsMat(LIGHT_FRAG, {
        tAlbedo: U(null), tNormal: U(null), tEmissive: U(null), tDepth: U(null), tAO: U(null),
        uInvVP: U(new T.Matrix4()), uCam: U(V3()), uFrame: U(0),
        tMoonDepth: U(Shadows.moonRT.depthTexture), tMoonCookie: U(Shadows.cookieRT.texture), uMoonMat: U(Shadows.moonMat), uMoonDir: U(MOON_DIR), uMoonCol: U(new T.Color()), uMoonP: U(Shadows.moonP),
        tCryptDepth: U(Shadows.cryptRT.depthTexture), uCryptMat: U(Shadows.cryptMat), uCryptPos: U(Shadows.cryptPos), uCryptCol: U(new T.Color(0, 0, 0)), uCryptTexel: U(1 / q.cryptRes),
        uPLPos: U(Lights.uPLPos), uPLCol: U(Lights.uPLCol), tPLDepth: U(Shadows.plRT.depthTexture), tPLDist: U(Shadows.plRT.texture),
        uPLA: U(new T.Vector4(1 / 6, 1 / NPL, PL_GUARD, Shadows.S)), uPLNF: U(new T.Vector2(PL_NEAR, PL_FAR)),
        uSLPos: U(Lights.uSLPos), uSLCol: U(Lights.uSLCol), uSLN: U(0), uGLPos: U(Lights.uGLPos), uGLCol: U(Lights.uGLCol), uGLN: U(0),
        uAmbUp: U(new T.Color()), uAmbDn: U(new T.Color()),
      }),
      vol: fsMat(VOL_FRAG, {
        tDepth: U(null), tNoise: U(null), tHist: U(null), uInvVP: U(new T.Matrix4()), uReproj: U(new T.Matrix4()), uCam: U(V3()), uDrift: U(V3()), uFogAmb: U(new T.Color()),
        uFrame: U(0), uBlend: U(1), uDensity: U(0.01), uGround: U(0), uGain: U(5),
        tMoonDepth: U(Shadows.moonRT.depthTexture), tMoonCookie: U(Shadows.cookieRT.texture), uMoonMat: U(Shadows.moonMat), uMoonDir: U(MOON_DIR), uMoonCol: U(new T.Color()), uMoonP: U(Shadows.moonP),
        tCryptDepth: U(Shadows.cryptRT.depthTexture), uCryptMat: U(Shadows.cryptMat), uCryptPos: U(Shadows.cryptPos), uCryptCol: U(new T.Color(0, 0, 0)), uCryptTexel: U(1 / q.cryptRes),
      }),
      fog: fsMat(FOG_FRAG, { tVol: U(null), tDepth: U(null), uVolRes: U(new T.Vector2()), uNF: U(new T.Vector2()) },
        { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.SrcAlphaFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor, transparent: true }),
      taa: fsMat(TAA_FRAG, { tCur: U(null), tHist: U(null), uReproj: U(new T.Matrix4()), uRes: U(new T.Vector2()), uBlend: U(1) }),
      down: fsMat(BLOOM_DOWN, { tSrc: U(null), tSrc2: U(null), uTexel: U(new T.Vector2()), uFirst: U(0) }),
      up: fsMat(BLOOM_UP, { tSrc: U(null), uTexel: U(new T.Vector2()), uWeight: U(1) },
        { blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.OneFactor, blendDst: T.OneFactor, blendSrcAlpha: T.OneFactor, blendDstAlpha: T.OneFactor, transparent: true }),
      final: fsMat(FINAL_FRAG, {
        tScene: U(null), tOverlay: U(null), tBloom: U(null), tBlur: U(null), uRes: U(new T.Vector2()), uTime: U(0),
        uExposure: U(1), uBloom: U(0.06), uOpen: U(1), uStrain: U(0), uSat: U(1), uContrast: U(1), uGrain: U(0.03), uVig: U(0.4), uFade: U(1),
        uShadowTint: U(new T.Color(1, 1, 1)), uHighTint: U(new T.Color(1, 1, 1)), uLift: U(new T.Color(0, 0, 0)),
      }),
    };
    this.overlay = new T.Scene();
    this.prevVP = new T.Matrix4(); this.hasPrev = false; this.reset = true;
    this.tmp = { vp: new T.Matrix4(), ivp: new T.Matrix4(), reproj: new T.Matrix4(), proj: new T.Matrix4(), iproj: new T.Matrix4(), vpU: new T.Matrix4() };
  },
  resize(w, h) {
    this.w = w; this.h = h;
    for (const k of ['gbuf', 'ao0', 'ao1', 'lit', 'over']) if (this[k]) this[k].dispose();
    for (const l of [this.vol, this.taa, this.bloom]) if (l) l.forEach(t => t.dispose());
    const hf = { type: T.HalfFloatType, format: T.RGBAFormat, depthBuffer: false, minFilter: T.LinearFilter, magFilter: T.LinearFilter };
    this.gbuf = new T.WebGLRenderTarget(w, h, { count: 3, type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter, depthBuffer: true });
    this.gbuf.textures[0].type = T.UnsignedByteType;
    this.gbuf.depthTexture = new T.DepthTexture(w, h, T.UnsignedIntType);
    const r8 = { type: T.UnsignedByteType, format: T.RedFormat, depthBuffer: false, minFilter: T.NearestFilter, magFilter: T.NearestFilter };
    this.ao0 = new T.WebGLRenderTarget(w, h, r8); this.ao1 = new T.WebGLRenderTarget(w, h, r8);
    this.lit = new T.WebGLRenderTarget(w, h, hf);
    this.over = new T.WebGLRenderTarget(w, h, hf);
    const vw = Math.max(2, w >> 1), vh = Math.max(2, h >> 1);
    this.vol = [new T.WebGLRenderTarget(vw, vh, hf), new T.WebGLRenderTarget(vw, vh, hf)];
    this.taa = [new T.WebGLRenderTarget(w, h, hf), new T.WebGLRenderTarget(w, h, hf)];
    this.bloom = [];
    for (let i = 0, bw = w, bh = h; i < 6; i++) { bw = Math.max(2, bw >> 1); bh = Math.max(2, bh >> 1); this.bloom.push(new T.WebGLRenderTarget(bw, bh, hf)); }
    this.reset = true; this.hasPrev = false;
  },
  // cam: PerspectiveCamera (already oriented). fx: per-frame look parameters.
  render(cam, fx) {
    const r = renderer, m = this.m, t = this.tmp, w = this.w, h = this.h, fr = this.frame++;
    // unjittered matrices for reprojection, then sub-pixel jitter for this frame
    cam.clearViewOffset(); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    t.vpU.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const hal = (i, b) => { let f = 1, x = 0; while (i > 0) { f /= b; x += f * (i % b); i = Math.floor(i / b); } return x; };
    const ji = (fr % 16) + 1, jx = hal(ji, 2) - 0.5, jy = hal(ji, 3) - 0.5;
    cam.setViewOffset(w, h, jx, jy, w, h); cam.updateProjectionMatrix();
    t.proj.copy(cam.projectionMatrix); t.iproj.copy(cam.projectionMatrixInverse);
    t.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); t.ivp.copy(t.vp).invert();
    if (this.hasPrev) t.reproj.copy(t.vpU).invert().premultiply(this.prevVP); else t.reproj.identity();
    // after a reset (every blink) history is a true running mean first, then an exponential one
    if (this.reset || !this.hasPrev) this.acc = 0;
    const blendT = Math.max(fx.taaBlend, 1 / (this.acc + 1)), blendV = Math.max(0.06, 1 / (this.acc + 1));
    this.acc++;

    // G-buffer
    World.setPass('g');
    r.setRenderTarget(this.gbuf); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(World.scene, cam);
    const G0 = this.gbuf.textures, D = this.gbuf.depthTexture;
    // ambient occlusion
    let u = m.ao.uniforms;
    u.tDepth.value = D; u.tNormal.value = G0[1]; u.uProj.value.copy(t.proj); u.uInvProj.value.copy(t.iproj); u.uView.value.copy(cam.matrixWorldInverse); u.uRes.value.set(w, h); u.uFrame.value = fr % 64;
    fsPass(m.ao, this.ao0);
    u = m.aoBlur.uniforms; u.tAO.value = this.ao0.texture; u.tDepth.value = D; u.uRes.value.set(w, h); u.uNF.value.set(cam.near, cam.far);
    fsPass(m.aoBlur, this.ao1);
    // lighting
    u = m.light.uniforms;
    u.tAlbedo.value = G0[0]; u.tNormal.value = G0[1]; u.tEmissive.value = G0[2]; u.tDepth.value = D; u.tAO.value = this.ao1.texture;
    u.uInvVP.value.copy(t.ivp); u.uCam.value.copy(cam.position); u.uFrame.value = fr % 64;
    u.uSLN.value = Lights.slN; u.uGLN.value = Lights.glN;
    u.uMoonCol.value.copy(fx.moonCol); u.uCryptCol.value.copy(fx.cryptCol); u.uAmbUp.value.copy(fx.ambUp); u.uAmbDn.value.copy(fx.ambDn);
    fsPass(m.light, this.lit);
    // dust scattering
    const vi = fr & 1, vCur = this.vol[vi], vPrev = this.vol[1 - vi];
    u = m.vol.uniforms;
    u.tDepth.value = D; u.tNoise.value = fx.noise; u.tHist.value = vPrev.texture; u.uInvVP.value.copy(t.ivp); u.uReproj.value.copy(t.reproj); u.uCam.value.copy(cam.position);
    u.uDrift.value.copy(fx.drift); u.uFogAmb.value.copy(fx.fogAmb); u.uFrame.value = fr % 64; u.uBlend.value = blendV; u.uDensity.value = fx.density; u.uGround.value = fx.ground; u.uGain.value = fx.volGain;
    u.uMoonCol.value.copy(fx.moonCol); u.uCryptCol.value.copy(fx.cryptCol);
    fsPass(m.vol, vCur);
    u = m.fog.uniforms; u.tVol.value = vCur.texture; u.tDepth.value = D; u.uVolRes.value.set(vCur.width, vCur.height); u.uNF.value.set(cam.near, cam.far);
    fsPass(m.fog, this.lit);
    // temporal resolve
    const tCur = this.taa[vi], tPrev = this.taa[1 - vi];
    u = m.taa.uniforms; u.tCur.value = this.lit.texture; u.tHist.value = tPrev.texture; u.uReproj.value.copy(t.reproj); u.uRes.value.set(w, h); u.uBlend.value = blendT;
    fsPass(m.taa, tCur);
    // overlay: flames and dust motes, un-jittered, depth-tested against the G-buffer by hand
    cam.clearViewOffset(); cam.updateProjectionMatrix();
    r.setRenderTarget(this.over); r.setClearColor(0x000000, 1); r.clear(true, false, false);
    if (fx.overlayPrep) fx.overlayPrep(D, w, h, G0[1], t.ivp);
    r.render(this.overlay, cam);
    // bloom pyramid
    u = m.down.uniforms;
    for (let i = 0; i < this.bloom.length; i++) {
      const src = i === 0 ? tCur : this.bloom[i - 1];
      u.tSrc.value = src.texture; u.tSrc2.value = this.over.texture; u.uFirst.value = i === 0 ? 1 : 0; u.uTexel.value.set(1 / src.width, 1 / src.height);
      fsPass(m.down, this.bloom[i]);
    }
    u = m.up.uniforms;
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const src = this.bloom[i];
      u.tSrc.value = src.texture; u.uTexel.value.set(1 / src.width, 1 / src.height); u.uWeight.value = 1.0;
      fsPass(m.up, this.bloom[i - 1]);
    }
    // final
    u = m.final.uniforms;
    u.tScene.value = tCur.texture; u.tOverlay.value = this.over.texture; u.tBloom.value = this.bloom[0].texture; u.tBlur.value = this.bloom[5].texture;
    u.uRes.value.set(w, h); u.uTime.value = fx.time; u.uExposure.value = fx.exposure; u.uBloom.value = fx.bloom; u.uOpen.value = fx.open; u.uStrain.value = fx.strain;
    u.uSat.value = fx.sat; u.uContrast.value = fx.contrast; u.uGrain.value = fx.grain; u.uVig.value = fx.vig; u.uFade.value = fx.fade;
    u.uShadowTint.value.copy(fx.shadowTint); u.uHighTint.value.copy(fx.highTint); u.uLift.value.copy(fx.lift);
    fsPass(m.final, null);
    this.prevVP.copy(t.vpU); this.hasPrev = true; this.reset = false;
  },
};
