// Parts of buildings that really move: the Big Wheel, windmill sails, the carousel, clock hands
// that show your real time, and fountain water. Each kind is one instanced draw call.
import * as THREE from 'three';
import { Builder, materials } from './models.js';
import { sailParts, carouselTop, C } from './catalog.js';

const MAX = { wheel: 12, sails: 60, carousel: 24, clock: 120, jet: 60 };
const DROPS = 16;

export function makeMovers(scene) {
  const mats = materials(), M = new THREE.Matrix4(), T = new THREE.Matrix4(), R = new THREE.Matrix4(), S = new THREE.Matrix4();
  const built = (fn) => { const b = new Builder(); b.noContact = true; fn(b); return b.build(); };
  const inst = (geo, mat, n, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = shadow; m.frustumCulled = false; scene.add(m); return m; };

  const WR = 1.2;
  const wheelB = built((b) => {
    for (const s of [-0.18, 0.18]) {
      b.add('solid', new THREE.TorusGeometry(WR, 0.022, 6, 48), C.ivory, 0, 0, s);
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.add('solid', new THREE.BoxGeometry(WR, 0.014, 0.014), C.ivory, Math.cos(a) * WR / 2, Math.sin(a) * WR / 2, s, 0, 0, a); }
    }
  });
  const wheels = inst(wheelB.solid, mats.solid, MAX.wheel);
  const podB = built((b) => { b.box(0, -0.15, 0, 0.2, 0.15, 0.26, '#ffffff'); b.box(0, -0.015, 0, 0.23, 0.025, 0.37, '#5a5350'); });
  const pods = inst(podB.solid, mats.solid, MAX.wheel * 12);
  const POD = [C.terra, C.gold, C.sky, C.pink, C.sage, C.ivory].map((c) => new THREE.Color(c));
  const sails = inst(built((b) => sailParts(b, 0, 0, 0)).solid, mats.solid, MAX.sails);
  const carouselB = built((b) => carouselTop(b, 0, 0, 0));
  const carousels = inst(carouselB.solid, mats.solid, MAX.carousel);
  const carouselGlow = inst(carouselB.glow, mats.glow, MAX.carousel, false);
  const handG = new THREE.BoxGeometry(1, 1, 1); handG.translate(0, 0.5, 0);
  const hands = inst(handG, new THREE.MeshBasicMaterial({ color: '#2f2b29' }), MAX.clock * 2, false);

  const jetPos = new Float32Array(MAX.jet * DROPS * 3), jetGeo = new THREE.BufferGeometry();
  jetGeo.setAttribute('position', new THREE.BufferAttribute(jetPos, 3));
  const jets = new THREE.Points(jetGeo, new THREE.PointsMaterial({ color: '#e4f6ff', size: 0.045, transparent: true, opacity: 0.85, depthWrite: false }));
  jets.frustumCulled = false; scene.add(jets);

  let list = { wheel: [], sails: [], carousel: [], clock: [], jet: [] }, t = 0;
  const place = (p, a, spin) => { T.makeTranslation(p.x, p.y, p.z); R.makeRotationY(a); S.makeRotationZ(spin); return M.copy(T).multiply(R).multiply(S); };

  return {
    setMarks(marks) {
      for (const k of Object.keys(list)) list[k] = (marks[k] || []).slice(0, MAX[k]);
      wheels.count = list.wheel.length; pods.count = list.wheel.length * 12; sails.count = list.sails.length;
      carousels.count = carouselGlow.count = list.carousel.length; hands.count = list.clock.length * 2;
      for (let i = 0; i < pods.count; i++) pods.setColorAt(i, POD[i % POD.length]);
      if (pods.instanceColor) pods.instanceColor.needsUpdate = true;
      jetGeo.setDrawRange(0, list.jet.length * DROPS);
    },
    update(dt) {
      t += dt;
      const spin = t * 0.16;
      list.wheel.forEach((p, k) => {
        wheels.setMatrixAt(k, place(p, p.a, spin + k));
        for (let i = 0; i < 12; i++) {
          const a = spin + k + (i / 12) * Math.PI * 2, sway = Math.sin(t * 1.3 + i) * 0.05;
          const lx = Math.cos(a) * WR, ly = Math.sin(a) * WR;
          T.makeTranslation(p.x + Math.cos(p.a) * lx, p.y + ly, p.z - Math.sin(p.a) * lx); R.makeRotationY(p.a); S.makeRotationZ(sway);
          pods.setMatrixAt(k * 12 + i, M.copy(T).multiply(R).multiply(S));
        }
      });
      if (list.wheel.length) { wheels.instanceMatrix.needsUpdate = true; pods.instanceMatrix.needsUpdate = true; }
      list.sails.forEach((p, k) => sails.setMatrixAt(k, place(p, p.a, t * 0.75 + k * 1.3)));
      if (list.sails.length) sails.instanceMatrix.needsUpdate = true;
      list.carousel.forEach((p, k) => { T.makeTranslation(p.x, p.y + Math.sin(t * 2) * 0.006, p.z); R.makeRotationY(t * 0.55 + k); M.copy(T).multiply(R); carousels.setMatrixAt(k, M); carouselGlow.setMatrixAt(k, M); });
      if (list.carousel.length) { carousels.instanceMatrix.needsUpdate = true; carouselGlow.instanceMatrix.needsUpdate = true; }
      if (list.clock.length) {
        const d = new Date(), mins = d.getMinutes() + d.getSeconds() / 60, hrs = (d.getHours() % 12) + mins / 60;
        list.clock.forEach((p, k) => {
          for (const [h, ang, len, w] of [[0, (hrs / 12) * Math.PI * 2, 0.085, 0.018], [1, (mins / 60) * Math.PI * 2, 0.135, 0.011]]) {
            place(p, p.a, -ang); S.makeScale(w, len, 0.006); M.multiply(S); hands.setMatrixAt(k * 2 + h, M);
          }
        });
        hands.instanceMatrix.needsUpdate = true;
      }
      if (list.jet.length) {
        let o = 0;
        list.jet.forEach((p, k) => {
          for (let i = 0; i < DROPS; i++) {
            const life = (t * 0.8 + i / DROPS + k * 0.21) % 1, a = i * 2.399 + k;
            jetPos[o++] = p.x + Math.cos(a) * life * 0.25; jetPos[o++] = p.y + life * 0.34 - life * life * 0.58; jetPos[o++] = p.z + Math.sin(a) * life * 0.25;
          }
        });
        jetGeo.attributes.position.needsUpdate = true;
      }
    },
  };
}
