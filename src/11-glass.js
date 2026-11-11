// Stained glass, generated as leaded mosaics with pictogram medallions.
// The medallions carry the only "telling" of the story: hooded wardens, a sealed door,
// a thing below with seven keepers around it, and an eye that must stay open.
// rgb = transmitted colour (premultiplied by mask), a = 1 where glass / 0 where lead or stone.
const GLASS_FRAG = `precision highp float;
in vec2 vUv; out vec4 o;
uniform vec2 uSz; uniform float uSeed; uniform int uKind; uniform float uGl[8]; uniform float uTop; uniform float uEye; uniform int uMed;
${GLSL_HASH}
const float TAU = 6.2831853;
const vec3 RUBY = vec3(0.60, 0.022, 0.035), BLUE = vec3(0.03, 0.105, 0.60), DEEP = vec3(0.012, 0.04, 0.30), GOLD = vec3(0.88, 0.53, 0.07);
const vec3 EMER = vec3(0.03, 0.44, 0.17), VIOL = vec3(0.27, 0.05, 0.42), PEARL = vec3(0.74, 0.78, 0.68), GREY = vec3(0.44, 0.46, 0.43), DARK = vec3(0.012, 0.009, 0.02);
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ return 0.5*vnoise(p) + 0.25*vnoise(p*2.03+7.0) + 0.125*vnoise(p*4.1+13.0) + 0.0625*vnoise(p*8.2+29.0); }
float sdLancet(vec2 p, float a, float s, float R){ p.x = abs(p.x); if (p.y < s) return max(p.x - a, -p.y); return length(p - vec2(a - R, s)) - R; }

// st: 0 open … 1 closed, 2 = open with a slit pupil
vec3 eyeGlyph(vec2 m, float st, vec3 ground, inout float ld){
  vec3 c = ground;
  float openness = st > 1.5 ? 1.0 : 1.0 - st;
  if (openness > 0.06) {
    vec2 q = vec2(m.x, m.y/openness);
    float d = max(length(q - vec2(0.0, -0.62)) - 1.05, length(q - vec2(0.0, 0.62)) - 1.05) * openness;
    if (d < 0.0) {
      c = PEARL;
      float ir = length(m);
      if (ir < 0.40) {
        float streak = 0.75 + 0.5*hash11(floor(atan(m.y, m.x)/TAU*28.0) + 3.0);
        c = (st > 1.5 ? EMER*1.5 : mix(BLUE*1.5, GOLD, smoothstep(0.30, 0.40, ir))) * streak;
        float pd = st > 1.5 ? max(abs(m.x) - 0.075*(1.0 - m.y*m.y*6.0), abs(m.y) - 0.37) : ir - 0.17;
        if (pd < 0.0) c = DARK;
        ld = min(ld, min(abs(pd), abs(ir - 0.40)));
      }
    }
    ld = min(ld, abs(d));
  } else {
    float arc = (m.y < 0.03 && abs(m.x) < 0.86) ? abs(length(m - vec2(0.0, 0.80)) - 1.16) : 9.0;
    float lash = 9.0;
    for (int i = -2; i <= 2; i++){
      float a = float(i)*0.33; vec2 dir = vec2(sin(a), -cos(a)); vec2 e = m - (vec2(0.0, 0.80) + dir*1.16);
      lash = min(lash, length(e - dir*clamp(dot(e, dir), 0.0, 0.22)));
    }
    float dl = min(arc, lash) - 0.05;
    if (dl < 0.0) c = GOLD;
    ld = min(ld, abs(dl));
  }
  return c;
}

vec3 glyph(int id, vec2 m, vec3 ground, inout float ld){
  vec3 c = ground;
  float bx = abs(m.x);
  if (id == 0) c = eyeGlyph(m*1.1, 0.0, ground, ld);
  else if (id == 1) c = eyeGlyph(m*1.1, 1.0, ground, ld);
  else if (id == 2) {                                   // hooded warden
    float robe = max(bx - mix(0.52, 0.20, clamp((m.y + 0.85)/1.05, 0.0, 1.0)), max(-0.85 - m.y, m.y - 0.20));
    float hood = length(vec2(m.x, (m.y - 0.42)*0.82)) - 0.29;
    float body = min(robe, hood);
    float face = length(vec2(m.x*1.2, m.y - 0.37)) - 0.15;
    if (body < 0.0) c = GREY*(0.85 + 0.3*step(0.0, m.x));
    if (face < 0.0) c = DARK;
    ld = min(ld, min(abs(body), abs(face)));
    if (robe < 0.0) ld = min(ld, abs(bx - mix(0.20, 0.07, clamp((m.y + 0.85)/1.05, 0.0, 1.0))));
  } else if (id == 3) {                                 // the sealed door
    float dr = sdLancet(vec2(m.x, m.y + 0.78), 0.44, 0.86, 0.62);
    if (dr < 0.0) {
      c = vec3(0.34, 0.15, 0.045)*(0.8 + 0.4*step(0.5, fract(m.x*4.5)));
      float x1 = abs(m.x*0.78 - (m.y + 0.12))*0.79, x2 = abs(m.x*0.78 + (m.y + 0.12))*0.79;
      float ch = min(x1, x2) - 0.035;
      if (ch < 0.0) c = DARK;
      float seal = length(m - vec2(0.0, -0.12)) - 0.19;
      if (seal < 0.0) c = GOLD;
      ld = min(ld, min(min(abs(seal), abs(ch)), bx));
    }
    ld = min(ld, abs(dr));
  } else if (id == 4) {                                 // what lies below
    vec2 q = m - vec2(0.0, -0.22); float r = length(q), a = atan(q.x, q.y);
    float ten = 0.30 + 0.56*pow(abs(sin(a*3.5)), 5.0)*(0.75 + 0.25*sin(a*2.0 + uSeed));
    float d = r - ten;
    if (d < 0.10) c = EMER*1.6;
    if (d < 0.0) c = DARK;
    ld = min(ld, min(abs(d), abs(d - 0.10)));
  } else if (id == 5) {                                 // a candle
    float body = max(bx - 0.13, max(-0.82 - m.y, m.y - 0.02));
    vec2 f = m - vec2(0.0, 0.34);
    float fl = length(vec2(f.x*(1.7 + 1.8*clamp(f.y + 0.22, 0.0, 1.0)), f.y)) - 0.27;
    if (body < 0.0) c = PEARL;
    if (fl < 0.0) c = GOLD*1.15;
    ld = min(ld, min(abs(body), abs(fl)));
  } else if (id == 6) {                                 // radiant disc
    float r = length(m), a = atan(m.y, m.x);
    float rays = r - (0.44 + 0.40*pow(abs(cos(a*6.0)), 8.0));
    if (rays < 0.0) c = GOLD;
    if (r < 0.34) c = mix(GOLD, PEARL, 0.55);
    ld = min(ld, min(abs(rays), abs(r - 0.34)));
  } else if (id == 7) {                                 // seven keepers round a pit
    float d = length(m) - 0.25;
    if (d < 0.08) c = EMER*1.4;
    if (d < 0.0) c = DARK;
    ld = min(ld, min(abs(d), abs(d - 0.08)));
    for (int i = 0; i < 7; i++){
      float a = float(i)*TAU/7.0 + 1.5708; float dd = length(m - 0.64*vec2(cos(a), sin(a))) - 0.15;
      if (dd < 0.0) c = PEARL;
      ld = min(ld, abs(dd));
    }
  } else {                                              // stairs going down to a green door
    float k = clamp(floor((m.x + 0.78)/0.26), 0.0, 5.0);
    float top = 0.52 - 0.22*k;
    float st = max(m.y - top, max(-0.82 - m.y, bx - 0.78));
    if (st < 0.0) c = GREY*(0.7 + 0.08*k);
    float dd = max(abs(m.x - 0.60) - 0.12, abs(m.y + 0.36) - 0.20);
    if (dd < 0.0) c = EMER*1.5;
    ld = min(ld, min(abs(st), abs(dd)));
    ld = min(ld, st < 0.0 ? abs(fract((m.x + 0.78)/0.26) - 0.0)*0.26 : 9.0);
  }
  return c;
}

// one tall light (local coords: x centred, y from 0); dL = signed distance to its outline (negative inside)
void lightFill(vec2 q, float dL, float halfW, float topY, float side, vec3 fieldA, vec3 fieldB, vec3 ground, inout vec3 col, inout float lead){
  lead = min(lead, -dL);
  if (dL > -0.055) {
    float seg = (q.y + abs(q.x)*0.6)/0.115, hh = hash12(vec2(floor(seg), side + uSeed*7.0));
    col = hh < 0.34 ? RUBY : (hh < 0.60 ? GOLD : (hh < 0.86 ? BLUE : PEARL));
    lead = min(lead, min((0.5 - abs(fract(seg) - 0.5))*0.115, abs(dL + 0.055)));
    return;
  }
  float s = 0.118; vec2 g = vec2(q.x + q.y*0.6, q.x - q.y*0.6)/s; vec2 gi = floor(g), gf = fract(g);
  float hh = hash12(gi + side*17.0 + uSeed*31.0);
  col = hh < 0.62 ? fieldA*(0.55 + 0.9*hash12(gi + 5.0)) : (hh < 0.87 ? fieldB : PEARL*0.75);
  vec2 e = min(gf, 1.0 - gf)*s*0.857;
  lead = min(lead, min(e.x, e.y));
  float mr = halfW - 0.075;
  for (int k = 0; k < 4; k++){
    if (k >= uMed) break;
    vec2 m = q - vec2(0.0, 0.16 + mr + (topY - 0.2 - 2.0*mr)*float(k)/max(1.0, float(uMed - 1)));
    float dm = length(m) - mr;
    if (dm < 0.0) {
      if (dm > -0.036) {
        float seg = atan(m.y, m.x)/TAU*22.0;
        col = (mod(floor(seg), 2.0) < 0.5 ? PEARL : GOLD);
        lead = min(min(-dm, abs(dm + 0.036)), (0.5 - abs(fract(seg) - 0.5))*TAU/22.0*mr);
      } else {
        float ld = 9.0; float rr = mr - 0.036;
        int gid = int(uGl[k*2 + int(side)] + 0.5);
        col = glyph(gid, m/rr, ground, ld);
        lead = min(abs(dm + 0.036), ld*rr);
      }
    } else lead = min(lead, dm);
  }
}

void main(){
  vec3 col = vec3(0.0); float lead = 1.0; bool glass = false;
  float th = hash11(uSeed*3.3 + 0.7);
  vec3 fieldA = th < 0.5 ? BLUE : RUBY, fieldB = th < 0.5 ? RUBY : DEEP;
  vec3 ground = th < 0.5 ? RUBY*0.9 : DEEP*1.4;
  vec2 p;
  if (uKind == 0) {                       // two-light lancet with a foiled oculus
    p = vec2((vUv.x - 0.5)*uSz.x, vUv.y*uSz.y);
    float W = uSz.x, H = uSz.y, a = W*0.5, R = W;
    float sMain = H - sqrt(2.0*R*a - a*a);
    float dO = sdLancet(p, a, sMain, R);
    const float FR = 0.075;
    float a2 = (a - FR - 0.04)*0.5, cx = 0.04 + a2, R2 = 2.0*a2, s2 = sMain - 0.12;
    vec2 pl = vec2(abs(p.x) - cx, p.y - FR);
    float dL = sdLancet(pl, a2, s2 - FR, R2);
    float rc = 0.175*W; vec2 oc = vec2(0.0, sMain + 0.49*W);
    float dC = length(p - oc) - rc;
    if (dO < -FR*0.6) {
      if (dL < 0.0) {
        glass = true;
        lightFill(pl, dL, a2, s2 - FR + sqrt(2.0*R2*a2 - a2*a2)*0.55, p.x < 0.0 ? 0.0 : 1.0, fieldA, fieldB, ground, col, lead);
        lead = min(lead, abs(fract(p.y/0.64 + 0.25) - 0.5)*0.64 - 0.0035);     // iron saddle bars
      } else if (dC < 0.0) {
        vec2 m = (p - oc)/rc; float foil = 9.0;
        for (int i = 0; i < 4; i++){ float an = float(i)*1.5708 + 0.7854; foil = min(foil, length(m - 0.46*vec2(cos(an), sin(an))) - 0.50); }
        foil = min(foil, length(m) - 0.5);
        if (foil < 0.0) {
          glass = true; float ld = 9.0;
          col = glyph(int(uTop + 0.5), m/0.62, th < 0.5 ? DEEP*1.6 : RUBY, ld);
          if (length(m) > 0.62) { col = GOLD*(0.6 + 0.5*hash11(floor(atan(m.y, m.x)*2.5) + uSeed)); ld = min(ld, abs(length(m) - 0.62)); }
          lead = min(-foil*rc, ld*rc*0.62);
        }
      } else {
        // small pierced spandrels either side of the oculus
        vec2 e = vec2(abs(p.x) - W*0.30, p.y - (sMain + 0.20*W)); float de = length(e) - 0.055*W;
        if (de < 0.0) { glass = true; col = th < 0.5 ? GOLD : EMER; lead = -de; }
      }
    }
  } else {                                // rose with the watching eye at its heart
    p = (vUv - 0.5)*uSz;
    float r = length(p), ang = atan(p.y, p.x), RO = uSz.x*0.5;
    if (r < 0.90) {
      glass = true; float ld = 9.0;
      vec2 m = p/0.90;
      float seg = ang/TAU*24.0;
      vec3 gcol = mod(floor(seg), 2.0) < 0.5 ? DEEP*1.5 : BLUE*0.9;
      float gl = (0.5 - abs(fract(seg) - 0.5))*TAU/24.0*r;
      col = eyeGlyph(m*1.12, uEye, vec3(-1.0), ld);
      if (col.x < 0.0) { col = gcol; ld = min(ld, gl/0.90); ld = min(ld, abs(length(m) - 0.55)); if (length(m) > 0.55 && mod(floor(seg), 3.0) < 0.5) col = GOLD*0.8; }
      lead = min(0.90 - r, ld*0.90/1.12);
    } else if (r > 1.03 && r < RO - 0.11) {
      float sa = TAU/12.0, ai = floor(ang/sa + 0.5), al = ang - ai*sa;
      vec2 q = vec2(r*sin(al), r*cos(al));
      float tn = tan(sa*0.5), spoke = 0.045, aw = 2.0*tn - spoke;
      float dW = (abs(q.x) - (q.y*tn - spoke))*0.966;
      float dHead = length(vec2(abs(q.x) + aw, q.y - 2.0)) - 2.0*aw;
      float dP = q.y < 2.0 ? max(dW, 1.03 - q.y) : max(dHead, dW);
      float pid = mod(ai + 12.0, 12.0);
      if (dP < 0.0) {
        glass = true; lead = -dP;
        bool alt = mod(pid, 2.0) < 0.5;
        vec3 fa = alt ? BLUE : RUBY, fb = alt ? RUBY : DEEP;
        if (dP > -0.05) {
          float seg = q.y/0.12, hh = hash12(vec2(floor(seg), pid + step(0.0, q.x)*3.0));
          col = hh < 0.4 ? GOLD : (hh < 0.7 ? PEARL : fa);
          lead = min(lead, min((0.5 - abs(fract(seg) - 0.5))*0.12, abs(dP + 0.05)));
        } else {
          float s = 0.12; vec2 g = vec2(q.x + q.y*0.6, q.x - q.y*0.6)/s; vec2 gi = floor(g), gf = fract(g);
          float hh = hash12(gi + pid*9.0);
          col = hh < 0.6 ? fa*(0.55 + 0.9*hash12(gi + 5.0)) : (hh < 0.87 ? fb : PEARL*0.75);
          vec2 e = min(gf, 1.0 - gf)*s*0.857; lead = min(lead, min(e.x, e.y));
          vec2 m = q - vec2(0.0, 1.92); float mr = 0.31, dm = length(m) - mr;
          if (dm < 0.0) {
            if (dm > -0.035) { col = PEARL; lead = min(-dm, abs(dm + 0.035)); }
            else { float ld = 9.0; col = glyph(mod(pid*7.0, 12.0) < 6.5 ? 2 : 5, m/(mr - 0.035), alt ? RUBY*0.9 : DEEP*1.5, ld); lead = min(abs(dm + 0.035), ld*(mr - 0.035)); }
          } else lead = min(lead, dm);
        }
      } else {
        float al2 = abs(al) - sa*0.5; vec2 q2 = vec2(r*sin(al2), r*cos(al2)) - vec2(0.0, 2.63);
        float dc = length(q2) - 0.155;
        if (dc < 0.0) { glass = true; col = mod(pid, 2.0) < 0.5 ? GOLD : EMER; lead = -dc; }
      }
    }
  }
  if (!glass) { o = vec4(0.0); return; }
  float mask = smoothstep(0.0045, 0.0085, lead);
  col *= 0.50 + 0.85*fbm(vec2(p.x*9.0, p.y*2.2) + uSeed*13.0);      // reamy streaks of hand-made glass
  col *= 0.80 + 0.36*fbm(p*23.0 + 5.0);
  col *= mix(0.30, 1.0, smoothstep(0.004, 0.034, lead));           // paint and soot gathering along the leads
  col *= 1.0 - 0.4*smoothstep(0.72, 0.95, vnoise(p*150.0 + 3.0));  // pitting
  if (uKind == 0) col *= mix(0.62, 1.0, smoothstep(0.0, 1.4, p.y));
  o = vec4(col*mask, mask);
}`;

const GLASS = { lancet: null, apse: null, rose: null };
// medallion programmes: [L-low, R-low, L-2, R-2, L-3, R-3, L-4, R-4], then the oculus glyph
const LANCET_PROG = [
  [[2, 2, 0, 6], 6], [[4, 8, 7, 2], 0], [[3, 3, 5, 0], 6], [[7, 5, 6, 2], 0],
  [[8, 3, 4, 1], 6], [[5, 2, 0, 7], 0], [[1, 0, 4, 3], 6], [[2, 5, 3, 6], 0],
];
const APSE_PROG = [
  [[2, 5, 7, 2, 3, 6, 0, 0], 6], [[5, 2, 2, 7, 6, 3, 0, 6], 0], [[4, 4, 7, 7, 3, 3, 0, 0], 6], [[2, 5, 7, 2, 6, 3, 6, 0], 0], [[5, 2, 2, 7, 3, 6, 0, 0], 6],
];
function bakeGlass(aniso) {
  const k = SHOT && HASH.lowtex ? 0.5 : 1;
  const mat = fsMat(GLASS_FRAG, { uSz: U(new T.Vector2()), uSeed: U(0), uKind: U(0), uGl: U(new Float32Array(8)), uTop: U(0), uEye: U(0), uMed: U(2) });
  const mk = (w, h) => {
    const rt = new T.WebGLRenderTarget(Math.round(w * k), Math.round(h * k), { depthBuffer: false, type: T.UnsignedByteType, format: T.RGBAFormat });
    const t = rt.texture; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.anisotropy = aniso;
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    return rt;
  };
  const draw = (rt, x, y, w, h) => {
    rt.viewport.set(x * k, y * k, w * k, h * k); rt.scissor.set(x * k, y * k, w * k, h * k); rt.scissorTest = true;
    fsPass(mat, rt);
  };
  const u = mat.uniforms;
  // lancets: 8 variants, 1.5 × 4.4 m
  {
    const cw = 320, ch = 944, rt = mk(cw * 8, ch);
    u.uKind.value = 0; u.uSz.value.set(1.5, 4.4); u.uMed.value = 2;
    LANCET_PROG.forEach(([g, top], i) => { u.uSeed.value = i * 1.37 + 0.2; u.uGl.value.set(g.concat([0, 0, 0, 0]).slice(0, 8)); u.uTop.value = top; draw(rt, i * cw, 0, cw, ch); });
    GLASS.lancet = { tex: rt.texture, n: 8, rect: i => [i / 8, 0, (i + 1) / 8, 1], w: 1.5, h: 4.4 };
  }
  // apse: 5 variants, 1.5 × 8.2 m
  {
    const cw = 320, ch = 1744, rt = mk(cw * 5, ch);
    u.uKind.value = 0; u.uSz.value.set(1.5, 8.2); u.uMed.value = 4;
    APSE_PROG.forEach(([g, top], i) => { u.uSeed.value = i * 2.11 + 5.3; u.uGl.value.set(g); u.uTop.value = top; draw(rt, i * cw, 0, cw, ch); });
    GLASS.apse = { tex: rt.texture, n: 5, rect: i => [i / 5, 0, (i + 1) / 5, 1], w: 1.5, h: 8.2 };
  }
  // rose: 4 eye states in a 2 × 2 atlas
  {
    const c = 1152, rt = mk(c * 2, c * 2);
    u.uKind.value = 2; u.uSz.value.set(6.0, 6.0); u.uSeed.value = 9.1;
    [0.0, 0.55, 1.0, 2.0].forEach((e, i) => { u.uEye.value = e; draw(rt, (i % 2) * c, Math.floor(i / 2) * c, c, c); });
    GLASS.rose = { tex: rt.texture, n: 4, rect: i => [(i % 2) / 2, Math.floor(i / 2) / 2, (i % 2) / 2 + 0.5, Math.floor(i / 2) / 2 + 0.5], w: 6, h: 6 };
  }
  mat.dispose();
  renderer.setRenderTarget(null);
}
