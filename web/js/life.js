// Small signs of life: warm pools of lamplight at night, fireflies over the parks on summer
// evenings, smoke curling from chimneys. All instanced or pooled, so they cost almost nothing.
import * as THREE from 'three';
import { mergeGeometries as _mg } from 'three/addons/utils/BufferGeometryUtils.js';
import { SEASON } from './season.js';
import { personGeometry, paintPeople, personMaterial } from './people.js';

function glowTexture() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,214,150,1)'); gr.addColorStop(0.35, 'rgba(255,190,120,0.55)'); gr.addColorStop(1, 'rgba(255,170,100,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function makeLife(scene) {
  const M = new THREE.Matrix4(), V = new THREE.Vector3(), V2 = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();

  // ---- lamplight pools on the ground ----
  const MAXP = 600;
  const poolG = new THREE.PlaneGeometry(1.25, 1.25); poolG.rotateX(-Math.PI / 2);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const pools = new THREE.InstancedMesh(poolG, poolMat, MAXP); pools.count = 0; pools.renderOrder = 2; scene.add(pools);

  // ---- fireflies ----
  const FF = 180, ffPos = new Float32Array(FF * 3), ffCol = new Float32Array(FF * 3), ff = [];
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3)); ffGeo.setAttribute('color', new THREE.BufferAttribute(ffCol, 3));
  const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const ffMat = new THREE.PointsMaterial({ map: dotTex, size: 7, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const fireflies = new THREE.Points(ffGeo, ffMat); fireflies.frustumCulled = false; scene.add(fireflies);

  // ---- chimney smoke ----
  const MAXS = 480, PER = 4;
  const smokePos = new Float32Array(MAXS * 3), smokeCol = new Float32Array(MAXS * 4), smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3)); smokeGeo.setAttribute('color', new THREE.BufferAttribute(smokeCol, 4));
  const smoke = new THREE.Points(smokeGeo, new THREE.PointsMaterial({ map: dotTex, size: 0.17, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false }));
  smoke.frustumCulled = false; scene.add(smoke);
  let chimneys = [];

  // ---- birds: a small flock wheeling over the city by day ----
  const NB = 9;
  const birdG = new THREE.BufferGeometry();
  birdG.setAttribute('position', new THREE.Float32BufferAttribute([-0.28, 0.08, 0, 0, 0, 0.05, 0, 0, -0.05, 0.28, 0.08, 0, 0, 0, -0.05, 0, 0, 0.05], 3)); birdG.computeVertexNormals();
  const birds = new THREE.InstancedMesh(birdG, new THREE.MeshBasicMaterial({ color: '#4b4542', side: THREE.DoubleSide }), NB); birds.frustumCulled = false; scene.add(birds);
  const flock = Array.from({ length: NB }, (_, k) => ({ off: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.2, (Math.random() - 0.5) * 3), ph: Math.random() * 6 }));

  // ---- cats: sitting on hedges and shop steps ----
  const catB = [];
  { const body = new THREE.SphereGeometry(0.035, 7, 5); body.scale(1, 0.9, 1.4); body.translate(0, 0.03, 0);
    const head = new THREE.SphereGeometry(0.024, 7, 5); head.translate(0, 0.07, 0.035);
    const e1 = new THREE.ConeGeometry(0.009, 0.018, 4); e1.translate(-0.012, 0.094, 0.035); const e2 = e1.clone(); e2.translate(0.024, 0, 0);
    const tail = new THREE.CylinderGeometry(0.005, 0.006, 0.07, 4); tail.rotateX(0.6); tail.translate(0, 0.035, -0.06);
    for (const g of [body, head, e1, e2, tail]) catB.push(g.index ? g.toNonIndexed() : g); }
  const catG = _mg(catB.map((g) => { g.deleteAttribute('uv'); return g; }));
  const cats = new THREE.InstancedMesh(catG, new THREE.MeshStandardMaterial({ roughness: 0.9 }), 120); cats.count = 0; cats.castShadow = true; scene.add(cats);
  const CAT_COLS = ['#e0904f', '#3a3634', '#9a9592', '#f4efe6', '#c98a52'];

  // ---- fireworks: rockets that burst into warm sparks ----
  const FW = 1400, fwPos = new Float32Array(FW * 3), fwCol = new Float32Array(FW * 3), fwVel = new Float32Array(FW * 3), fwLife = new Float32Array(FW), fwHue = new Float32Array(FW * 3);
  const fwGeo = new THREE.BufferGeometry(); fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3)); fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
  const fwPts = new THREE.Points(fwGeo, new THREE.PointsMaterial({ map: dotTex, size: 9, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  fwPts.frustumCulled = false; scene.add(fwPts);
  const rockets = []; let fwNext = 0, show = 0, showTimer = 0, onBurst = null;
  const FW_COLS = [[1, 0.55, 0.35], [1, 0.85, 0.45], [0.95, 0.6, 0.75], [0.7, 0.85, 1], [1, 1, 0.9]];
  function burst(x, y, z) {
    const c = FW_COLS[Math.floor(Math.random() * FW_COLS.length)], n = 120;
    for (let k = 0; k < n; k++) {
      const i = fwNext; fwNext = (fwNext + 1) % FW;
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), sp = 1.6 + Math.random() * 0.5;
      fwPos.set([x, y, z], i * 3); fwVel.set([Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp], i * 3); fwHue.set(c, i * 3); fwLife[i] = 1.4 + Math.random() * 0.6;
    }
    onBurst && onBurst();
  }
  // ---- festival bunting strung across the streets ----
  const flagG = new THREE.BufferGeometry(); flagG.setAttribute('position', new THREE.Float32BufferAttribute([-0.04, 0, 0, 0.04, 0, 0, 0, -0.08, 0], 3)); flagG.computeVertexNormals();
  const flags = new THREE.InstancedMesh(flagG, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 1500); flags.count = 0; scene.add(flags);
  const poleG = new THREE.CylinderGeometry(0.008, 0.01, 0.66, 5); poleG.translate(0, 0.33, 0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: '#6e5a4c', roughness: 0.8 }), 400); poles.count = 0; scene.add(poles);
  const FLAG_COLS = ['#d9785a', '#eab95e', '#9cc0dc', '#eca8b0', '#a7c29a', '#fbf5ea'];
  // ---- ducks paddling on ponds ----
  const duckB = new THREE.SphereGeometry(0.035, 7, 5); duckB.scale(1.3, 0.8, 1); duckB.translate(0, 0.02, 0);
  const duckH = new THREE.SphereGeometry(0.02, 6, 4); duckH.translate(0.035, 0.055, 0);
  const duckBk = new THREE.ConeGeometry(0.008, 0.025, 4); duckBk.rotateZ(-Math.PI / 2); duckBk.translate(0.06, 0.052, 0);
  const duckG = _mg([duckB, duckH, duckBk].map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
  const ducks = new THREE.InstancedMesh(duckG, new THREE.MeshStandardMaterial({ color: '#f7f3ea', roughness: 0.8 }), 90); ducks.count = 0; scene.add(ducks);
  let ponds = [], ducksOn = false;
  // ---- people sitting on benches in the daytime ----
  const sitG = personGeometry(true); paintPeople(sitG, 200);
  const sitters = new THREE.InstancedMesh(sitG, personMaterial(), 200); sitters.count = 0; sitters.castShadow = true; sitters.frustumCulled = false; scene.add(sitters);
  // ---- December: fairy lights along the streets ----
  const december = new Date().getMonth() === 11 || new URLSearchParams(location.search).get('season') === 'winter';
  const bulbs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.018, 0), new THREE.MeshBasicMaterial({ toneMapped: false }), 3000); bulbs.count = 0; scene.add(bulbs);
  const BULB_COLS = ['#ffd27a', '#ff9a6a', '#fff3d0', '#ffb8c8'];

  let t = 0;
  return {
    fireworks(n = 12, center = new THREE.Vector3(0, 0, 0), cb) { show = n; showTimer = 0; onBurst = cb; this.fwCenter = center; },
    get fwCenter() { return this._c; }, set fwCenter(v) { this._c = v; },
    setFestival(roadTiles) {
      let n = 0, np = 0; const col = new THREE.Color();
      for (const [x, z, ns] of roadTiles) {
        for (const s of [-0.46, 0.46]) if (np < 400) { M.makeTranslation(ns ? x + s : x, 0, ns ? z : z + s); poles.setMatrixAt(np++, M); }
        for (let k = 0; k < 9 && n < 1500; k++) {
          const u = -0.42 + k * 0.105, sag = 0.62 - (1 - (u / 0.42) ** 2) * 0.08;
          if (ns) M.makeTranslation(x + u, sag, z); else M.makeRotationY(Math.PI / 2).setPosition(x, sag, z + u);
          flags.setMatrixAt(n, M); flags.setColorAt(n, col.set(FLAG_COLS[(k + Math.round(x + z)) % FLAG_COLS.length])); n++;
        }
      }
      poles.count = np; poles.instanceMatrix.needsUpdate = true;
      flags.count = n; flags.instanceMatrix.needsUpdate = true; if (flags.instanceColor) flags.instanceColor.needsUpdate = true;
    },
    setDucks(on) { ducksOn = on; },
    setMarks(marks) {
      const lamps = marks.lamp.slice(0, MAXP);
      lamps.forEach((p, k) => { M.makeTranslation(p.x, 0.065, p.z); pools.setMatrixAt(k, M); });
      pools.count = lamps.length; pools.instanceMatrix.needsUpdate = true;
      chimneys = marks.smoke.slice(0, MAXS / PER);
      ponds = marks.pond || [];
      const bs = (marks.bench || []).slice(0, 200), col2 = new THREE.Color();
      let ns = 0;
      bs.forEach((p, k) => { if ((Math.round(p.x * 31 + p.z * 17) & 3) === 3) return; M.makeRotationY(p.a || 0).setPosition(p.x, p.y + 0.012, p.z); sitters.setMatrixAt(ns++, M); });
      sitters.count = ns; sitters.instanceMatrix.needsUpdate = true;
      // fairy lights hang between street lamps in December
      let nb = 0;
      if (december) for (const lp of marks.lamp) for (let k = 0; k < 10 && nb < 3000; k++) {
        const u = k / 9, a = (lp.x * 3 + lp.z * 7) % 6.28;
        M.makeTranslation(lp.x + Math.cos(a) * (u - 0.5) * 0.9, 0.42 - Math.sin(u * Math.PI) * 0.12, lp.z + Math.sin(a) * (u - 0.5) * 0.9);
        bulbs.setMatrixAt(nb, M); bulbs.setColorAt(nb++, col2.set(BULB_COLS[k % BULB_COLS.length]));
      }
      bulbs.count = nb; bulbs.instanceMatrix.needsUpdate = true; if (bulbs.instanceColor) bulbs.instanceColor.needsUpdate = true;
      const cs = marks.cat.slice(0, 120), col = new THREE.Color();
      cs.forEach((p, k) => { M.makeRotationY((p.x * 7.3 + p.z * 3.1) % 6.28).setPosition(p.x, p.y, p.z); cats.setMatrixAt(k, M); cats.setColorAt(k, col.set(CAT_COLS[Math.abs(Math.round(p.x * 13 + p.z * 7)) % CAT_COLS.length])); });
      cats.count = cs.length; cats.instanceMatrix.needsUpdate = true; if (cats.instanceColor) cats.instanceColor.needsUpdate = true;
      // fireflies drift around parks, trees and flower beds (none in winter)
      ff.length = 0;
      const greens = marks.green;
      if (SEASON !== 'winter' && greens.length) for (let k = 0; k < Math.min(FF, greens.length * 4); k++) {
        const g = greens[k % greens.length];
        ff.push({ x: g.x + (Math.random() - 0.5) * 1.4, z: g.z + (Math.random() - 0.5) * 1.4, y: 0.25 + Math.random() * 0.5, ph: Math.random() * 100, sp: 0.4 + Math.random() * 0.6 });
      }
      ffGeo.setDrawRange(0, ff.length);
    },
    update(dt, night) {
      t += dt;
      poolMat.opacity = Math.min(1, night * 1.1) * 0.55; pools.visible = night > 0.05;
      // fireflies: only on warm nights
      fireflies.visible = night > 0.3 && ff.length > 0;
      if (fireflies.visible) {
        const vis = (night - 0.3) / 0.7;
        ff.forEach((f, k) => {
          const a = t * f.sp + f.ph;
          ffPos[k * 3] = f.x + Math.sin(a * 0.7) * 0.35; ffPos[k * 3 + 1] = f.y + Math.sin(a * 1.3) * 0.12; ffPos[k * 3 + 2] = f.z + Math.cos(a * 0.6) * 0.35;
          const blink = Math.max(0, Math.sin(a * 2.1)) ** 3 * vis;
          ffCol[k * 3] = 1.0 * blink; ffCol[k * 3 + 1] = 0.92 * blink; ffCol[k * 3 + 2] = 0.45 * blink;
        });
        ffGeo.attributes.position.needsUpdate = true; ffGeo.attributes.color.needsUpdate = true;
      }
      // smoke: each chimney sends up a slow chain of puffs that grow and fade
      let n = 0;
      for (let c = 0; c < chimneys.length; c++) {
        const p = chimneys[c];
        for (let k = 0; k < PER; k++) {
          const life = ((t * 0.28 + k / PER + c * 0.37) % 1);
          const o = n * 3, a = n * 4, shade = 0.96 - night * 0.42;
          smokePos[o] = p.x + Math.sin(life * 3 + c) * 0.05 + life * 0.14; smokePos[o + 1] = p.y + life * 0.62; smokePos[o + 2] = p.z + life * 0.06;
          smokeCol[a] = shade; smokeCol[a + 1] = shade; smokeCol[a + 2] = shade * 0.98; smokeCol[a + 3] = Math.sin(life * Math.PI) * (1 - life) * 0.34;
          n++;
        }
      }
      smokeGeo.setDrawRange(0, n); smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.color.needsUpdate = true;
      sitters.visible = night < 0.5;
      bulbs.visible = night > 0.2;
      // ducks paddle in slow circles
      let nd = 0;
      if (ducksOn) for (const pd of ponds) for (let k = 0; k < 3 && nd < 90; k++) {
        const a = t * (0.15 + k * 0.04) + k * 2.1 + pd.x, r = 0.25 + k * 0.13;
        Q.setFromAxisAngle(V2.set(0, 1, 0), -a - Math.PI / 2); V.set(pd.x + Math.cos(a) * r, pd.y + Math.sin(t * 2 + k) * 0.004, pd.z + Math.sin(a) * r);
        M.compose(V, Q, S.set(1, 1, 1)); ducks.setMatrixAt(nd++, M);
      }
      ducks.count = nd; ducks.instanceMatrix.needsUpdate = true;
      // fireworks
      if (show > 0) { showTimer -= dt; if (showTimer <= 0) { show--; showTimer = 0.5 + Math.random() * 0.9; const c = this.fwCenter; rockets.push({ x: c.x + (Math.random() - 0.5) * 10, z: c.z + (Math.random() - 0.5) * 10, y: 0.5, v: 5.4 + Math.random() * 1.6 }); } }
      for (let k = rockets.length - 1; k >= 0; k--) {
        const r = rockets[k]; r.y += r.v * dt; r.v -= 4 * dt;
        const i = fwNext; fwNext = (fwNext + 1) % FW; fwPos.set([r.x, r.y, r.z], i * 3); fwVel.set([0, -0.3, 0], i * 3); fwHue.set([1, 0.8, 0.5], i * 3); fwLife[i] = 0.35;
        if (r.v < 1.2) { burst(r.x, r.y, r.z); rockets.splice(k, 1); }
      }
      let live = false;
      for (let i = 0; i < FW; i++) {
        if (fwLife[i] <= 0) { fwCol[i * 3] = fwCol[i * 3 + 1] = fwCol[i * 3 + 2] = 0; continue; }
        live = true; fwLife[i] -= dt;
        fwVel[i * 3 + 1] -= 1.6 * dt; const drag = 1 - dt * 1.2;
        fwVel[i * 3] *= drag; fwVel[i * 3 + 1] *= drag; fwVel[i * 3 + 2] *= drag;
        fwPos[i * 3] += fwVel[i * 3] * dt; fwPos[i * 3 + 1] += fwVel[i * 3 + 1] * dt; fwPos[i * 3 + 2] += fwVel[i * 3 + 2] * dt;
        const b = Math.min(1, fwLife[i]) * (0.35 + 0.3 * night) * (0.7 + Math.random() * 0.3);
        fwCol[i * 3] = fwHue[i * 3] * b; fwCol[i * 3 + 1] = fwHue[i * 3 + 1] * b; fwCol[i * 3 + 2] = fwHue[i * 3 + 2] * b;
      }
      fwPts.visible = live || rockets.length > 0;
      if (fwPts.visible) { fwGeo.attributes.position.needsUpdate = true; fwGeo.attributes.color.needsUpdate = true; }
      // birds circle lazily; they go home at night
      birds.visible = night < 0.6;
      if (birds.visible) {
        const a = t * 0.12, cx = Math.cos(a) * 14, cz = Math.sin(a) * 10;
        flock.forEach((b, k) => {
          const flap = Math.sin(t * 9 + b.ph);
          V.set(cx + b.off.x + Math.sin(t * 0.7 + b.ph) * 0.6, 11 + b.off.y + Math.sin(t * 0.5 + b.ph) * 0.4, cz + b.off.z);
          Q.setFromAxisAngle(V2.set(0, 1, 0), -a - Math.PI / 2 * 0); S.set(1, flap, 1);
          M.compose(V, Q, S); birds.setMatrixAt(k, M);
        });
        birds.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
