// Procedural surface textures, baked once on the GPU into tiling, mip-mapped maps.
//   A: rgb = albedo (sqrt-encoded), a = height        B: rg = tangent normal, b = roughness, a = cavity
const BAKE_HEAD = `precision highp float;
in vec2 vUv;
layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
uniform float uSize, uTile, uBump;
${GLSL_HASH}${GLSL_PNOISE}
const float TAU = 6.2831853;
`;
const BAKE_MAIN = `
void main(){
  float r, c, r2, c2;
  vec4 s = surf(vUv, r, c);
  float e = 1.0/uSize;
  float hx = surf(vUv + vec2(e, 0.0), r2, c2).a, hy = surf(vUv + vec2(0.0, e), r2, c2).a;
  vec2 g = vec2(hx - s.a, hy - s.a) / (e*uTile) * uBump;
  vec3 n = normalize(vec3(-g, 1.0));
  oA = vec4(sqrt(clamp(s.rgb, 0.0, 1.0)), clamp(s.a*40.0 + 0.5, 0.0, 1.0));
  oB = vec4(n.xy*0.5+0.5, clamp(r, 0.04, 1.0), clamp(c, 0.0, 1.0));
}`;

const SURF = {
  // coursed limestone ashlar — 3 m tile, 8 courses
  ashlar: { size: 2048, tile: 3.0, bump: 1.0, code: `
vec4 surf(vec2 uv, out float rough, out float cav){
  uv = fract(uv);
  float y = uv.y*8.0, row = floor(y), fy = fract(y);
  float cols = 3.0 + floor(hash11(row*7.3+0.5)*2.0);
  float x = uv.x*cols + hash11(row*3.1+1.7), col = mod(floor(x), cols), fx = fract(x);
  vec2 id = vec2(col, row);
  vec2 dm = vec2(min(fx, 1.0-fx)*3.0/cols, min(fy, 1.0-fy)*0.375);
  float warp = (pfbm(uv*24.0, 24.0, 3)-0.5)*0.014;
  float edge = min(dm.x, dm.y) + warp;
  float joint = smoothstep(0.004, 0.011, edge);
  float bevel = smoothstep(0.004, 0.04, edge);
  float h1 = hash12(id+11.0), h2 = hash12(id+23.0);
  float grain = pfbm(uv*48.0, 48.0, 4);
  float big = pfbm(uv*6.0 + h1*5.0, 6.0, 4);
  float stain = pfbm(uv*5.0+3.0, 5.0, 3);
  float pit = smoothstep(0.13, 0.0, pworley(uv*44.0, 44.0).x) * step(0.52, pfbm(uv*10.0, 10.0, 2));
  float tool = sin(TAU*(uv.x*150.0 + uv.y*90.0) + h2*30.0)*0.5+0.5;
  float h = joint*(0.006 + (h1-0.5)*0.004) + bevel*0.002 + (grain-0.5)*0.0018 + (big-0.5)*0.003 - pit*0.003 + tool*0.00025*joint;
  vec3 stone = mix(vec3(0.44,0.40,0.34), vec3(0.58,0.54,0.47), h2);
  stone *= 0.80 + 0.34*big;
  stone = mix(stone, stone*vec3(0.74,0.80,0.72), smoothstep(0.55, 0.8, stain)*0.6);
  stone *= 0.9 + 0.2*grain;
  vec3 mortar = vec3(0.27,0.25,0.22)*(0.8+0.4*grain);
  vec3 colr = mix(mortar, stone, joint);
  colr *= mix(0.66, 1.0, bevel) * (1.0 - pit*0.4);
  rough = mix(0.96, 0.80 + 0.14*grain, joint);
  cav = mix(0.5, 1.0, bevel) * (1.0 - pit*0.45);
  return vec4(colr, h);
}` },
  // dressed limestone for piers, ribs, carving — 2 m tile
  stone: { size: 1024, tile: 2.0, bump: 1.0, code: `
vec4 surf(vec2 uv, out float rough, out float cav){
  uv = fract(uv);
  float big = pfbm(uv*4.0, 4.0, 5), mid = pfbm(uv*16.0+5.0, 16.0, 4), fine = pfbm(uv*96.0, 96.0, 3);
  vec3 w = pworley(uv*7.0, 7.0);
  float crack = smoothstep(0.022, 0.0, w.y-w.x) * smoothstep(0.66, 0.8, pfbm(uv*3.0+9.0, 3.0, 2));
  float pits = smoothstep(0.11, 0.0, pworley(uv*64.0, 64.0).x) * smoothstep(0.45, 0.7, mid);
  float h = (big-0.5)*0.004 + (mid-0.5)*0.0016 + (fine-0.5)*0.0007 - crack*0.002 - pits*0.0016;
  vec3 colr = mix(vec3(0.46,0.42,0.36), vec3(0.64,0.60,0.53), big);
  colr = mix(colr, colr*vec3(0.80,0.79,0.74), smoothstep(0.45, 0.75, mid)*0.55);
  colr *= (0.92 + 0.16*fine) * (1.0 - crack*0.5 - pits*0.3);
  rough = 0.60 + 0.22*mid - 0.10*big;
  cav = 1.0 - crack*0.5 - pits*0.35;
  return vec4(colr, h);
}` },
  // worn chequered flagstones — 3 m tile, 0.75 m slabs
  floor: { size: 2048, tile: 3.0, bump: 1.0, code: `
vec4 surf(vec2 uv, out float rough, out float cav){
  uv = fract(uv);
  vec2 g = uv*4.0, id = floor(g), f = fract(g);
  float chk = mod(id.x+id.y, 2.0);
  vec2 dm = min(f, 1.0-f)*0.75;
  float edge = min(dm.x, dm.y) + (pfbm(uv*32.0, 32.0, 3)-0.5)*0.006;
  float joint = smoothstep(0.0025, 0.007, edge);
  float rnd = smoothstep(0.0, 0.06, edge);
  float h1 = hash12(id+3.0), h2 = hash12(id+17.0);
  float big = pfbm(uv*5.0 + h1*9.0, 5.0, 4), fine = pfbm(uv*80.0, 80.0, 3);
  float wear = pfbm(uv*3.0+2.0, 3.0, 4);
  vec3 w = pworley(uv*6.0 + h2*7.0, 6.0);
  float crack = smoothstep(0.016, 0.0, w.y-w.x) * step(0.86, h2);
  float scr = smoothstep(0.80, 1.0, pnoise(vec2(uv.x*18.0 + uv.y*3.0, uv.y*300.0), vec2(18.0, 300.0))) * 0.6;
  vec3 dark = vec3(0.085,0.082,0.088)*(0.7+0.7*big), light = vec3(0.46,0.42,0.36)*(0.78+0.44*big);
  float vein = smoothstep(0.04, 0.0, abs(pfbm(uv*7.0 + h1*4.0, 7.0, 4)-0.5)) * (1.0-chk);
  vec3 colr = mix(dark, light, chk);
  colr = mix(colr, vec3(0.24,0.235,0.23), vein*0.42);
  colr *= 0.94 + 0.12*fine;
  colr = mix(vec3(0.04,0.036,0.03), colr, joint) * (1.0 - crack*0.6);
  float h = joint*0.003 + rnd*0.0016 + (h1-0.5)*0.0016*joint + (big-0.5)*0.0012 + (fine-0.5)*0.00025 - crack*0.0016 - scr*0.0002;
  rough = mix(0.92, mix(0.46, 0.17, smoothstep(0.32, 0.7, wear)) + 0.10*fine + chk*0.10 + scr*0.2, joint);
  rough = mix(rough, 0.85, crack);
  cav = mix(0.45, 1.0, rnd) * (1.0 - crack*0.4);
  return vec4(colr, h);
}` },
  // dark oak boards, grain along v — 2 m tile, 0.2 m planks
  wood: { size: 1024, tile: 2.0, bump: 1.0, code: `
vec4 surf(vec2 uv, out float rough, out float cav){
  uv = fract(uv);
  float px = uv.x*10.0, pid = floor(px), fx = fract(px);
  float h1 = hash11(pid*3.7+1.0), h2 = hash11(pid*9.1+4.0);
  float qy = uv.y + h1;
  float warp = pfbm(vec2(uv.x*15.0, qy*3.0), vec2(15.0, 3.0), 3);
  float rings = pnoise(vec2((fx + h2)*5.0 + pid*13.0, qy*2.0), vec2(4096.0, 2.0));
  float grain = sin((fx + warp*0.4 + h2)*70.0 + rings*9.0)*0.5+0.5;
  float fiber = pnoise(vec2(uv.x*400.0, uv.y*24.0), vec2(400.0, 24.0));
  float gap = smoothstep(0.0, 0.04, min(fx, 1.0-fx));
  vec3 w = pworley(vec2(uv.x*10.0, uv.y*3.0) + h1, vec2(10.0, 3.0));
  float knot = smoothstep(0.17, 0.05, w.x) * step(0.8, w.z);
  vec3 base = mix(vec3(0.085,0.048,0.026), vec3(0.20,0.12,0.062), grain*0.7 + 0.3*fiber);
  base *= 0.7 + 0.6*h1;
  base = mix(base, vec3(0.035,0.02,0.012), knot*0.8) * mix(0.3, 1.0, gap);
  float h = gap*0.003 + (grain-0.5)*0.0008 + (fiber-0.5)*0.0004 - knot*0.001;
  rough = 0.46 + 0.2*grain + 0.12*fiber;
  cav = mix(0.35, 1.0, gap);
  return vec4(base, h);
}` },
  // limewashed plaster of the vault webs — 4 m tile
  plaster: { size: 1024, tile: 4.0, bump: 1.0, code: `
vec4 surf(vec2 uv, out float rough, out float cav){
  uv = fract(uv);
  float big = pfbm(uv*3.0, 3.0, 5), mid = pfbm(uv*12.0+7.0, 12.0, 4), fine = pfbm(uv*90.0, 90.0, 3);
  vec3 w = pworley(uv*5.0, 5.0);
  float crack = smoothstep(0.022, 0.0, w.y-w.x) * smoothstep(0.5, 0.8, pfbm(uv*2.0+4.0, 2.0, 2));
  float trowel = pnoise(vec2(uv.x*10.0, uv.y*60.0) + mid*2.0, vec2(10.0, 60.0));
  float damp = smoothstep(0.5, 0.78, big);
  vec3 colr = mix(vec3(0.50,0.47,0.41), vec3(0.63,0.60,0.53), mid);
  colr = mix(colr, colr*vec3(0.58,0.61,0.55), damp*0.7);
  colr *= (0.93 + 0.14*fine) * (1.0 - crack*0.55);
  float h = (big-0.5)*0.004 + (trowel-0.5)*0.0013 + (fine-0.5)*0.0005 - crack*0.002;
  rough = 0.9; cav = 1.0 - crack*0.5;
  return vec4(colr, h);
}` },
};

function bakeSurfaces(aniso) {
  const out = {};
  for (const [name, d] of Object.entries(SURF)) {
    const size = SHOT && HASH.lowtex ? Math.min(d.size, 512) : d.size;
    const rt = new T.WebGLRenderTarget(size, size, { count: 2, depthBuffer: false, type: T.UnsignedByteType, format: T.RGBAFormat });
    for (const t of rt.textures) {
      t.wrapS = t.wrapT = T.RepeatWrapping; t.generateMipmaps = true;
      t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter; t.anisotropy = aniso;
    }
    const m = fsMat(BAKE_HEAD + d.code + BAKE_MAIN, { uSize: U(size), uTile: U(d.tile), uBump: U(d.bump) });
    fsPass(m, rt);
    m.dispose();
    out[name] = { A: rt.textures[0], B: rt.textures[1], scale: 1 / d.tile };
  }
  // shared tiling noise: r = low fbm, g = mid fbm, b = cellular, a = white
  {
    const rt = new T.WebGLRenderTarget(512, 512, { depthBuffer: false, type: T.UnsignedByteType, format: T.RGBAFormat });
    const t = rt.texture; t.wrapS = t.wrapT = T.RepeatWrapping; t.generateMipmaps = true; t.minFilter = T.LinearMipmapLinearFilter; t.magFilter = T.LinearFilter;
    const m = fsMat(`precision highp float; in vec2 vUv; out vec4 o; ${GLSL_HASH}${GLSL_PNOISE}
      void main(){ o = vec4(pfbm(vUv*4.0, 4.0, 6), pfbm(vUv*8.0+3.3, 8.0, 5), pworley(vUv*12.0, 12.0).x, hash12(floor(vUv*512.0))); }`);
    fsPass(m, rt); m.dispose();
    out.noise = t;
  }
  renderer.setRenderTarget(null);
  return out;
}
