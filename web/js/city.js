// The city: what's built where, the rules for placing, and the merged meshes that draw it.
import * as THREE from 'three';
import { Builder, materials, meshesFrom } from './models.js';
import { BY_ID, C, LEVEL_MULT, canUpgrade, ROAD_STYLES } from './catalog.js';
import { makeGround, CLEARS_TREES } from './ground.js';
import { PAL } from './season.js';
import { N, HALF, tileToWorld, inLand } from './world.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function rng(seed) { let a = seed >>> 0; const r = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; r.pick = (a) => a[Math.floor(r() * a.length)]; return r; }

const MOVING = new Set(['wheel', 'sails', 'carousel', 'clock', 'jet']);
// What every home wants within walking distance. A home with all three thrives: 20% more residents.
export const NEEDS = { shop: { r: 5, word: 'a shop or café' }, green: { r: 4, word: 'a park or some trees' }, civic: { r: 9, word: 'a school, clinic or library' } };
const needKind = (def) => (def.cat === 'shops' ? 'shop' : def.cat === 'civic' ? 'civic' : def.cat === 'nature' && def.joy ? 'green' : null);
export const footprint = (def, rot) => (rot % 2 ? [def.size[1], def.size[0]] : [def.size[0], def.size[1]]);

// A model plus its lot: a lawn with hedges for small homes, paving for shops and big buildings.
export function buildModel(def, seed, lvl = 1, live = false) {
  const b = new Builder();
  def.build(b, rng(seed), live);
  // upgrades show on the building: planters and a lamp at level 2, a gold finial at level 3
  if (lvl >= 2) {
    const [w, d] = def.size, x = w / 2 - 0.1, z = d / 2 - 0.1;
    for (const s of [-1, 1]) { b.cyl(s * x, 0.012, z, 0.055, 0.045, 0.06, C.terra, 8); b.ball(s * x, 0.11, z, 0.06, PAL.snow ? '#e8eef0' : C.hedge, { detail: 1 }); }
    b.cyl(x, 0.012, -z, 0.01, 0.014, 0.34, C.char, 5); b.ball(x, 0.37, -z, 0.032, '#ffd894', { glow: true }); b.mark('lamp', x, 0.37, -z);
  }
  if (lvl >= 3) { const t = b.top(); b.cyl(0, t, 0, 0.012, 0.018, 0.18, C.char, 5); b.ball(0, t + 0.21, 0, 0.05, C.gold, { detail: 1, glow: true }); }
  if (!def.road && !def.path && def.cat !== 'nature' && !['garden', 'hall', 'library'].includes(def.id)) {
    const [w, d] = def.size, hedge = PAL.snow ? '#e8eef0' : C.hedge;
    if (def.cat === 'homes' && w === 1) {
      b.box(0, 0, 0, 0.98, 0.012, 0.98, PAL.snow ? '#eef1f2' : C.lawn);
      b.box(0, 0, -0.44, 0.92, 0.1, 0.08, hedge); b.box(-0.44, 0, -0.12, 0.08, 0.1, 0.56, hedge); b.box(0.44, 0, -0.12, 0.08, 0.1, 0.56, hedge);
      const r2 = rng(seed + 11);
      if (r2() < 0.3) b.mark('cat', -0.3 + r2() * 0.6, 0.1, -0.44);
    } else {
      b.box(0, 0, 0, w - 0.03, 0.012, d - 0.03, PAL.snow ? '#e6e9ea' : C.paving);
      if (def.cat === 'shops' && w === 1 && rng(seed + 5)() < 0.25) b.mark('cat', 0.3, 0.012, 0.4);
    }
  }
  return b.build();
}

export function makeCity(scene, save) {
  const city = {
    R: save.land || 6,
    items: save.items || [],      // { id, i, j, rot, seed }  (i, j = top-left tile)
    grid: new Map(),               // "i,j" -> item index
    stats: { pop: 0, jobs: 0, joy: 0, happiness: 0, connected: 0, buildings: 0 },
  };
  const key = (i, j) => `${i},${j}`;
  city.ground = save.ground || (save.ground = {});
  city.groundAt = (i, j) => city.ground[key(i, j)];
  city.treeBlock = { has: (k) => city.grid.has(k) || CLEARS_TREES.has(city.ground[k]) };
  const group = new THREE.Group(); scene.add(group);
  const groundLayer = makeGround(group, tileToWorld);
  city.updateGround = (night) => groundLayer.update(night);
  city.rebuildGround = () => { groundLayer.rebuild(city.ground); buildDecor(); };
  const mats = materials();
  const meshes = {};
  for (const k of ['solid', 'win', 'glow']) { meshes[k] = new THREE.Mesh(new THREE.BufferGeometry(), mats[k]); meshes[k].castShadow = k !== 'glow'; meshes[k].receiveShadow = k !== 'glow'; group.add(meshes[k]); }
  city.roadMat = mats.solid.clone();
  const roadMesh = new THREE.Mesh(new THREE.BufferGeometry(), city.roadMat); roadMesh.receiveShadow = true; group.add(roadMesh);
  // kerb sides are drawn without received shadows: they're too thin for the shadow map and came out jagged up close
  const roadSide = new THREE.Mesh(new THREE.BufferGeometry(), city.roadMat); group.add(roadSide);
  const roadGlow = new THREE.Mesh(new THREE.BufferGeometry(), mats.glow); group.add(roadGlow);
  function splitFaces(geo) {
    const top = new THREE.BufferGeometry(), side = new THREE.BufferGeometry();
    if (!geo) return [top, side];
    const ny = geo.attributes.normal, keep = [[], []];
    for (let v = 0; v + 2 < ny.count; v += 3) keep[Math.abs(ny.getY(v)) > 0.5 ? 0 : 1].push(v, v + 1, v + 2);
    [top, side].forEach((g, k) => { for (const name of Object.keys(geo.attributes)) { const a = geo.attributes[name], n = a.itemSize, out = new Float32Array(keep[k].length * n); keep[k].forEach((v, i) => { for (let c = 0; c < n; c++) out[i * n + c] = a.array[v * n + c]; }); g.setAttribute(name, new THREE.BufferAttribute(out, n)); } });
    geo.dispose();
    return [top, side];
  }
  city.hidden = new Set(); // items drawn on their own while they pop into place
  const warnMesh = new THREE.Mesh(new THREE.BufferGeometry(), mats.glow); group.add(warnMesh);
  const cache = new Map(); // model geometry per "id:seed"

  // live models leave out parts that movers.js animates; still ones (pop-in, demolition) include them
  function modelOf(it, live = true) {
    const k = `${it.id}:${it.seed}:${it.lvl || 1}:${live ? 1 : 0}`;
    let m = cache.get(k);
    if (!m) { m = buildModel(BY_ID[it.id], it.seed, it.lvl || 1, live); cache.set(k, m); }
    return m;
  }
  function placementMatrix(it) {
    const def = BY_ID[it.id], [w, d] = footprint(def, it.rot);
    const [x0, z0] = tileToWorld(it.i, it.j);
    const m = new THREE.Matrix4().makeRotationY(-it.rot * Math.PI / 2);
    m.setPosition(x0 - 0.5 + w / 2, 0, z0 - 0.5 + d / 2);
    return m;
  }

  function reindex() {
    city.grid.clear();
    city.items.forEach((it, n) => { const [w, d] = footprint(BY_ID[it.id], it.rot); for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) city.grid.set(key(it.i + a, it.j + b), n); });
  }
  const at = (i, j) => { const n = city.grid.get(key(i, j)); return n == null ? null : city.items[n]; };
  const isRoad = (i, j) => { const it = at(i, j); return !!(it && BY_ID[it.id].road); };

  city.canPlace = (id, i, j, rot) => {
    const def = BY_ID[id], [w, d] = footprint(def, rot);
    for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) { if (!inLand(i + a, j + b, city.R)) return false; if (city.grid.has(key(i + a, j + b))) return false; }
    return true;
  };
  city.place = (id, i, j, rot, seed = Math.floor(Math.random() * 1e9)) => { city.items.push({ id, i, j, rot, seed }); reindex(); city.dirty = true; return city.items[city.items.length - 1]; };
  city.itemAt = at;
  city.remove = (it) => { const n = city.items.indexOf(it); if (n >= 0) city.items.splice(n, 1); reindex(); city.dirty = true; };
  city.isRoad = isRoad;
  city.canUpgrade = (it) => canUpgrade(BY_ID[it.id]) && (it.lvl || 1) < 3;
  city.connected = (it) => {
    const def = BY_ID[it.id]; if (def.road || def.path || def.cat === 'nature' || def.fixed) return true;
    const [w, d] = footprint(def, it.rot);
    for (let a = -1; a <= w; a++) for (let b = -1; b <= d; b++) {
      const edge = (a === -1 || a === w) !== (b === -1 || b === d);
      if (edge && isRoad(it.i + a, it.j + b)) return true;
    }
    return false;
  };

  // ---------- Roads: a narrow lane of asphalt with pavements, rounded corners, street lamps ----------
  const RW = 0.28, PW = 0.5 - RW; // half road width, pavement width
  const ASPH = '#6f6a67', PAVE = PAL.snow ? '#e9ecee' : '#ddd2c1', LINE = '#efe4c4';
  const innerShape = new THREE.Shape(); innerShape.moveTo(0.5, -0.5); innerShape.lineTo(0.5, -RW); innerShape.absarc(0.5, -0.5, PW, Math.PI / 2, Math.PI, false); innerShape.lineTo(0.5, -0.5);
  const outerShape = new THREE.Shape(); outerShape.moveTo(-RW, -0.5); outerShape.lineTo(-0.5, -0.5); outerShape.lineTo(-0.5, 0.5); outerShape.lineTo(0.5, 0.5); outerShape.lineTo(0.5, RW); outerShape.absarc(0.5, -0.5, 1 - PW, Math.PI / 2, Math.PI, false);
  const CORNER_ROT = { ne: 0, nw: Math.PI / 2, sw: Math.PI, se: -Math.PI / 2 };
  function buildRoads() {
    const b = new Builder();
    city.lampsFromRoads = [];
    for (const it of city.items) {
      if (!BY_ID[it.id].road) continue;
      const st = ROAD_STYLES[BY_ID[it.id].style || 'asphalt'];
      const [x, z] = tileToWorld(it.i, it.j);
      const n = isRoad(it.i, it.j - 1), s = isRoad(it.i, it.j + 1), w = isRoad(it.i - 1, it.j), e = isRoad(it.i + 1, it.j);
      const links = n + s + w + e;
      { const g = 0.004, x0 = w ? -0.5 : -0.5 + g, x1 = e ? 0.5 : 0.5 - g, z0 = n ? -0.5 : -0.5 + g, z1 = s ? 0.5 : 0.5 - g; b.box(x + (x0 + x1) / 2, -0.04, z + (z0 + z1) / 2, x1 - x0, 0.06, z1 - z0, st.asph); } // reaches below the grass, and sits just inside the kerb so their faces never flicker
      if (st.detail === 'cobble') for (let a = 0; a < 5; a++) for (let c = 0; c < 5; c++) b.box(x - 0.4 + a * 0.2 + (c % 2) * 0.04, 0.02, z - 0.4 + c * 0.2, 0.13, 0.003, 0.13, (a + c) % 3 ? st.mark : '#9a9184');
      if (st.detail === 'brick') for (let c = 0; c < 9; c++) b.box(x, 0.02, z - 0.44 + c * 0.11, 0.98, 0.003, 0.008, st.mark);
      if (st.detail === 'planks') for (let c = 0; c < 9; c++) { if (n || s) b.box(x, 0.02, z - 0.44 + c * 0.11, 0.98, 0.003, 0.008, st.mark); else b.box(x - 0.44 + c * 0.11, 0.02, z, 0.008, 0.003, 0.98, st.mark); }
      if (st.detail === 'ruts') { if (n || s) for (const o of [-0.11, 0.11]) b.box(x + o, 0.02, z, 0.05, 0.003, 0.98, st.mark); if ((w || e) && !(n || s)) for (const o of [-0.11, 0.11]) b.box(x, 0.02, z + o, 0.98, 0.003, 0.05, st.mark); }
      const corner = links === 2 && (n || s) && (w || e) ? `${n ? 'n' : 's'}${e ? 'e' : 'w'}` : null;
      if (corner) {
        const ry = CORNER_ROT[corner];
        b.slab(innerShape, -0.04, 0.09, st.pave, x, z, ry); b.slab(outerShape, -0.04, 0.09, st.pave, x, z, ry);
        continue;
      }
      for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + cx * (0.5 - PW / 2), -0.04, z + cz * (0.5 - PW / 2), PW, 0.09, PW, st.pave);
      if (!n) b.box(x, -0.04, z - 0.5 + PW / 2, RW * 2, 0.09, PW, st.pave);
      if (!s) b.box(x, -0.04, z + 0.5 - PW / 2, RW * 2, 0.09, PW, st.pave);
      if (!w) b.box(x - 0.5 + PW / 2, -0.04, z, PW, 0.09, RW * 2, st.pave);
      if (!e) b.box(x + 0.5 - PW / 2, -0.04, z, PW, 0.09, RW * 2, st.pave);
      const straightNS = links === 2 && n && s, straightEW = links === 2 && w && e;
      if (straightNS && st.line) b.box(x, 0.02, z, 0.03, 0.003, 0.3, st.line);
      if (straightEW && st.line) b.box(x, 0.02, z, 0.3, 0.003, 0.03, st.line);
      if (links >= 3 && st.zebra) { // zebra crossings on each arm
        for (const [on, dx, dz] of [[n, 0, -1], [s, 0, 1], [w, -1, 0], [e, 1, 0]]) if (on) for (let k = 0; k < 4; k++) {
          const o = -0.18 + k * 0.12;
          if (dz) b.box(x + o, 0.02, z + dz * 0.4, 0.06, 0.003, 0.14, st.zebra); else b.box(x + dx * 0.4, 0.02, z + o, 0.14, 0.003, 0.06, st.zebra);
        }
      }
      // a street lamp every few tiles along straight roads
      if (st.lamps !== false && (straightNS || straightEW) && (it.i * 7 + it.j * 3) % 4 === 0) {
        const side = (it.i + it.j) % 2 ? 1 : -1;
        const lx = straightNS ? x + side * (0.5 - PW / 2) : x, lz = straightEW ? z + side * (0.5 - PW / 2) : z;
        b.cyl(lx, 0.05, lz, 0.012, 0.016, 0.42, C.char, 5); b.ball(lx, 0.49, lz, 0.04, '#ffd894', { glow: true }); b.cone(lx, 0.5, lz, 0.055, 0.045, C.char, 6);
        city.lampsFromRoads.push(new THREE.Vector3(lx, 0.49, lz));
      }
    }
    const built = b.build();
    roadMesh.geometry.dispose(); roadSide.geometry.dispose(); [roadMesh.geometry, roadSide.geometry] = splitFaces(built.solid);
    roadGlow.geometry.dispose(); roadGlow.geometry = built.glow || new THREE.BufferGeometry();
  }

  // ---------- Rebuild the merged city meshes ----------
  city.rebuild = () => {
    const lists = { solid: [], win: [], glow: [] }, warn = new Builder();
    city.marks = { smoke: [], lamp: [], green: [], cat: [], pond: [], bench: [], wheel: [], sails: [], carousel: [], clock: [], jet: [] };
    for (const it of city.items) {
      const def = BY_ID[it.id]; if (def.road) continue;
      const m = modelOf(it), M = placementMatrix(it);
      for (const mk of m.marks || []) { if (MOVING.has(mk.kind) && city.hidden.has(it)) continue; const v = new THREE.Vector3(mk.x, mk.y, mk.z).applyMatrix4(M); v.a = (mk.a || 0) - it.rot * Math.PI / 2; city.marks[mk.kind]?.push(v); }
      if (def.cat === 'nature' && !def.path && it.id !== 'lamppost') city.marks.green.push(new THREE.Vector3().setFromMatrixPosition(M));
      if (city.hidden.has(it)) continue;
      for (const k of ['solid', 'win', 'glow']) if (m[k]) { const g = m[k].clone(); g.applyMatrix4(M); lists[k].push(g); }
      if (!city.connected(it)) { const p = new THREE.Vector3().setFromMatrixPosition(M); const h = def.size[0] > 1 ? 1.4 : 1; warn.ball(p.x, h + 0.2, p.z, 0.028, '#ff6b57', { detail: 2, glow: true }); warn.cone(p.x, h + 0.25, p.z, 0.035, 0.11, '#ff6b57', 10, { glow: true }); }
    }
    for (const k of ['solid', 'win', 'glow']) {
      meshes[k].geometry.dispose();
      meshes[k].geometry = lists[k].length ? mergeGeometries(lists[k], false) : new THREE.BufferGeometry();
      for (const g of lists[k]) g.dispose();
    }
    const wb = warn.build(); warnMesh.geometry.dispose(); warnMesh.geometry = wb.glow || new THREE.BufferGeometry();
    buildRoads();
    city.marks.lamp.push(...city.lampsFromRoads);
    groundLayer.rebuild(city.ground); buildDecor();
    computeStats();
    city.dirty = false;
  };

  // ---------- Stats: population, jobs, happiness ----------
  const needsMap = new WeakMap();
  city.needsOf = (it) => needsMap.get(it) || { shop: false, green: false, civic: false };
  function computeStats() {
    let pop = 0, jobs = 0, joySum = 0, needSum = 0, homes = 0, connected = 0, buildings = 0, thriving = 0;
    const joySources = [], sources = { shop: [], green: [], civic: [] };
    for (const it of city.items) {
      const def = BY_ID[it.id], [w, d] = footprint(def, it.rot), cx = it.i + w / 2, cz = it.j + d / 2;
      if (def.joy) joySources.push([cx, cz, def.joy * LEVEL_MULT[it.lvl || 1]]);
      const kind = needKind(def); if (kind && city.connected(it)) sources[kind].push([cx, cz]);
    }
    for (const it of city.items) {
      const def = BY_ID[it.id]; if (def.road || def.path) continue;
      buildings++;
      const ok = city.connected(it); if (ok && !def.road && def.cat !== 'nature') connected++;
      if (!ok) continue;
      if (def.pop) {
        homes++;
        const [w, d] = footprint(def, it.rot), cx = it.i + w / 2, cz = it.j + d / 2, got = {};
        for (const k of Object.keys(NEEDS)) got[k] = sources[k].some(([x, z]) => Math.hypot(x - cx, z - cz) <= NEEDS[k].r);
        needsMap.set(it, got);
        const met = got.shop + got.green + got.civic; needSum += met / 3;
        if (met === 3) thriving++;
        pop += Math.round(def.pop * LEVEL_MULT[it.lvl || 1] * (met === 3 ? 1.2 : 1));
        let j = 0; for (const [x, z, v] of joySources) { const dist = Math.hypot(x - cx, z - cz); if (dist < 5) j += v * (1 - dist / 5); }
        joySum += Math.min(1, j / 6);
      }
      if (def.jobs) jobs += Math.round(def.jobs * LEVEL_MULT[it.lvl || 1]);
    }
    const jobScore = jobs >= pop * 0.4 ? 1 : jobs / Math.max(1, pop * 0.4);
    const happiness = homes ? Math.round((joySum / homes) * 45 + (needSum / homes) * 25 + jobScore * 30) : 0;
    Object.assign(city.stats, { pop, jobs, happiness, connected, buildings, homes, thriving });
  }
  // What placing something here would change, without actually placing it.
  city.preview = (id, i, j, rot) => {
    const before = { ...city.stats }, temp = { id, i, j, rot, seed: 0 };
    city.items.push(temp); reindex(); computeStats();
    const after = { ...city.stats }, open = city.connected(temp);
    city.items.pop(); reindex(); computeStats();
    return { pop: after.pop - before.pop, jobs: after.jobs - before.jobs, joy: after.happiness - before.happiness, open };
  };

  // a ghost of what you're about to build
  city.ghost = (id, seed) => {
    const def = BY_ID[id];
    let built;
    if (def.road) { const b = new Builder(); b.box(0, 0, 0, 1, 0.04, 1, ROAD_STYLES[def.style || 'asphalt'].asph); built = b.build(); } else built = buildModel(def, seed);
    const g = meshesFrom(built);
    g.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.65; o.castShadow = false; } });
    return g;
  };
  city.loadIsland = (d) => { city.items = d.items; city.R = d.land; city.ground = d.ground || (d.ground = {}); city.hidden.clear(); reindex(); };
  // A whole island's real buildings as one model, for the view from the plane.
  city.modelsGroup = (items) => {
    const lists = { solid: [], win: [], glow: [] }, roads = new Builder();
    for (const it of items) {
      const def = BY_ID[it.id]; if (!def) continue;
      if (def.road) { const [x, z] = tileToWorld(it.i, it.j), st = ROAD_STYLES[def.style || 'asphalt']; roads.box(x, 0, z, 1, 0.03, 1, st.asph); continue; }
      const m = modelOf(it, false), M = placementMatrix(it);
      for (const k of ['solid', 'win', 'glow']) if (m[k]) { const g = m[k].clone(); g.applyMatrix4(M); lists[k].push(g); }
    }
    const r = roads.build(); if (r.solid) lists.solid.push(r.solid);
    const built = {}; for (const k of ['solid', 'win', 'glow']) { built[k] = lists[k].length ? mergeGeometries(lists[k], false) : null; for (const g of lists[k]) g.dispose(); }
    const group = meshesFrom(built); group.traverse((o) => { o.userData.sharedMaterial = true; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return group;
  };
  city.walkGeometries = () => [meshes.solid.geometry, roadMesh.geometry, roadSide.geometry];
  city.placementMatrix = placementMatrix;
  city.modelOf = modelOf;

  // ---------- Little things in the grass: tufts and wild flowers on empty land you own ----------
  const tuftG = new THREE.ConeGeometry(0.03, 0.09, 3); tuftG.translate(0, 0.045, 0);
  const flowerG = new THREE.IcosahedronGeometry(0.024, 1); flowerG.translate(0, 0.074, 0);
  const stemG = new THREE.CylinderGeometry(0.004, 0.006, 0.07, 5); stemG.translate(0, 0.035, 0);
  const DEC = 7000;
  const tufts = new THREE.InstancedMesh(tuftG, new THREE.MeshStandardMaterial({ roughness: 1 }), DEC);
  const flowers = new THREE.InstancedMesh(flowerG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), DEC);
  const stems = new THREE.InstancedMesh(stemG, new THREE.MeshStandardMaterial({ color: PAL.snow ? '#c9d4d6' : '#5f8748', roughness: 1 }), DEC);
  tufts.receiveShadow = flowers.receiveShadow = stems.receiveShadow = true; group.add(tufts, flowers, stems);
  const FLOWER_COLS = PAL.snow ? ['#ffffff'] : ['#f3d36b', '#ffffff', '#eca8b0', '#c9a6e0', '#f0a36a'];
  const tuftCol = new THREE.Color(), tuftBase = new THREE.Color(PAL.grass).multiplyScalar(0.72);
  function buildDecor() {
    const M = new THREE.Matrix4(), col = new THREE.Color();
    let nt = 0, nf = 0;
    for (let i = HALF - city.R; i < HALF + city.R; i++) for (let j = HALF - city.R; j < HALF + city.R; j++) {
      if (city.grid.has(key(i, j))) continue;
      const g = city.ground[key(i, j)];
      if (g && g !== 'meadow' && g !== 'forest' && g !== 'grass') continue; // sand, paving and so on stay clear
      tuftCol.set(g === 'forest' ? '#3f6135' : g === 'meadow' ? '#7f9f4d' : PAL.snow ? '#dfe6e8' : tuftBase);
      const r = rng(i * 131 + j * 7919);
      const [x, z] = tileToWorld(i, j);
      for (let k = 0, c = r() < 0.5 ? 0 : 1 + Math.floor(r() * 3); k < c && nt < DEC; k++) { const s = 0.8 + r() * 0.7; M.makeRotationY(r() * 6).scale(new THREE.Vector3(s, s, s)).setPosition(x - 0.45 + r() * 0.9, 0, z - 0.45 + r() * 0.9); tufts.setColorAt(nt, tuftCol); tufts.setMatrixAt(nt++, M); }
      if (g !== 'forest' && r() < (g === 'meadow' ? 0.96 : PAL.snow ? 0.05 : 0.3)) for (let k = 0, c = 1 + Math.floor(r() * 3); k < c && nf < DEC; k++) { M.makeTranslation(x - 0.42 + r() * 0.84, 0, z - 0.42 + r() * 0.84); flowers.setMatrixAt(nf, M); stems.setMatrixAt(nf, M); flowers.setColorAt(nf++, col.set(FLOWER_COLS[Math.floor(r() * FLOWER_COLS.length)])); }
    }
    tufts.count = nt; flowers.count = stems.count = nf; if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    tufts.instanceMatrix.needsUpdate = flowers.instanceMatrix.needsUpdate = stems.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  }
  reindex();
  return city;
}
