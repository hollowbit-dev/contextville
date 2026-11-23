// The world around the city: island, sea, sky, sun and moon on your real clock, clouds, rain,
// and wild trees on land you haven't bought yet.
import * as THREE from 'three';
import { C } from './catalog.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Builder, meshesFrom } from './models.js';
import { PAL, SEASON, crown, pine } from './season.js';

export const N = 48;          // the island grid is N x N tiles
export const HALF = N / 2;
export const tileToWorld = (i, j) => [i - HALF + 0.5, j - HALF + 0.5];
export const worldToTile = (x, z) => [Math.floor(x + HALF), Math.floor(z + HALF)];
export const inLand = (i, j, R) => i >= HALF - R && i < HALF + R && j >= HALF - R && j < HALF + R;

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// A soft grass texture: mottled tones and little blades, so land never reads as a flat square.
function grassTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'); const r = seeded(3);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 70; k++) { const x = r() * S, y = r() * S, rad = 20 + r() * 60; const gr = g.createRadialGradient(x, y, 0, x, y, rad); const v = r() < 0.5 ? 'rgba(200,215,170,' : 'rgba(255,250,225,'; gr.addColorStop(0, v + '0.35)'); gr.addColorStop(1, v + '0)'); g.fillStyle = gr; for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); } }
  for (let k = 0; k < 2600; k++) { const x = r() * S, y = r() * S; g.strokeStyle = r() < 0.5 ? 'rgba(120,150,95,0.22)' : 'rgba(255,255,235,0.25)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

export function makeWorld(scene) {
  const W = {};
  const grassTex = grassTexture();
  // ---- sky dome ----
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color('#7fb0e0') }, mid: { value: new THREE.Color('#cfe2f0') }, bot: { value: new THREE.Color('#f3e6d4') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, bot, smoothstep(0.0, -0.3, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat); scene.add(sky);
  // stars
  const sg = new THREE.BufferGeometry(); const sp = [];
  const rs = seeded(9); for (let i = 0; i < 900; i++) { const th = rs() * Math.PI * 2, ph = Math.acos(rs() * 0.95); const r = 380; sp.push(r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  scene.add(new THREE.Points(sg, starMat));
  scene.fog = new THREE.Fog('#e9dccb', 55, 175);

  // ---- light ----
  const hemi = new THREE.HemisphereLight('#e6eeff', '#b89670', 1.3); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe6c4', 2.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 200;
  sun.shadow.bias = -0.0009; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2;
  const sunDir = new THREE.Vector3();
  scene.add(sun, sun.target);
  const moonLight = new THREE.DirectionalLight('#a8b0f0', 0); moonLight.position.set(-30, 50, -20); scene.add(moonLight);
  // sun and moon discs
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), new THREE.MeshBasicMaterial({ color: '#fff3d0', fog: false, toneMapped: false, transparent: true }));
  const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: '#eef0ff', fog: false, toneMapped: false, transparent: true }));
  scene.add(sunDisc, moonDisc);

  // ---- sea, beach, island ----
  // the sea: turquoise shallows by the beach fading to deep blue further out
  const seaMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55, metalness: 0.0 });
  const seaTime = { value: 0 }, seaNight = { value: 0 }, seaScale = { value: 1 };
  seaMat.onBeforeCompile = (sh) => {
    sh.uniforms.uSeaT = seaTime; sh.uniforms.uSeaNight = seaNight; sh.uniforms.uSeaS = seaScale;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSeaXZ;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeaXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    // two drifting ripple layers, with small glints that fade out towards the horizon
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vSeaXZ; uniform float uSeaT; uniform float uSeaNight; uniform float uSeaS;').replace('#include <color_fragment>', `#include <color_fragment>
      float seaR = length(vSeaXZ);
      vec2 sq = vSeaXZ * 0.62;
      float rip = sin(sq.x * 1.1 + sq.y * 0.7 + uSeaT * 0.8 + sin(sq.y * 0.5 + uSeaT * 0.3) * 1.6) * sin(sq.y * 1.3 - sq.x * 0.4 - uSeaT * 0.62 + sin(sq.x * 0.6) * 1.3);
      float fadeR = 1.0 - smoothstep(55.0 * uSeaS, 130.0 * uSeaS, seaR);
      diffuseColor.rgb *= mix(vec3(0.40, 0.76, 0.78), vec3(0.20, 0.44, 0.62), smoothstep(39.0 * uSeaS, 70.0 * uSeaS, seaR));
      diffuseColor.rgb *= 1.0 + rip * 0.075 * fadeR;
      diffuseColor.rgb += vec3(0.34, 0.36, 0.34) * smoothstep(0.82, 0.98, rip) * fadeR * 0.42 * (1.0 - uSeaNight * 0.86);`);
  };
  const sea = new THREE.Mesh(new THREE.CircleGeometry(420, 64), seaMat);
  sea.rotation.x = -Math.PI / 2; sea.position.y = -0.55; sea.receiveShadow = true; scene.add(sea);
  // foam: soft bands rolling in to the beach
  const foamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { t: { value: 0 }, dim: { value: 1 } },
    vertexShader: 'varying float vR; void main(){ vR = length(position.xy); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float t; uniform float dim; varying float vR; void main(){ float d = (vR - 38.35) / 4.0; float w = sin(d * 22.0 + t * 1.1) * 0.5 + 0.5; float a = smoothstep(0.82, 1.0, w) * (1.0 - d) * 0.45 + (1.0 - smoothstep(0.0, 0.06, d)) * 0.75; gl_FragColor = vec4(vec3(0.97, 0.98, 0.96) * dim, a * clamp(1.0 - d, 0.0, 1.0) * (0.4 + 0.6 * dim)); }',
  });
  const shimmer = new THREE.Mesh(new THREE.RingGeometry(38.3, 42.3, 96, 1), foamMat);
  shimmer.rotation.x = -Math.PI / 2; shimmer.position.y = -0.52; scene.add(shimmer);
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(37.5, 38.5, 0.7, 72), new THREE.MeshStandardMaterial({ color: '#e8d6b0', roughness: 1 }));
  beach.position.y = -0.55; beach.receiveShadow = true; scene.add(beach);
  // rocks along the shore
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: '#a49a8e', roughness: 1, flatShading: true }), 300);
  rocks.castShadow = rocks.receiveShadow = true; scene.add(rocks);
  function placeRocks(sc) {
    const rkr = seeded(77 + Math.round(sc * 10)), M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc3 = new THREE.Vector3(), p3 = new THREE.Vector3(); let n = 0;
    for (let k = 0, all = Math.min(300, Math.round(90 * sc)); k < all; k++) { const a = rkr() * Math.PI * 2; if (Math.abs(a - Math.PI / 2) < 0.12 / sc) continue; const r = 37.8 * sc + rkr() * 1.6, s = 0.3 + rkr() * rkr() * 1.3; e.set(rkr() * 3, rkr() * 3, rkr() * 3); q.setFromEuler(e); sc3.set(s, s * 0.6, s); p3.set(Math.cos(a) * r, -0.4, Math.sin(a) * r); M.compose(p3, q, sc3); rocks.setMatrixAt(n++, M); }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true;
  }
  placeRocks(1);
  // a wooden pier on the south shore, with boats
  const pier = new Builder();
  for (let k = 0; k < 9; k++) { pier.box(0, -0.2, 36.8 + k * 0.85, 1.0, 0.06, 0.8, k % 2 ? '#a8805c' : '#9a7350'); for (const sx of [-0.45, 0.45]) pier.cyl(sx, -0.75, 36.8 + k * 0.85, 0.05, 0.05, 0.6, '#6e5038', 6); }
  pier.box(-0.47, -0.14, 40.2, 0.04, 0.2, 6.8, '#6e5038'); pier.box(0.47, -0.14, 40.2, 0.04, 0.2, 6.8, '#6e5038');
  pier.cyl(0.4, -0.14, 43.6, 0.015, 0.015, 0.5, '#4b4542', 5); pier.ball(0.4, 0.38, 43.6, 0.045, '#ffd894', { glow: true }); pier.mark('lamp', 0.4, 0.38, 43.6);
  const pierG = meshesFrom(pier.build()); pierG.position.x = 5.5; scene.add(pierG);
  W.pierLamp = new THREE.Vector3(5.9, -0.15, 43.6);
  const boatModel = (hull, sail) => { const b = new Builder(); b.box(0, 0, 0, 0.9, 0.18, 0.34, hull); b.box(0, 0.18, 0, 0.8, 0.03, 0.3, '#c7a37a'); b.box(-0.15, 0.2, 0, 0.3, 0.14, 0.22, '#fbf5ea'); if (sail) { b.cyl(0.1, 0.2, 0, 0.012, 0.012, 1.0, '#6e5038', 4); const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.45, 0); s.lineTo(0, 0.85); s.closePath(); b.add('solid', new THREE.ShapeGeometry(s), sail, 0.12, 0.3, 0); const s2 = new THREE.Shape(); s2.moveTo(0, 0); s2.lineTo(-0.45, 0); s2.lineTo(0, 0.85); s2.closePath(); b.add('solid', new THREE.ShapeGeometry(s2), sail, 0.12, 0.3, 0, Math.PI); } return meshesFrom(b.build()); };
  const boats = [];
  [[4.2, 41.5, 0.3, '#d9785a', null], [7.0, 42.6, -0.2, '#9cc0dc', null], [3.8, 44.2, 1.3, '#fbf5ea', '#fbf5ea']].forEach(([x, z, ry, hull, sail], k) => { const g = boatModel(hull, sail); g.position.set(x, -0.55, z); g.rotation.y = ry; scene.add(g); boats.push({ g, a: 0, v: 0, r: 0, ry, ph: k * 2 }); });
  [[52, 0.02, '#fbf5ea', '#eca8b0'], [64, -0.015, '#d9785a', '#fbf5ea']].forEach(([r, v, hull, sail], k) => { const g = boatModel(hull, sail); g.scale.setScalar(1.4); scene.add(g); boats.push({ g, a: k * 3, v, r, ph: k + 5 }); });
  // a little lighthouse on a rocky islet offshore
  const isle = new Builder();
  for (let k = 0; k < 9; k++) { const a = k * 0.7; isle.ball(Math.cos(a) * 1.4, -0.4, Math.sin(a) * 1.4, 0.8 + (k % 3) * 0.25, '#a49a8e'); }
  isle.cyl(0, -0.3, 0, 1.4, 1.7, 0.4, '#b8ad9e', 9);
  for (let i = 0; i < 5; i++) isle.cyl(0, 0.1 + i * 0.6, 0, 0.42 - i * 0.04, 0.44 - i * 0.04, 0.6, i % 2 ? '#d9785a' : '#fbf5ea', 12);
  isle.cyl(0, 3.1, 0, 0.26, 0.26, 0.3, '#fff4c8', 10, { glow: true }); isle.cone(0, 3.4, 0, 0.34, 0.4, '#4b4542', 10);
  const isleG = meshesFrom(isle.build()); isleG.position.set(-47, -0.3, 30); scene.add(isleG);
  const beamG = new THREE.ConeGeometry(1.4, 12, 16, 1, true); beamG.translate(0, -6, 0); beamG.rotateZ(Math.PI / 2);
  const beam = new THREE.Mesh(beamG, new THREE.MeshBasicMaterial({ color: '#fff1c0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); beam.position.set(-47, 2.95, 30); scene.add(beam);
  const cliffTex = grassTex.clone(); cliffTex.repeat.set(18, 18); cliffTex.needsUpdate = true;
  const cliff = new THREE.Mesh(new THREE.CylinderGeometry(35.5, 36.5, 0.9, 72), [new THREE.MeshStandardMaterial({ color: '#a08a6a', roughness: 1 }), new THREE.MeshStandardMaterial({ color: PAL.wild, map: cliffTex, roughness: 1 }), new THREE.MeshStandardMaterial({ color: '#a08a6a' })]);
  cliff.position.y = -0.453; // the grass is level with the base of every building, so nothing hovers
  cliff.receiveShadow = true; scene.add(cliff);
  // owned land is a slightly lighter, mown square; rebuilt when you buy more
  const landTex = grassTex.clone(); landTex.needsUpdate = true;
  const landMat = new THREE.MeshStandardMaterial({ color: PAL.grass, map: landTex, roughness: 1 });
  W.land = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), landMat); W.land.rotation.x = -Math.PI / 2; W.land.position.y = -0.015; W.land.receiveShadow = true; scene.add(W.land);
  const edgeMat = new THREE.LineDashedMaterial({ color: '#fffaf0', dashSize: 0.25, gapSize: 0.35, transparent: true, opacity: 0.4 });
  W.edge = new THREE.LineLoop(new THREE.BufferGeometry(), edgeMat); W.edge.position.y = 0.01; W.edge.visible = false; scene.add(W.edge);
  // build-mode grid
  W.grid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 })); W.grid.position.y = 0.006; W.grid.visible = false; scene.add(W.grid);

  // ---- wild nature on unowned land ----
  const wild = [];
  function growWild(sc) {
  const rw = seeded(42 + Math.round((sc - 1) * 100)); wild.length = 0;
  for (let k = 0, all = Math.min(1700, Math.round(900 * Math.pow(sc, 1.2))); k < all; k++) {
    const a = rw() * Math.PI * 2, r = Math.sqrt(rw()) * 34.5 * sc;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    wild.push({ x, z, s: 0.6 + rw() * 0.9, pine: rw() < 0.35, rot: rw() * 6 });
  }
  }
  growWild(1);
  const trunkG = new THREE.CylinderGeometry(0.05, 0.07, 0.35, 5); trunkG.translate(0, 0.175, 0);
  const crownG = new THREE.IcosahedronGeometry(0.32, 0); crownG.translate(0, 0.55, 0);
  const pineG = new THREE.ConeGeometry(0.3, 0.85, 7); pineG.translate(0, 0.7, 0);
  const mk = (g, col, n) => { const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.9 }), n); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  crownG.dispose(); const puff = (r, d, x, y, z) => new THREE.IcosahedronGeometry(r, d).translate(x, y, z);
  const crownG2 = mergeGeometries([puff(0.29, 2, 0, 0.56, 0), puff(0.19, 1, 0.17, 0.47, 0.08), puff(0.18, 1, -0.14, 0.5, -0.11), puff(0.16, 1, 0.02, 0.76, 0.03)]);
  const trunks = mk(trunkG, C.wood, 1700), crowns = mk(crownG2, '#ffffff', 1700), pines = mk(pineG, '#ffffff', 1700);
  const tc = new THREE.Color();
  let occupied = null;
  const liveTrees = []; W.liveTrees = () => liveTrees;
  W.setOccupied = (grid) => { occupied = grid; W.updateWild(W.R); };
  W.updateWild = (R) => {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let nt = 0, nc = 0, np = 0; liveTrees.length = 0;
    for (const t of wild) {
      // trees stay until something is built on their spot, so empty land is never a bare square
      if (occupied && [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]].some(([a, b]) => occupied.has(`${Math.floor(t.x + a + HALF)},${Math.floor(t.z + b + HALF)}`))) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot); s.setScalar(t.s); p.set(t.x, 0, t.z); M.compose(p, q, s);
      trunks.setMatrixAt(nt++, M); liveTrees.push(t);
      if (t.pine) { pines.setColorAt(np, tc.set(pine(t.rot % 1))); pines.setMatrixAt(np++, M); } else { crowns.setColorAt(nc, tc.set(crown((t.rot * 3.7) % 1))); crowns.setMatrixAt(nc++, M); }
    }
    trunks.count = nt; crowns.count = nc; pines.count = np;
    trunks.instanceMatrix.needsUpdate = crowns.instanceMatrix.needsUpdate = pines.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true; if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
  };
  W.setLand = (R) => {
    W.R = R; W.land.visible = false; W.land.scale.set(R * 2, R * 2, 1); landTex.repeat.set(R / 2, R / 2);
    const pts = [new THREE.Vector3(-R, 0, -R), new THREE.Vector3(R, 0, -R), new THREE.Vector3(R, 0, R), new THREE.Vector3(-R, 0, R)];
    W.edge.geometry.dispose(); W.edge.geometry = new THREE.BufferGeometry().setFromPoints(pts); W.edge.computeLineDistances();
    const gp = [];
    for (let k = -R; k <= R; k++) { gp.push(-R, 0, k, R, 0, k, k, 0, -R, k, 0, R); }
    W.grid.geometry.dispose(); W.grid.geometry = new THREE.BufferGeometry(); W.grid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    W.updateWild(R);
  };

  // ---- clouds ----
  const clouds = new THREE.Group(); scene.add(clouds);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.92 });
  const rc = seeded(5);
  for (let k = 0; k < 12; k++) {
    const g = new THREE.Group();
    for (let i = 0; i < 4 + Math.floor(rc() * 4); i++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + rc() * 1.4, 2), cloudMat); m.position.set(i * 1.5 - 3, rc() * 0.8, rc() * 1.6 - 0.8); m.castShadow = true; g.add(m); }
    g.position.set(rc() * 120 - 60, 16 + rc() * 8, rc() * 120 - 60); g.userData.v = 0.3 + rc() * 0.5;
    clouds.add(g);
  }

  // ---- rain ----
  const RN = 2400, rg = new THREE.BufferGeometry(), rp = new Float32Array(RN * 6);
  const rr = seeded(11);
  for (let i = 0; i < RN; i++) { const x = rr() * 70 - 35, y = rr() * 30, z = rr() * 70 - 35; rp.set(SEASON === 'winter' ? [x, y, z, x - 0.02, y - 0.07, z] : [x, y, z, x - 0.05, y - 0.5, z], i * 6); }
  rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: SEASON === 'winter' ? '#ffffff' : '#c8d8ec', transparent: true, opacity: 0 })); scene.add(rain);
  W.rainAmount = 0; let rainTarget = 0, rainTimer = 60;
  W.forceRain = (v) => { rainTarget = v; W.rainAmount = v; rainTimer = 999; };

  // ---- time of day ----
  // Keyframes by hour: sky top/mid/bottom, fog, sun colour/intensity, hemisphere, window glow
  const K = [
    [0, '#1a1f45', '#3a3c72', '#4a3a62', '#33355f', '#7080c0', 0, 0.5, 1.0],
    [5, '#2a2f60', '#7a6a9a', '#f0b494', '#857a9e', '#ffb37a', 0.4, 0.6, 0.85],
    [7, '#8eb4dc', '#f6d9c4', '#fbe2c8', '#f0dccb', '#ffd2a0', 1.7, 1.0, 0.2],
    [10, '#88b8e4', '#d8e8f2', '#f7ead8', '#e6e4dc', '#ffe8c8', 2.5, 1.25, 0],
    [15, '#86b4e0', '#dfe9ef', '#f7e6d0', '#ebe2d4', '#ffe2b8', 2.4, 1.2, 0],
    [17.5, '#7c9ed0', '#f7cfa8', '#f8c49a', '#f2d2b4', '#ffc080', 2.0, 1.0, 0.15],
    [19, '#5a68a8', '#f2a888', '#f09a7a', '#d9a49a', '#ff9058', 1.0, 0.8, 0.55],
    [20.3, '#2e3270', '#7a5a92', '#c07a8a', '#6a5a86', '#ff8060', 0.2, 0.8, 0.9],
    [21.5, '#1c2250', '#3c3f78', '#4e3c66', '#363a66', '#7080c0', 0, 0.5, 1.0],
    [24, '#1a1f45', '#3a3c72', '#4a3a62', '#33355f', '#7080c0', 0, 0.5, 1.0],
  ];
  const ca = new THREE.Color(), cb = new THREE.Color();
  const lerpC = (a, b, t) => ca.set(a).lerp(cb.set(b), t).clone();
  W.night = 0;
  W.setTime = (h) => {
    W.hour = h;
    let k = 0; while (k < K.length - 2 && h >= K[k + 1][0]) k++;
    const A = K[k], B = K[k + 1], t = (h - A[0]) / (B[0] - A[0]);
    skyMat.uniforms.top.value = lerpC(A[1], B[1], t); skyMat.uniforms.mid.value = lerpC(A[2], B[2], t); skyMat.uniforms.bot.value = lerpC(A[3], B[3], t);
    scene.fog.color = lerpC(A[4], B[4], t);
    sun.color = lerpC(A[5], B[5], t);
    sun.intensity = A[6] + (B[6] - A[6]) * t;
    hemi.intensity = A[7] + (B[7] - A[7]) * t;
    W.night = A[8] + (B[8] - A[8]) * t;
    starMat.opacity = Math.max(0, W.night - 0.4) * 1.4;
    moonLight.intensity = W.night * 1.35; hemi.intensity += W.night * 0.42;
    hemi.color.set(W.night > 0.5 ? '#b4a8e0' : '#e6eeff'); hemi.groundColor.set(W.night > 0.5 ? '#7a5a60' : '#b89670');
    // the sun travels east to west from 6:00 to 20:00
    const sa = ((h - 6) / 14) * Math.PI;
    const sx = Math.cos(sa) * 70, sy = Math.sin(sa) * 60, sz = -25;
    sunDir.set(sx, Math.max(sy, 20), sz).normalize(); // a low sun would streak the flat grass with shadow bands
    sunDisc.position.set(sx * 4, sy * 4, sz * 4); sunDisc.lookAt(0, 0, 0); sunDisc.material.opacity = sy > -8 ? 1 : 0;
    const ma = ((h - 18) / 14) * Math.PI;
    moonDisc.position.set(Math.cos(ma) * 280, Math.sin(ma) * 240, 120); moonDisc.lookAt(0, 0, 0); moonDisc.material.opacity = Math.min(1, W.night * 1.2);
  };

  const dayGrass = new THREE.Color(PAL.grass), dayWild = new THREE.Color(PAL.wild), nightGrass = new THREE.Color(PAL.snow ? '#8c96b8' : '#55648a');
  W.update = (dt, camPos, target, dist = 30) => {
    // grass cools to blue-violet after dark, so night reads calm instead of muddy
    landMat.color.copy(dayGrass).lerp(nightGrass, W.night * 0.55); cliff.material[1].color.copy(dayWild).lerp(nightGrass, W.night * 0.55);
    // keep the sun's shadow box tight around what you're looking at: crisper, softer shadows
    if (target) {
      const half = Math.max(9, Math.min(36 * W.scale, dist * 0.9));
      if (Math.abs(sc.right - half) > 0.5) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
      const texel = (half * 2) / 2048; // snap to texels so shadows don't shimmer while panning
      const tx = Math.round(target.x / texel) * texel, tz = Math.round(target.z / texel) * texel;
      sun.target.position.set(tx, 0, tz); sun.position.set(tx + sunDir.x * 90, sunDir.y * 90, tz + sunDir.z * 90);
    }
    for (const c of clouds.children) { c.position.x += c.userData.v * dt; if (c.position.x > 70 * W.scale) c.position.x = -70 * W.scale; }
    sky.position.copy(camPos);
    foamMat.uniforms.t.value += dt; foamMat.uniforms.dim.value = 1 - W.night * 0.75; seaTime.value += dt; seaNight.value = W.night;
    for (const bt of boats) { bt.a += dt * bt.v; if (bt.r) bt.g.position.set(Math.cos(bt.a) * bt.r, -0.55, Math.sin(bt.a) * bt.r); bt.g.rotation.y = bt.r ? -bt.a : bt.ry; bt.g.position.y = -0.55 + Math.sin(foamMat.uniforms.t.value * 1.3 + bt.ph) * 0.04; bt.g.rotation.z = Math.sin(foamMat.uniforms.t.value * 0.9 + bt.ph) * 0.05; }
    beam.rotation.y += dt * 0.7; beam.material.opacity = W.night * 0.2;
    // morning sea mist, and greyer air in the rain
    // the haze starts beyond what you're looking at, so it softens the horizon and never the city
    const mist = Math.min(1, Math.max(0, 1 - Math.abs((W.hour ?? 12) - 6.8) / 2.2) * 0.8 + W.rainAmount * 0.35);
    scene.fog.near = dist + 42 - mist * 14; scene.fog.far = dist + 200 - mist * 85;
    sun.intensity *= 1 - W.rainAmount * 0.45;
    // occasional showers
    rainTimer -= dt;
    if (rainTimer <= 0) { rainTarget = rainTarget > 0 ? 0 : (Math.random() < 0.35 ? 0.6 + Math.random() * 0.4 : 0); rainTimer = rainTarget ? 40 + Math.random() * 60 : 120 + Math.random() * 240; }
    W.rainAmount += (rainTarget - W.rainAmount) * dt * 0.2;
    rain.material.opacity = W.rainAmount * (SEASON === 'winter' ? 0.9 : 0.7); rain.visible = W.rainAmount > 0.02;
    if (rain.visible) {
      const a = rg.attributes.position.array, fall = dt * (SEASON === 'winter' ? 2.4 : 22);
      for (let i = 0; i < RN; i++) { const o = i * 6; a[o + 1] -= fall; a[o + 4] -= fall; if (a[o + 4] < 0) { a[o + 1] += 30; a[o + 4] += 30; } }
      rg.attributes.position.needsUpdate = true;
      rain.position.set(target ? target.x : 0, 0, target ? target.z : 0);
    }
    cloudMat.color.setScalar(1 - W.rainAmount * 0.35 - W.night * 0.5);
  };
  // Later islands are bigger: the shore, sea, wild trees, pier and lighthouse all move out to fit.
  W.radius = 36; W.scale = 1;
  W.setIsland = (radius) => {
    if (radius === W.radius) return;
    const sc = radius / 36, d = radius - 36; W.radius = radius; W.scale = sc; seaScale.value = sc;
    cliff.scale.set(sc, 1, sc); beach.scale.set(sc, 1, sc); shimmer.scale.set(sc, sc, 1); cliffTex.repeat.set(18 * sc, 18 * sc);
    placeRocks(sc); growWild(sc); pierG.position.z = d; W.pierLamp.z = 43.6 + d; isleG.position.set(-47 * sc, -0.3, 30 * sc); beam.position.set(-47 * sc, 2.95, 30 * sc);
    for (const bt of boats) { if (bt.r) { bt.r0 ??= bt.r; bt.r = bt.r0 + d; } else { bt.z0 ??= bt.g.position.z; bt.g.position.z = bt.z0 + d; } }
  };
  W.sun = sun; W.hemi = hemi;
  return W;
}
