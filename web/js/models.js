// Low-poly models built from simple shapes. A Builder collects parts into three groups:
//   solid: plain vertex-coloured surfaces
//   win:   walls with windows (a tiling texture whose lit windows glow at night)
//   glow:  always-bright things (signs, lamps, the spark)
// Each group is merged into one geometry, so a whole city costs only a few draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
const COL = new THREE.Color(), tmpBox = new THREE.Box3();

function prep(geo, color) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3); COL.set(color);
  for (let i = 0; i < n; i++) { c[i * 3] = COL.r; c[i * 3 + 1] = COL.g; c[i * 3 + 2] = COL.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

export class Builder {
  constructor() { this.parts = { solid: [], win: [], glow: [] }; this.marks = []; this.windows = []; }
  // remember a point (chimney smoke, lamp light) so the city can bring it to life
  mark(kind, x, y, z, a = 0) { this.marks.push({ kind, x, y, z, a }); return this; }
  // a flat shape (THREE.Shape in x/z, y up) extruded h tall, standing on y
  slab(shape, y, h, color, x = 0, z = 0, ry = 0) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
    g.rotateX(Math.PI / 2); g.translate(0, y + h, 0);
    this.add('solid', g, color, x, 0, z, ry); return this;
  }
  add(kind, geo, color, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) {
    tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
    const g = geo.clone(); g.applyMatrix4(tmpM);
    this.parts[kind].push({ g, color, win: kind === 'win' });
    return this;
  }
  // a box standing on y (its bottom), centred on x/z
  box(x, y, z, w, h, d, color, o = {}) {
    const kind = o.glow ? 'glow' : 'solid';
    this.add(kind, new THREE.BoxGeometry(w, h, d), color, x, y + h / 2, z, o.ry || 0);
    if (o.windows) this.facade(this.parts[kind][this.parts[kind].length - 1], x, y, z, w, h, d, o);
    if (o.windows && o.roof !== false) this.add('solid', new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), o.roof || shade(color, -0.25), x, y + h + 0.025, z, o.ry || 0);
    return this;
  }
  cyl(x, y, z, r1, r2, h, color, seg = 10, o = {}) { this.add(o.glow ? 'glow' : 'solid', new THREE.CylinderGeometry(r1, r2, h, seg), color, x, y + h / 2, z, o.ry || 0); return this; }
  cone(x, y, z, r, h, color, seg = 8, o = {}) { this.add(o.glow ? 'glow' : 'solid', new THREE.ConeGeometry(r, h, seg), color, x, y + h / 2, z, o.ry || 0); return this; }
  ball(x, y, z, r, color, o = {}) { this.add(o.glow ? 'glow' : 'solid', new THREE.IcosahedronGeometry(r, o.detail ?? 0), color, x, y, z); return this; }
  // gable roof: a triangular prism along x
  gable(x, y, z, w, h, d, color, ry = 0) {
    const s = new THREE.Shape(); s.moveTo(-d / 2, 0); s.lineTo(d / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
    this.add('solid', g, color, x, y, z, ry); return this;
  }
  // Real, whole windows centred on each wall. Anything standing in front of one removes it.
  facade(wall, x, y, z, w, h, d, o) {
    const fh = o.floorH || 0.36, pitch = o.pitch || 0.3, floors = Math.max(1, Math.round(h / fh)), real = h / floors;
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const span = nx ? d : w, cols = Math.max(1, Math.floor((span - 0.08) / pitch)), step = span / cols;
      const ww = Math.min(o.winW || 0.13, step * 0.62), wh = Math.min(o.winH || 0.19, real * 0.56);
      for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
        const u = -span / 2 + step * (c + 0.5);
        this.windows.push({ wall, x: x + (nx ? nx * w / 2 : u), y: y + real * (f + 0.54), z: z + (nz ? nz * d / 2 : u), nx, nz, ww, wh, frame: o.frame || '#fbf5ea' });
      }
    }
  }
  top() { let t = 0; for (const k of ['solid', 'glow']) for (const p of this.parts[k]) { p.g.computeBoundingBox(); t = Math.max(t, p.g.boundingBox.max.y); } return t; }
  placeWindows() {
    const blockers = [];
    for (const k of ['solid', 'glow']) for (const p of this.parts[k]) { p.g.computeBoundingBox(); blockers.push({ p, b: p.g.boundingBox.clone().expandByScalar(0.012) }); }
    for (const w of this.windows) {
      let hidden = false;
      for (const out of [0.012, 0.06, 0.12]) { tmpV.set(w.x + w.nx * out, w.y, w.z + w.nz * out); if (blockers.some((x) => x.p !== w.wall && x.b.containsPoint(tmpV))) { hidden = true; break; } }
      // a window that's even partly behind a door, sign or column is left out, so nothing overlaps
      if (!hidden) {
        const hw = w.ww / 2 + 0.024, hh = w.wh / 2 + 0.024, a = 0.002, c = 0.075;
        tmpBox.min.set(w.nx ? Math.min(w.x + w.nx * a, w.x + w.nx * c) : w.x - hw, w.y - hh, w.nz ? Math.min(w.z + w.nz * a, w.z + w.nz * c) : w.z - hw);
        tmpBox.max.set(w.nx ? Math.max(w.x + w.nx * a, w.x + w.nx * c) : w.x + hw, w.y + hh, w.nz ? Math.max(w.z + w.nz * a, w.z + w.nz * c) : w.z + hw);
        hidden = blockers.some((x) => x.p !== w.wall && x.p.g.boundingBox.intersectsBox(tmpBox));
      }
      if (hidden) continue;
      const ry = Math.atan2(w.nx, w.nz), n = Math.abs(Math.sin(w.x * 91.7 + w.y * 47.3 + w.z * 13.1) * 43758.5453) % 1;
      const cell = n < 0.34 ? 0 : n < 0.62 ? 1 : n < 0.84 ? 2 : 3;
      const fr = new THREE.PlaneGeometry(w.ww + 0.035, w.wh + 0.035), gl = new THREE.PlaneGeometry(w.ww, w.wh);
      const uv = gl.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, (cell + 0.06 + uv.getX(i) * 0.88) / 4);
      this.add('solid', fr, w.frame, w.x + w.nx * 0.004, w.y, w.z + w.nz * 0.004, ry);
      this.add('win', gl, '#ffffff', w.x + w.nx * 0.008, w.y, w.z + w.nz * 0.008, ry);
    }
    this.windows = [];
  }
  build() {
    this.placeWindows();
    const out = {};
    for (const k of ['solid', 'win', 'glow']) {
      const list = this.parts[k].map((p) => prep(p.g, p.color));
      out[k] = list.length ? mergeGeometries(list, false) : null;
      for (const g of list) g.dispose();
    }
    // soft contact shading: walls darken gently where they meet the ground, so buildings sit in the scene
    if (out.solid && !this.noContact) {
      const p = out.solid.attributes.position, n = out.solid.attributes.normal, c = out.solid.attributes.color;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(n.getY(i)) > 0.5) continue;
        const u = Math.min(1, Math.max(0, p.getY(i) / 0.34)), k = 0.72 + 0.28 * u * (2 - u);
        c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
      }
    }
    out.marks = this.marks;
    return out;
  }
}

export function shade(hex, amt) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt))); return `#${c.getHexString()}`; }

// ---------- Shared materials ----------
// One small atlas of four window panes: two dark, two lit at night.
function windowTextures() {
  const C = 128, c1 = document.createElement('canvas'), c2 = document.createElement('canvas');
  c1.width = c2.width = C * 4; c1.height = c2.height = C;
  const a = c1.getContext('2d'), b = c2.getContext('2d');
  b.fillStyle = '#000'; b.fillRect(0, 0, C * 4, C);
  for (let k = 0; k < 4; k++) {
    const x = k * C, sky = a.createLinearGradient(0, 0, 0, C); sky.addColorStop(0, '#b9d0df'); sky.addColorStop(1, '#6f8497');
    a.fillStyle = sky; a.fillRect(x, 0, C, C);
    if (k === 1 || k === 3) { a.fillStyle = k === 1 ? '#ecd5bd' : '#e7b9aa'; a.fillRect(x, 0, C * 0.22, C); a.fillRect(x + C * 0.78, 0, C * 0.22, C); }
    if (k === 1 || k === 2) { b.fillStyle = k === 1 ? '#ffb765' : '#ffdca3'; b.fillRect(x, 0, C, C); }
    for (const g of [a, b]) { g.fillStyle = g === a ? '#f6efe2' : '#000'; g.fillRect(x + C / 2 - 4, 0, 8, C); g.fillRect(x, C * 0.42, C, 8); }
  }
  const t1 = new THREE.CanvasTexture(c1), t2 = new THREE.CanvasTexture(c2);
  for (const t of [t1, t2]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; }
  return [t1, t2];
}
let MATS = null;
export function materials() {
  if (MATS) return MATS;
  const [map, emi] = windowTextures();
  MATS = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }),
    win: new THREE.MeshStandardMaterial({ vertexColors: true, map, emissiveMap: emi, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.32 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  };
  return MATS;
}

// Turn a Builder result into meshes (used for the city batches, previews and thumbnails).
export function meshesFrom(built, mats = materials()) {
  const group = new THREE.Group();
  for (const k of ['solid', 'win', 'glow']) if (built[k]) {
    const m = new THREE.Mesh(built[k], mats[k]);
    m.castShadow = k !== 'glow'; m.receiveShadow = k !== 'glow';
    group.add(m);
  }
  return group;
}
