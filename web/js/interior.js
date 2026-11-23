// Inside buildings. Homes, shops, offices and civic buildings each open into a small furnished
// room you can walk around, with someone to talk to and a door back out to the street.
import * as THREE from 'three';
import { Builder, meshesFrom } from './models.js';
import { rng } from './city.js';
import { personGeometry, paintPeople, personMaterial } from './people.js';

const W = 2.3, D = 1.9, H = 0.66, R = 0.055;
const KIND = { cafe: 'cafe', bakery: 'bakery', shop: 'shop', market: 'shop', post: 'shop', cinema: 'cinema', library: 'books', school: 'books', university: 'books', museum: 'grand', hall: 'grand', opera: 'grand', clinic: 'clinic' };
export const hasInside = (def) => ['homes', 'shops', 'civic'].includes(def.cat);
const kindOf = (def) => KIND[def.id] || (def.cat === 'homes' ? 'home' : 'office');
const LOOK = {
  shop: ['#d8c7a9', '#f1e5d2', 'Counter'], cafe: ['#b98f68', '#f2dfc6', 'Counter'], bakery: ['#c9a57c', '#f6e6c8', 'Counter'], home: ['#a97f5b', '#e9dcc6', 'Say hello'],
  books: ['#8f6a4c', '#e6d7bd', 'Front desk'], office: ['#8d939e', '#e6e7e6', 'Reception'], clinic: ['#cfdcdc', '#f2f6f4', 'Reception'], grand: ['#d6cfc2', '#efe7d8', 'Front desk'], cinema: ['#5c3140', '#3b2a33', 'Kiosk'],
};
const WOOD = '#8a5f40', DARK = '#3b3634', STEEL = '#aeb4bb', PLANT = '#6f9a5c', POT = '#c9805f';
const GOODS = ['#d9785a', '#eab95e', '#9cc0dc', '#eca8b0', '#a7c29a', '#fbf5ea', '#b08ad8', '#5f8f8a'];

function furnish(kind, f, r) {
  const { box, ball, cyl, glow } = f, backZ = -D / 2;
  const shelf = (x, z, w, d, h = 0.42, rows = 3, items = GOODS) => {
    box(x, 0, z, w, h, d, WOOD);
    for (let k = 0; k < rows; k++) { const y = 0.06 + k * ((h - 0.08) / rows); for (let i = 0, n = Math.max(3, Math.floor(Math.max(w, d) / 0.075)); i < n; i++) { const u = (i + 0.5) / n - 0.5, s = 0.034 + r() * 0.018; for (const side of [-1, 1]) box(x + (d < w ? u * w : side * (w / 2 + 0.006)), y, z + (d < w ? side * (d / 2 + 0.006) : u * d), d < w ? s : 0.018, s * 1.3, d < w ? 0.018 : s, r.pick(items), false); } }
  };
  const plant = (x, z, s = 1) => { cyl(x, 0, z, 0.045 * s, 0.035 * s, 0.075 * s, POT); ball(x, 0.13 * s, z, 0.07 * s, PLANT); ball(x + 0.035 * s, 0.17 * s, z + 0.02 * s, 0.045 * s, PLANT); f.block(x, z, 0.1 * s, 0.1 * s); };
  const table = (x, z, top = '#c79a6d') => { cyl(x, 0, z, 0.012, 0.03, 0.1, DARK, 7); cyl(x, 0.1, z, 0.095, 0.095, 0.012, top, 14); f.block(x, z, 0.17, 0.17); };
  const stool = (x, z, c = '#d9785a') => { cyl(x, 0, z, 0.009, 0.022, 0.06, DARK, 6, false); cyl(x, 0.06, z, 0.034, 0.034, 0.012, c, 10, false); };
  const counter = (w = 1.15, c = WOOD, z = backZ + 0.42) => { box(0, 0, z, w, 0.125, 0.14, c); box(0, 0.125, z, w + 0.03, 0.012, 0.17, '#eee7da', false); };
  const person = -D / 2 + 0.22;
  if (kind === 'shop') {
    counter(); box(-0.28, 0.137, backZ + 0.42, 0.11, 0.07, 0.09, DARK, false); box(-0.28, 0.17, backZ + 0.39, 0.08, 0.04, 0.008, '#8ee0b5', false, true); box(0.2, 0.137, backZ + 0.42, 0.18, 0.025, 0.09, '#eab95e', false);
    shelf(-W / 2 + 0.09, 0.1, 0.11, 1.15); shelf(W / 2 - 0.09, 0.1, 0.11, 1.15); shelf(-0.42, 0.28, 0.42, 0.11, 0.3, 2); shelf(0.42, 0.28, 0.42, 0.11, 0.3, 2);
    box(W / 2 - 0.17, 0, backZ + 0.09, 0.26, 0.48, 0.13, '#dfe7ea'); box(W / 2 - 0.17, 0.05, backZ + 0.158, 0.22, 0.38, 0.006, '#c6ecff', false, true);
  } else if (kind === 'cafe' || kind === 'bakery') {
    counter(1.25, kind === 'cafe' ? '#7f5a43' : '#b9835a'); box(-0.34, 0.137, backZ + 0.42, 0.2, 0.11, 0.1, STEEL, false); cyl(-0.28, 0.25, backZ + 0.42, 0.015, 0.015, 0.03, DARK, 6, false);
    box(0.28, 0.137, backZ + 0.42, 0.36, 0.08, 0.11, '#d9f0f7', false); for (let i = 0; i < 5; i++) ball(0.14 + i * 0.07, 0.165, backZ + 0.42, 0.024, r.pick(['#d9a15f', '#c9805f', '#eab95e', '#eca8b0']));
    if (kind === 'bakery') { box(-0.72, 0, backZ + 0.1, 0.42, 0.42, 0.16, '#b5654a'); box(-0.72, 0.1, backZ + 0.183, 0.26, 0.15, 0.006, '#ffae55', false, true); shelf(0.72, backZ + 0.09, 0.5, 0.11, 0.42, 3, ['#d9a15f', '#c9805f', '#e0b26f']); }
    else shelf(0.72, backZ + 0.09, 0.5, 0.11, 0.42, 3, ['#7f5a43', '#eae0cf', '#d9785a']);
    for (const [x, z] of [[-0.68, 0.18], [0.68, 0.18], [-0.68, 0.62], [0.68, 0.62]]) { table(x, z); stool(x - 0.15, z); stool(x + 0.15, z); }
    plant(-W / 2 + 0.11, D / 2 - 0.12); plant(W / 2 - 0.11, D / 2 - 0.12);
  } else if (kind === 'home') {
    const fab = r.pick(['#7f9bb3', '#a7c29a', '#d9785a', '#b08ad8', '#e8b45a']);
    box(0, 0.001, 0.22, 0.9, 0.006, 0.66, r.pick(['#c9805f', '#8fb4d9', '#c9b59c']), false);
    box(-0.82, 0, 0.2, 0.26, 0.085, 0.66, fab); box(-0.93, 0.085, 0.2, 0.07, 0.11, 0.66, fab, false); for (const s of [-1, 1]) box(-0.82, 0.085, 0.2 + s * 0.31, 0.26, 0.05, 0.05, fab, false);
    box(-0.34, 0, 0.2, 0.22, 0.07, 0.36, WOOD); box(-0.34, 0.07, 0.2, 0.1, 0.012, 0.1, '#f0e9dc', false);
    box(W / 2 - 0.07, 0, 0.2, 0.08, 0.22, 0.5, DARK); box(W / 2 - 0.115, 0.05, 0.2, 0.006, 0.16, 0.44, '#7db9d6', false, true);
    counter(1.0, '#c7a37a', backZ + 0.34); for (let i = 0; i < 4; i++) box(-0.75 + i * 0.5, 0.42, backZ + 0.025, 0.46, 0.16, 0.05, '#c7a37a', false);
    box(-0.3, 0.137, backZ + 0.34, 0.08, 0.06, 0.08, STEEL, false); shelf(-0.86, backZ + 0.08, 0.42, 0.1, 0.42, 3); plant(W / 2 - 0.12, backZ + 0.13); plant(-W / 2 + 0.12, D / 2 - 0.13, 0.9);
  } else if (kind === 'books') {
    counter(1.0, '#6e4c36'); box(-0.26, 0.137, backZ + 0.42, 0.14, 0.05, 0.1, '#d9785a', false);
    for (const x of [-W / 2 + 0.08, W / 2 - 0.08]) shelf(x, 0.05, 0.1, 1.45, 0.55, 5, ['#8a3f35', '#34506b', '#3f6b52', '#c9a15a', '#5c3f6e']);
    shelf(-0.72, backZ + 0.08, 0.6, 0.1, 0.55, 5, ['#8a3f35', '#34506b', '#c9a15a']); shelf(0.72, backZ + 0.08, 0.6, 0.1, 0.55, 5, ['#3f6b52', '#34506b', '#5c3f6e']);
    for (const x of [-0.42, 0.42]) { box(x, 0, 0.32, 0.46, 0.1, 0.24, WOOD); box(x, 0.1, 0.32, 0.1, 0.008, 0.08, '#f4efe2', false); glow(x + 0.15, 0.14, 0.3, 0.024, '#ffd894'); cyl(x + 0.15, 0.1, 0.3, 0.004, 0.006, 0.04, DARK, 5, false); stool(x - 0.1, 0.5, '#6e4c36'); stool(x + 0.1, 0.5, '#6e4c36'); }
  } else if (kind === 'office') {
    counter(1.0, '#58616e'); box(0.28, 0.137, backZ + 0.42, 0.14, 0.09, 0.01, '#8ee0b5', false, true);
    for (const z of [0.12, 0.58]) for (const x of [-0.72, 0.72]) { box(x, 0, z, 0.48, 0.1, 0.22, '#d9d4c9'); box(x, 0.1, z - 0.05, 0.2, 0.11, 0.012, DARK, false); box(x, 0.11, z - 0.042, 0.18, 0.09, 0.004, r() < 0.5 ? '#7db9d6' : '#a8e6c5', false, true); box(x, 0.1, z + 0.05, 0.13, 0.006, 0.05, '#f0efe9', false); stool(x, z + 0.18, '#58616e'); }
    box(0.86, 0, backZ + 0.1, 0.34, 0.38, 0.1, '#c4cbd2'); plant(-W / 2 + 0.12, backZ + 0.13, 1.2); plant(W / 2 - 0.12, D / 2 - 0.13);
  } else if (kind === 'clinic') {
    counter(1.0, '#d7e3e1'); box(0, 0.32, backZ + 0.008, 0.05, 0.16, 0.016, '#ff6a5a', false, true); box(0, 0.38, backZ + 0.008, 0.16, 0.05, 0.016, '#ff6a5a', false, true);
    for (const x of [-0.82, 0.82]) { box(x, 0, backZ + 0.35, 0.34, 0.09, 0.56, '#f7f7f4'); box(x, 0.09, backZ + 0.18, 0.2, 0.02, 0.13, '#cfe3ea', false); }
    for (let i = 0; i < 4; i++) { stool(-0.92, 0.1 + i * 0.16, '#8fb4d9'); stool(0.92, 0.1 + i * 0.16, '#8fb4d9'); } plant(W / 2 - 0.11, D / 2 - 0.12);
  } else if (kind === 'grand') {
    counter(1.0, '#a78b63'); box(0, 0.001, 0.25, 0.42, 0.006, 1.32, '#a83c35', false);
    for (const z of [-0.2, 0.25, 0.68]) for (const x of [-0.72, 0.72]) { cyl(x, 0, z, 0.05, 0.058, H, '#f2ead9', 14); f.block(x, z, 0.12, 0.12); }
    for (const x of [-0.92, 0.92]) { box(x, 0.16, backZ + 0.012, 0.24, 0.3, 0.008, r.pick(['#5f8f8a', '#d9785a', '#34506b']), false); box(x, 0.13, backZ + 0.005, 0.28, 0.36, 0.01, '#c9a15a', false); }
    plant(-W / 2 + 0.12, D / 2 - 0.13, 1.1); plant(W / 2 - 0.12, D / 2 - 0.13, 1.1);
  } else if (kind === 'cinema') {
    box(0, 0.12, backZ + 0.012, 1.7, 0.44, 0.012, '#dfe9f2', false, true); for (const sx of [-1, 1]) box(sx * 0.93, 0, backZ + 0.03, 0.18, H - 0.04, 0.04, '#8a2f3b', false);
    for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) { const x = -0.84 + i * 0.28, z = -0.34 + row * 0.26; if (Math.abs(x) < 0.05) continue; box(x, 0, z, 0.2, 0.06, 0.13, '#a83c35', false); box(x, 0.06, z + 0.055, 0.2, 0.08, 0.025, '#8f2f2d', false); f.block(x, z, 0.23, 0.17); }
    box(0.76, 0, 0.66, 0.5, 0.125, 0.15, '#6e3a44'); box(0.76, 0.125, 0.66, 0.52, 0.012, 0.17, '#eee7da', false); box(0.9, 0.137, 0.66, 0.11, 0.13, 0.09, '#f4d67a', false);
    return { counterAt: [0.76, 0.56], keeper: [0.76, 0.77, Math.PI] };
  }
  return { counterAt: [0, kind === 'home' ? backZ + 0.54 : backZ + 0.62], keeper: [0, kind === 'home' ? backZ + 0.17 : person, 0] };
}

export function makeRoom(it, def, night = 0) {
  const kind = kindOf(def), [floor, wall, label] = LOOK[kind], r = rng((it.seed || 1) + 5), b = new Builder(), blocks = [], scene = new THREE.Scene();
  b.noContact = true;
  const block = (x, z, w, d) => blocks.push([x - w / 2 - R, x + w / 2 + R, z - d / 2 - R, z + d / 2 + R]);
  const f = {
    block,
    box(x, y, z, w, h, d, c, solid = true, lit = false) { b.box(x, y, z, w, h, d, c, lit ? { glow: true } : {}); if (solid && y < 0.2) block(x, z, w, d); },
    ball(x, y, z, s, c) { b.ball(x, y, z, s, c, { detail: 2 }); },
    glow(x, y, z, s, c) { b.ball(x, y, z, s, c, { glow: true, detail: 1 }); },
    cyl(x, y, z, r1, r2, h, c, seg = 12, solid) { b.cyl(x, y, z, r1, r2, h, c, seg); if (solid === true) block(x, z, r2 * 2, r2 * 2); },
  };
  b.box(0, -0.03, 0, W + 0.1, 0.03, D + 0.1, floor);
  if (kind !== 'cinema') for (let i = -5; i <= 5; i++) b.box(i * 0.21, 0, 0, 0.004, 0.0015, D, new THREE.Color(floor).multiplyScalar(0.82).getStyle());
  b.box(0, H, 0, W + 0.1, 0.03, D + 0.1, kind === 'cinema' ? '#2c2028' : '#f7f1e6');
  b.box(0, 0, -D / 2 - 0.02, W + 0.1, H, 0.04, wall); b.box(-W / 2 - 0.02, 0, 0, 0.04, H, D + 0.1, wall); b.box(W / 2 + 0.02, 0, 0, 0.04, H, D + 0.1, wall);
  b.box(-(W / 4 + 0.09), 0, D / 2 + 0.02, W / 2 - 0.18 + 0.05, H, 0.04, wall); b.box(W / 4 + 0.09, 0, D / 2 + 0.02, W / 2 - 0.18 + 0.05, H, 0.04, wall); b.box(0, 0.33, D / 2 + 0.02, 0.36, H - 0.33, 0.04, wall);
  for (const [x, zz] of [[-W / 2, 1], [W / 2, -1]]) b.box(x + zz * 0.006, 0, 0, 0.012, 0.04, D, new THREE.Color(wall).multiplyScalar(0.8).getStyle());
  b.box(0, 0, -D / 2 + 0.006, W, 0.04, 0.012, new THREE.Color(wall).multiplyScalar(0.8).getStyle());
  // the door back to the street, with a warm exit sign above it
  b.box(0, 0, D / 2 + 0.012, 0.34, 0.325, 0.012, '#f4ecdf'); b.box(0, 0, D / 2 + 0.004, 0.28, 0.3, 0.014, '#8a5f40'); b.ball(0.1, 0.15, D / 2 - 0.008, 0.012, '#eab95e', { detail: 1 }); b.box(0, 0.36, D / 2 - 0.002, 0.2, 0.05, 0.006, '#7fd6a0', { glow: true });
  // windows on the side walls show the time of day
  const pane = night > 0.5 ? '#26305e' : night > 0.15 ? '#f0a97f' : '#bfe0f3';
  if (kind !== 'cinema') for (const sx of [-1, 1]) for (const z of [-0.2, 0.42]) { b.box(sx * (W / 2 - 0.001), 0.36, z, 0.004, 0.21, 0.3, '#f7f1e6'); b.box(sx * (W / 2 - 0.004), 0.375, z, 0.004, 0.18, 0.27, pane, { glow: true }); }
  const lamps = kind === 'cinema' ? [] : [[-0.55, -0.15], [0.55, -0.15], [-0.55, 0.45], [0.55, 0.45]];
  for (const [x, z] of lamps) { b.cyl(x, H - 0.09, z, 0.003, 0.003, 0.09, DARK, 4); b.cone(x, H - 0.13, z, 0.06, 0.045, DARK, 10); b.ball(x, H - 0.13, z, 0.024, '#fff0c9', { glow: true, detail: 1 }); }
  const spot = furnish(kind, f, r), group = meshesFrom(b.build()); group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } }); scene.add(group);
  scene.background = new THREE.Color('#141214');
  scene.add(new THREE.HemisphereLight('#fff6e6', kind === 'cinema' ? '#4a2a35' : '#a98f70', kind === 'cinema' ? 1.05 : 1.7));
  const key = new THREE.DirectionalLight('#fff0d8', kind === 'cinema' ? 0.5 : 1.05); key.position.set(0.5, 2, 1.2); scene.add(key);
  // someone is in, and they're the one you talk to
  const pg = personGeometry(false), mv = paintPeople(pg, 1); mv.setX(0, 0);
  for (const a of ['aTop', 'aLegs', 'aSkin', 'aHair']) { const q = pg.attributes[a], c = new THREE.Color(), list = a === 'aTop' ? GOODS : a === 'aLegs' ? ['#3f4654', '#2f3440', '#5c5148'] : a === 'aSkin' ? ['#f3d3bb', '#d8a98a', '#b98563', '#8d5f43'] : ['#2f2723', '#7a5536', '#b58a55', '#8d8d8d']; c.set(r.pick(list)); q.setXYZ(0, c.r, c.g, c.b); }
  const keeper = new THREE.InstancedMesh(pg, personMaterial(), 1), [kx, kz, ky] = spot.keeper; keeper.setMatrixAt(0, new THREE.Matrix4().makeRotationY(ky).setPosition(kx, 0, kz)); keeper.frustumCulled = false; scene.add(keeper); block(kx, kz, 0.08, 0.08);
  const [cx, cz] = spot.counterAt, doorZ = D / 2 - 0.08;
  const wallHit = (x, z) => Math.abs(x) > W / 2 - 0.03 || Math.abs(z) > D / 2 - 0.03;
  return {
    scene, H, item: it, spawn: { x: 0, z: D / 2 - 0.4, yaw: 0 },
    solid: (x, z) => Math.abs(x) > W / 2 - R || Math.abs(z) > D / 2 - R || blocks.some((q) => x > q[0] && x < q[1] && z > q[2] && z < q[3]),
    wall: wallHit,
    near(x, z) {
      if (Math.hypot(x, z - doorZ) < 0.3) return { kind: 'door', label: 'Door to the street' };
      if (Math.hypot(x - cx, z - cz) < 0.42) return { kind: 'counter', label, item: it };
      return null;
    },
    dispose() { scene.traverse((o) => { o.geometry?.dispose?.(); }); },
  };
}
