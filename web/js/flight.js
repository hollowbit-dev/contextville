// The flight between islands: take off from your runway, climb through the clouds, cross the
// sea and land on the other island. Both islands are drawn from what you've really built there.
import * as THREE from 'three';
import { Builder, meshesFrom } from './models.js';
import { BY_ID, planeParts } from './catalog.js';
import { footprint } from './city.js';
import { crown } from './season.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const LENGTH = 13;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function seaTexture() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 900; k++) { const x = Math.random() * S, y = Math.random() * S, w = 4 + Math.random() * 18; g.strokeStyle = Math.random() < 0.6 ? 'rgba(255,255,255,0.9)' : 'rgba(150,185,205,0.5)'; g.lineWidth = 1 + Math.random() * 1.5; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 2, x + w, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(70, 70); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const treeGeo = (() => {
  const paint = (g, hex) => { const n = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), a = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv'); return n; };
  return mergeGeometries([paint(new THREE.CylinderGeometry(0.06, 0.09, 0.42, 5).translate(0, 0.21, 0), '#4a3322'), paint(new THREE.IcosahedronGeometry(0.34, 1).translate(0, 0.62, 0), '#ffffff'), paint(new THREE.IcosahedronGeometry(0.21, 1).translate(0.18, 0.5, 0.08), '#ffffff')]);
})();

function islandModel(items, radius, real) {
  const g = new THREE.Group();
  const land = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, 1, 72), new THREE.MeshStandardMaterial({ color: '#8fae62', roughness: 1 })); land.position.y = -0.504; g.add(land);
  const beach = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.05, radius * 1.09, 1, 72), new THREE.MeshStandardMaterial({ color: '#ead6ad', roughness: 1 })); beach.position.y = -0.82; g.add(beach);
  g.add(real);
  // the wild trees around whatever you've built, so a new island isn't a bare disc
  const taken = new Set(); for (const it of items) { const def = BY_ID[it.id]; if (!def) continue; const [w, d] = footprint(def, it.rot); for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) taken.add(`${it.i + a},${it.j + b}`); }
  const count = Math.min(1100, Math.round(radius * radius * 0.3)), trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), count), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0), col = new THREE.Color(); let n = 0;
  for (let k = 0; k < count; k++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * (radius - 1.2), x = Math.cos(a) * r, z = Math.sin(a) * r; if (taken.has(`${Math.floor(x + 24)},${Math.floor(z + 24)}`)) continue; const s = 0.8 + Math.random() * 0.9; Q.setFromAxisAngle(Y, Math.random() * 6); M.compose(V.set(x, 0, z), Q, S.setScalar(s)); trees.setMatrixAt(n, M); trees.setColorAt(n++, col.set(crown(Math.random()))); }
  trees.count = n; g.add(trees);
  return g;
}
// a runway built out over the water, so take-off and landing have a clear view of the island
function runwayDeck(zNear, zFar) {
  const g = new THREE.Group(), len = zNear - zFar, cz = (zNear + zFar) / 2;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6.2, 1.4, len), new THREE.MeshStandardMaterial({ color: '#b9b2a4', roughness: 1 })); deck.position.set(0, -0.68, cz); g.add(deck);
  const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.03, len - 0.5), new THREE.MeshStandardMaterial({ color: '#4d4a48', roughness: 0.9 })); top.position.set(0, 0.035, cz); g.add(top);
  const n = Math.floor(len / 4), dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.01, 1.7), new THREE.MeshBasicMaterial({ color: '#f4efe2' }), n), lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffd894', toneMapped: false }), n * 2), M = new THREE.Matrix4();
  for (let k = 0; k < n; k++) { const z = zNear - 2 - k * 4; dashes.setMatrixAt(k, M.makeTranslation(0, 0.056, z)); lamps.setMatrixAt(k * 2, M.makeTranslation(-2.75, 0.1, z)); lamps.setMatrixAt(k * 2 + 1, M.makeTranslation(2.75, 0.1, z)); }
  g.add(dashes, lamps); return g;
}

export function makeFlight({ canvas, sfx }) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.3, 5000);
  const skyU = { top: { value: new THREE.Color() }, bot: { value: new THREE.Color() } };
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(2400, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU, vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }', fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float vY; void main(){ gl_FragColor = vec4(mix(bot, top, smoothstep(-0.02, 0.45, vY)), 1.0); }' })));
  scene.fog = new THREE.Fog('#cfe2ee', 180, 1200);
  const hemi = new THREE.HemisphereLight('#ffffff', '#8fa8a8', 1.7), sun = new THREE.DirectionalLight('#fff0d8', 2.4); sun.position.set(40, 90, 30); scene.add(hemi, sun);
  const seaTex = seaTexture(), seaMat = new THREE.MeshStandardMaterial({ color: '#3f93a8', map: seaTex, roughness: 0.5 }), sea = new THREE.Mesh(new THREE.CircleGeometry(3200, 48), seaMat); sea.rotation.x = -Math.PI / 2; sea.position.y = -1; scene.add(sea);
  const pb = new Builder(); pb.noContact = true; planeParts(pb, 0, 0, 0, 1); const plane = new THREE.Group(), body = meshesFrom(pb.build()); body.rotation.y = Math.PI / 2; plane.add(body); plane.scale.setScalar(1.7); scene.add(plane);
  const puff = new THREE.IcosahedronGeometry(1, 2), clouds = new THREE.InstancedMesh(puff, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, opacity: 0.86 }), 340); clouds.frustumCulled = false; scene.add(clouds);
  const TR = 70, trailPos = new Float32Array(TR * 3), trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  const trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })(), color: '#ffffff', size: 1.5, transparent: true, opacity: 0.6, depthWrite: false })); trail.frustumCulled = false; scene.add(trail);
  let active = false, t = 0, job = null, stopEngine = null, swapped = false, from = null, to = null, deckA = null, deckB = null, D = 400, trailN = 0;
  const $ = (s) => document.querySelector(s), P = new THREE.Vector3(), Q = new THREE.Vector3(), L = new THREE.Vector3();
  const pathAt = (time, out) => { const u = time / LENGTH, along = u * u * u * (u * (u * 6 - 15) + 10), lift = smooth(0.17, 0.42, u) * (1 - smooth(0.66, 0.9, u)); return out.set(0, 0.06 + lift * 44, 13 - (D + 21) * along); };
  function clearIslands() { for (const g of [from, to, deckA, deckB]) if (g) { scene.remove(g); g.traverse((o) => { if (o.geometry !== treeGeo) o.geometry?.dispose?.(); if (!o.userData.sharedMaterial) o.material?.dispose?.(); }); } from = to = deckA = deckB = null; }
  function finish() {
    if (!active || !job) return; const j = job; job = null; stopEngine?.(); stopEngine = null;
    if (!swapped) { swapped = true; j.onSwap(); }
    $('#fade').classList.add('on');
    setTimeout(() => { active = false; clearIslands(); document.body.classList.remove('flying'); $('#flightCard').hidden = true; j.onDone(); setTimeout(() => $('#fade').classList.remove('on'), 60); }, 220);
  }
  $('#flightSkip').onclick = finish;
  addEventListener('keydown', (e) => { if (active && e.key === 'Escape') finish(); });
  return {
    scene, camera, get active() { return active; }, finish,
    play(o) {
      if (active) return;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { o.onSwap(); o.onDone(); return; }
      D = 150 + o.from.radius + o.to.radius; clearIslands(); const zEnd = -D - 8; from = islandModel(o.from.items, o.from.radius, o.build(o.from.items)); to = islandModel(o.to.items, o.to.radius, o.build(o.to.items)); from.position.z = -(o.from.radius + 11); to.position.z = zEnd - 9 - o.to.radius; deckA = runwayDeck(24, -13); deckB = runwayDeck(zEnd + 30, zEnd - 11); scene.add(from, to, deckA, deckB);
      const n = Math.min(1, o.night * 1.15), dayTop = new THREE.Color('#5f9fdc'), nightTop = new THREE.Color('#141a42'), dayBot = new THREE.Color('#d9ebf2'), nightBot = new THREE.Color('#44407a');
      skyU.top.value.copy(dayTop).lerp(nightTop, n); skyU.bot.value.copy(dayBot).lerp(nightBot, n); scene.fog.color.copy(skyU.bot.value); hemi.intensity = 1.7 - n * 1.05; sun.intensity = 2.4 - n * 2.0; seaMat.color.set('#3f93a8').lerp(new THREE.Color('#1c2f5c'), n);
      const M = new THREE.Matrix4(), V = new THREE.Vector3(), R = new THREE.Quaternion(), S = new THREE.Vector3();
      for (let k = 0; k < 340; k += 4) { const cx = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 70), cy = 36 + Math.random() * 14, cz = 20 - Math.random() * (D + 40); for (let a = 0; a < 4; a++) { const s = 2.2 + Math.random() * 3.6; V.set(cx + (a - 1.5) * 3 + Math.random(), cy + Math.random() * 1.4, cz + Math.random() * 3); S.set(s * 1.25, s * 0.68, s); M.compose(V, R, S); clouds.setMatrixAt(k + a, M); } }
      clouds.instanceMatrix.needsUpdate = true;
      job = o; t = 0; swapped = false; trailN = 0; trailGeo.setDrawRange(0, 0); active = true; document.body.classList.add('flying');
      $('#flightTo').textContent = o.toName; $('#flightSub').textContent = `${o.toSize} tiles`; $('#flightCard').hidden = false;
      stopEngine = sfx.plane?.(LENGTH) || null;
    },
    update(dt) {
      if (!active) return;
      t = Math.min(LENGTH, t + dt); seaTex.offset.x += dt * 0.012; seaTex.offset.y += dt * 0.006;
      pathAt(t, P); pathAt(Math.min(LENGTH, t + 0.05), Q); const dz = P.z - Q.z, dy = Q.y - P.y, u = t / LENGTH;
      plane.position.copy(P); plane.rotation.set(Math.atan2(dy, Math.max(0.03, dz)), 0, Math.sin(t * 0.8) * 0.09 * smooth(0.25, 0.4, u) * (1 - smooth(0.7, 0.85, u)), 'YXZ');
      if (P.y > 3 && job) { trailPos.copyWithin(3, 0, (TR - 1) * 3); trailPos[0] = P.x; trailPos[1] = P.y; trailPos[2] = P.z + 1.4; trailN = Math.min(TR, trailN + 1); trailGeo.setDrawRange(0, trailN); trailGeo.attributes.position.needsUpdate = true; }
      const a = 0.62 * (1 - smooth(0.1, 0.34, u)) + 0.22 * smooth(0.1, 0.34, u) * (1 - smooth(0.68, 0.9, u)) - 0.58 * smooth(0.68, 0.9, u), dist = 7 + 7 * smooth(0.14, 0.4, u) * (1 - smooth(0.7, 0.92, u)), h = 1.5 + 3.4 * smooth(0.14, 0.4, u) * (1 - smooth(0.72, 0.92, u));
      camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight); camera.updateProjectionMatrix();
      camera.position.set(P.x + Math.sin(a) * dist, Math.max(0.7, P.y + h), P.z + Math.cos(a) * dist); L.set(P.x, P.y + 0.6, P.z - 1.2 * smooth(0.2, 0.4, u)); camera.lookAt(L);
      if (!swapped && t > LENGTH * 0.56) { swapped = true; job.onSwap(); }
      if (t >= LENGTH) finish();
    },
  };
}
