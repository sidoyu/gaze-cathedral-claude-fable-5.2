// Shadow maps, rendered by hand:
//   · moon: orthographic depth + a colour "cookie" of the stained glass it passes through
//   · crypt: one perspective map looking out through the door
//   · candle clusters: cube maps laid out as 6 faces × N lights in one atlas, with linear distance for penumbra search
const MOON_DIR = V3(0.58, 0.76, -0.24).normalize();           // toward the moon: low in the south, raking across the nave
const NPL = 5, PL_NEAR = 0.05, PL_FAR = 46, PL_GUARD = 1.03;
const Shadows = {
  init(q) {
    this.q = q;
    // moon depth
    const ms = q.moonRes;
    this.moonRT = new T.WebGLRenderTarget(ms, ms, { format: T.RedFormat, type: T.UnsignedByteType, depthBuffer: true });
    const md = this.moonRT.depthTexture = new T.DepthTexture(ms, ms, T.UnsignedIntType);
    md.compareFunction = T.LessEqualCompare; md.magFilter = md.minFilter = T.LinearFilter;
    // cookie
    const cs = q.cookieRes;
    this.cookieRT = new T.WebGLRenderTarget(cs, cs, { format: T.RGBAFormat, type: T.UnsignedByteType, depthBuffer: true });
    const ct = this.cookieRT.texture; ct.generateMipmaps = true; ct.minFilter = T.LinearMipmapLinearFilter; ct.magFilter = T.LinearFilter;
    // moon camera fitted to the building
    const cam = this.moonCam = new T.OrthographicCamera(-1, 1, 1, -1, 1, 200);
    const c = V3(0, 6, -1);
    cam.position.copy(c).addScaledVector(MOON_DIR, 70); cam.up.set(0, 1, 0); cam.lookAt(c); cam.updateMatrixWorld(true);
    const lo = V3(1e9, 1e9, 1e9), hi = V3(-1e9, -1e9, -1e9), v = V3();
    for (const x of [-10.2, 10.2]) for (const y of [-4.9, 18.2]) for (const z of [-18.2, 19.2]) { v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse); lo.min(v); hi.max(v); }
    cam.left = lo.x; cam.right = hi.x; cam.bottom = lo.y; cam.top = hi.y; cam.near = -hi.z - 1; cam.far = -lo.z + 1;
    cam.updateProjectionMatrix();
    this.moonMat = new T.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    const span = Math.max(hi.x - lo.x, hi.y - lo.y);
    this.moonP = new T.Vector4(1 / ms, cam.far - cam.near, span / cs, span / ms);
    // crypt
    this.cryptRT = new T.WebGLRenderTarget(q.cryptRes, Math.round(q.cryptRes * 1.25), { format: T.RedFormat, type: T.UnsignedByteType, depthBuffer: true });
    const cd = this.cryptRT.depthTexture = new T.DepthTexture(q.cryptRes, Math.round(q.cryptRes * 1.25), T.UnsignedIntType);
    cd.compareFunction = T.LessEqualCompare; cd.magFilter = cd.minFilter = T.LinearFilter;
    this.cryptCam = new T.PerspectiveCamera(86, 0.8, 0.25, 50);
    this.cryptMat = new T.Matrix4();
    this.cryptPos = V3();
    // point-light atlas
    const S = this.S = q.pointRes;
    this.plRT = new T.WebGLRenderTarget(S * 6, S * NPL, { format: T.RedFormat, type: T.HalfFloatType, depthBuffer: true, minFilter: T.NearestFilter, magFilter: T.NearestFilter });
    const pd = this.plRT.depthTexture = new T.DepthTexture(S * 6, S * NPL, T.UnsignedIntType);
    pd.compareFunction = T.LessEqualCompare; pd.magFilter = pd.minFilter = T.LinearFilter;
    this.faceCams = [[1, 0, 0, 0, 1, 0], [-1, 0, 0, 0, 1, 0], [0, 1, 0, 0, 0, 1], [0, -1, 0, 0, 0, 1], [0, 0, 1, 0, 1, 0], [0, 0, -1, 0, 1, 0]].map(f => {
      const c2 = new T.PerspectiveCamera(2 * Math.atan(PL_GUARD) / DEG, 1, PL_NEAR, PL_FAR);
      c2.userData.F = V3(f[0], f[1], f[2]); c2.up.set(f[3], f[4], f[5]);
      return c2;
    });
    this.dirty = { moon: true, crypt: true, pl: new Array(NPL).fill(true) };
    this.rr = 0;
  },
  renderMoon() {
    const r = renderer;
    World.setPass('depth');
    r.setRenderTarget(this.moonRT); r.setClearColor(0x000000, 1); r.clear(true, true, false);
    r.render(World.scene, this.moonCam);
    World.setPass('cookie');
    r.setRenderTarget(this.cookieRT); r.setClearColor(0x000000, 0); r.clear(true, true, false);
    r.render(World.scene, this.moonCam);
    this.dirty.moon = false;
  },
  renderCrypt(pos) {
    const r = renderer, cam = this.cryptCam;
    this.cryptPos.copy(pos);
    cam.position.copy(pos); cam.up.set(0, 1, 0); cam.lookAt(pos.x, pos.y + 0.25, pos.z + 1); cam.updateMatrixWorld(true);
    this.cryptMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    World.setPass('depth');
    r.setRenderTarget(this.cryptRT); r.setClearColor(0x000000, 1); r.clear(true, true, false);
    r.render(World.scene, cam);
    this.dirty.crypt = false;
  },
  renderPoint(i, pos) {
    const r = renderer, S = this.S, rt = this.plRT;
    World.setPass('point');
    for (const m of [MAT.shared.dist, MAT.shared.distI]) { m.uniforms.uLPos.value.copy(pos); m.uniforms.uInvFar.value = 1 / PL_FAR; }
    r.setClearColor(0xffffff, 1);
    for (let f = 0; f < 6; f++) {
      const cam = this.faceCams[f];
      cam.position.copy(pos); cam.lookAt(pos.x + cam.userData.F.x, pos.y + cam.userData.F.y, pos.z + cam.userData.F.z); cam.updateMatrixWorld(true);
      rt.viewport.set(f * S, i * S, S, S); rt.scissor.set(f * S, i * S, S, S); rt.scissorTest = true;
      r.setRenderTarget(rt); r.clear(true, true, false);
      r.render(World.scene, cam);
    }
    this.dirty.pl[i] = false;
  },
};
