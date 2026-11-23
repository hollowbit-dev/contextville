// Paintable ground: beach, forest floor, meadow, dirt and more, under everything you build.
// Each type blends softly into its neighbours, so painted areas never look like hard squares.
import * as THREE from 'three';

export const GROUND_LOOK = {
  meadow: { base: '#9dbb62', dots: [['#b9d170', 260, 5], ['#7f9f4d', 240, 4], ['#f3d36b', 26, 2], ['#ffffff', 22, 2], ['#eca8b0', 18, 2]], blades: '#6f9344' },
  forest: { base: '#4f6f3d', dots: [['#3f5b32', 320, 7], ['#64803f', 220, 4], ['#6d5438', 150, 4], ['#8a6a44', 60, 3]], blades: '#34512c' },
  sand: { base: '#ecd8ae', dots: [['#f6e8c8', 420, 3], ['#d9c08f', 360, 2], ['#c9ad7c', 80, 2], ['#ffffff', 40, 1.5]] },
  dirt: { base: '#9a7a55', dots: [['#86683f', 340, 5], ['#ae8f68', 280, 3], ['#6f5637', 90, 3]] },
  pebbles: { base: '#a9a297', dots: [['#c9c3b8', 170, 6], ['#8d877c', 170, 5], ['#e0dbd0', 80, 4], ['#6f6a62', 60, 3]] },
  paving: { base: '#d3c8b5', tiles: '#b3a793', dots: [['#ddd3c1', 60, 8], ['#c6baa6', 60, 6]] },
  snow: { base: '#eef2f5', dots: [['#ffffff', 300, 6], ['#dbe4ec', 180, 5]] },
};
// painted ground that clears wild trees from its tiles
export const CLEARS_TREES = new Set(['sand', 'dirt', 'pebbles', 'paving']);

function seeded(seed) { let a = seed; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function texture(look, seed) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), r = seeded(seed); g.fillStyle = look.base; g.fillRect(0, 0, S, S);
  for (const [col, n, size] of look.dots) { g.fillStyle = col; g.globalAlpha = 0.55; for (let k = 0; k < n; k++) { const x = r() * S, y = r() * S, s = size * (0.5 + r()); for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.beginPath(); g.ellipse(x + ox, y + oy, s, s * (0.6 + r() * 0.4), r() * 3, 0, 6.3); g.fill(); } } }
  g.globalAlpha = 1;
  if (look.blades) { g.strokeStyle = look.blades; g.globalAlpha = 0.5; g.lineWidth = 1.4; for (let k = 0; k < 1100; k++) { const x = r() * S, y = r() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 5, y - 4 - r() * 6); g.stroke(); } g.globalAlpha = 1; }
  if (look.tiles) { g.strokeStyle = look.tiles; g.lineWidth = 5; for (let k = 0; k <= 4; k++) { const p = (k * S) / 4; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, S); g.moveTo(0, p); g.lineTo(S, p); g.stroke(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

export function makeGround(parent, tileToWorld) {
  const layers = {}, nightTint = new THREE.Color('#6f78a4'), white = new THREE.Color('#ffffff');
  Object.entries(GROUND_LOOK).forEach(([id, look], k) => {
    const mat = new THREE.MeshStandardMaterial({ map: texture(look, 41 + k * 17), vertexColors: true, transparent: true, depthWrite: false, roughness: 1 });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat); mesh.receiveShadow = true; mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.visible = false; parent.add(mesh); layers[id] = mesh;
  });
  const EASE = [0, 0.12, 0.5, 0.88, 1];
  return {
    rebuild(tiles) {
      const byType = {};
      for (const [k, t] of Object.entries(tiles)) { if (!layers[t]) continue; const [i, j] = k.split(',').map(Number); (byType[t] ||= new Set()).add(`${i},${j}`); }
      for (const id of Object.keys(layers)) {
        const set = byType[id], mesh = layers[id]; mesh.geometry.dispose();
        if (!set) { mesh.geometry = new THREE.BufferGeometry(); mesh.visible = false; continue; }
        const cover = new Set(); for (const k of set) { const [i, j] = k.split(',').map(Number); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cover.add(`${i + a},${j + b}`); }
        const pos = [], uv = [], col = [], nor = [];
        const weight = (ci, cj) => EASE[(set.has(`${ci - 1},${cj - 1}`) ? 1 : 0) + (set.has(`${ci},${cj - 1}`) ? 1 : 0) + (set.has(`${ci - 1},${cj}`) ? 1 : 0) + (set.has(`${ci},${cj}`) ? 1 : 0)];
        for (const k of cover) {
          const [i, j] = k.split(',').map(Number), w = [weight(i, j), weight(i + 1, j), weight(i + 1, j + 1), weight(i, j + 1)];
          if (w[0] + w[1] + w[2] + w[3] === 0) continue;
          const [x, z] = tileToWorld(i, j), c = [[x - 0.5, z - 0.5], [x + 0.5, z - 0.5], [x + 0.5, z + 0.5], [x - 0.5, z + 0.5]];
          for (const v of [0, 2, 1, 0, 3, 2]) { pos.push(c[v][0], 0.004, c[v][1]); uv.push(c[v][0] / 2.5, c[v][1] / 2.5); nor.push(0, 1, 0); col.push(1, 1, 1, w[v]); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
        mesh.geometry = g; mesh.visible = true;
      }
    },
    update(night) { for (const m of Object.values(layers)) m.material.color.copy(white).lerp(nightTint, night * 0.6); },
  };
}
