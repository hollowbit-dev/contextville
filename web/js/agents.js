// Citizens walk the pavements and use the zebra crossings. Cars keep to their lane, stop for
// anyone crossing and queue behind each other. Both are instanced: one draw call per part.
import * as THREE from 'three';
import { tileToWorld } from './world.js';
import { BY_ID } from './catalog.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { personGeometry, paintPeople, personMaterial, peopleTime } from './people.js';

const MAX_PEOPLE = 240, MAX_CARS = 60;
const COLS = ['#d97757', '#5b6170', '#9bb58e', '#e8b45a', '#8fb4d9', '#c4694a', '#f0e9dc', '#b08ad8', '#e8a0a8'];
const KERB = 0.39;        // people walk this far from the middle of a road tile
const LANE = 0.14;        // cars drive this far from the middle
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export function makeAgents(scene) {
  const personGeo = personGeometry(false), moveAttr = paintPeople(personGeo, MAX_PEOPLE);
  const people = new THREE.InstancedMesh(personGeo, personMaterial(), MAX_PEOPLE);
  // a car with a shaped body, windows all round, four real wheels, headlights and tail lights
  const profile = new THREE.Shape(); profile.moveTo(-0.17, 0.038); profile.lineTo(-0.17, 0.085); profile.quadraticCurveTo(-0.168, 0.1, -0.15, 0.102); profile.lineTo(-0.088, 0.106); profile.lineTo(-0.052, 0.155); profile.lineTo(0.046, 0.155); profile.lineTo(0.098, 0.108); profile.lineTo(0.152, 0.099); profile.quadraticCurveTo(0.172, 0.094, 0.172, 0.075); profile.lineTo(0.172, 0.038); profile.closePath();
  const carG = new THREE.ExtrudeGeometry(profile, { depth: 0.146, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.008, bevelSegments: 2, curveSegments: 6 }); carG.translate(0, 0, -0.073);
  const pane = new THREE.Shape(); pane.moveTo(-0.091, 0.104); pane.lineTo(-0.056, 0.151); pane.lineTo(0.05, 0.151); pane.lineTo(0.101, 0.106); pane.closePath();
  const carTopG = new THREE.ExtrudeGeometry(pane, { depth: 0.166, bevelEnabled: false }); carTopG.translate(0, 0, -0.083);
  const paint = (g, hex) => { const n = g.index ? g.toNonIndexed() : g, col2 = new THREE.Color(hex), a = new Float32Array(n.attributes.position.count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = col2.r; a[i + 1] = col2.g; a[i + 2] = col2.b; } n.setAttribute('color', new THREE.BufferAttribute(a, 3)); n.deleteAttribute('uv'); return n; };
  const wheelG = mergeGeometries([paint(new THREE.CylinderGeometry(0.036, 0.036, 0.032, 16).rotateX(Math.PI / 2), '#26262a'), paint(new THREE.CylinderGeometry(0.019, 0.019, 0.035, 10).rotateX(Math.PI / 2), '#c9ccd2'), paint(new THREE.BoxGeometry(0.056, 0.007, 0.036), '#c9ccd2'), paint(new THREE.BoxGeometry(0.007, 0.056, 0.036), '#c9ccd2')]);
  const lightsG = mergeGeometries([-1, 1].flatMap((z) => [paint(new THREE.BoxGeometry(0.012, 0.018, 0.034).translate(0.176, 0.08, z * 0.052), '#fff1c0'), paint(new THREE.BoxGeometry(0.01, 0.016, 0.034).translate(-0.174, 0.08, z * 0.052), '#ff4a3a')]));
  const cars = new THREE.InstancedMesh(carG, new THREE.MeshStandardMaterial({ roughness: 0.34, metalness: 0.25 }), MAX_CARS);
  const carTops = new THREE.InstancedMesh(carTopG, new THREE.MeshStandardMaterial({ color: '#7f9bb3', roughness: 0.12, metalness: 0.35 }), MAX_CARS);
  const wheels = new THREE.InstancedMesh(wheelG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }), MAX_CARS * 4);
  const lights = new THREE.InstancedMesh(lightsG, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), MAX_CARS);
  for (const m of [people, cars, carTops, wheels]) { m.castShadow = true; m.count = 0; m.frustumCulled = false; scene.add(m); }
  lights.count = 0; lights.frustumCulled = false; scene.add(lights);
  const col = new THREE.Color(), WM = new THREE.Matrix4(), WR = new THREE.Matrix4(), SPOTS = [[0.102, 0.08], [0.102, -0.08], [-0.102, 0.08], [-0.102, -0.08]];
  for (let i = 0; i < MAX_CARS; i++) cars.setColorAt(i, col.set(['#d97757', '#f0e9dc', '#5b6170', '#8fb4d9', '#e8b45a', '#3d3a38', '#9bb58e', '#b23a34'][i % 8]));

  let roads = [], roadSet = new Set();
  const walkers = [], drivers = [], crossings = [], laneOwner = new Map(), junctionOwner = new Map();
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(0.9, 0.9, 0.9), CS = new THREE.Vector3(0.82, 0.82, 0.82), P = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isRoad = (i, j) => roadSet.has(`${i},${j}`);
  const links = (i, j) => DIRS.reduce((n, [a, b]) => n + (isRoad(i + a, j + b) ? 1 : 0), 0);
  const nodeXZ = (n) => { const [x, z] = tileToWorld(n.i, n.j); return [x + n.sx * KERB, z + n.sz * KERB]; };

  // ---------- People: a graph of pavement corners ----------
  function walkOptions(a) {
    const { i, j, sx, sz } = a.at, out = [];
    if (isRoad(i + sx, j)) out.push({ to: { i: i + sx, j, sx: -sx, sz } });
    if (isRoad(i, j + sz)) out.push({ to: { i, j: j + sz, sx, sz: -sz } });
    const junction = links(i, j) >= 3;
    // along this tile's edge: pavement if no road leaves that way, a zebra crossing at a junction
    if (!isRoad(i, j + sz)) out.push({ to: { i, j, sx: -sx, sz } }); else if (junction) out.push({ to: { i, j, sx: -sx, sz }, cross: true });
    if (!isRoad(i + sx, j)) out.push({ to: { i, j, sx, sz: -sz } }); else if (junction) out.push({ to: { i, j, sx, sz: -sz }, cross: true });
    return out;
  }
  function carNear(x, z) {
    for (const c of drivers) {
      if (c.x == null) continue;
      const rx = x - c.x, rz = z - c.z, along = rx * c.hx + rz * c.hz, lat = Math.abs(rx * c.hz - rz * c.hx);
      if (along > -0.42 && along < 1.15 && lat < 0.56) return true;
    }
    return false;
  }
  function nextStep(a) {
    const opts = walkOptions(a);
    if (!opts.length) { a.wait = 1; return; }
    const [x0, z0] = nodeXZ(a.at);
    const scored = opts.map((o) => {
      const [x1, z1] = nodeXZ(o.to), dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
      const ahead = (dx * a.hx + dz * a.hz) / len;
      return { ...o, x1, z1, len, w: (ahead < -0.7 ? 0.03 : ahead > 0.7 ? 1 : 0.45) * (o.cross ? 0.4 : 1) };
    });
    let r = Math.random() * scored.reduce((s, o) => s + o.w, 0), pick = scored[0];
    for (const o of scored) { r -= o.w; if (r <= 0) { pick = o; break; } }
    if (pick.cross && carNear((x0 + pick.x1) / 2, (z0 + pick.z1) / 2)) { a.wait = 0.25 + Math.random() * 0.3; return; } // look both ways
    a.next = pick.to; a.t = 0; a.len = pick.len; a.cross = !!pick.cross; a.mx = (x0 + pick.x1) / 2; a.mz = (z0 + pick.z1) / 2;
    a.hx = (pick.x1 - x0) / pick.len; a.hz = (pick.z1 - z0) / pick.len;
  }
  function newWalker(r) {
    const at = { i: r[0], j: r[1], sx: Math.random() < 0.5 ? 1 : -1, sz: Math.random() < 0.5 ? 1 : -1 };
    const [x, z] = nodeXZ(at);
    return { at, next: null, t: 0, len: 1, cross: false, x, z, hx: 1, hz: 0, ry: 0, speed: 0.3 + Math.random() * 0.2, wait: Math.random() * 2, ph: Math.random() * 6 };
  }

  // ---------- Cars ----------
  // Each stretch of lane (tile to next tile, one direction) holds one car, and a junction holds
  // one car at a time. A car only moves on once it has booked its next stretch, so cars can't
  // overlap. If it stays boxed in, it takes another way out, so traffic can't lock up.
  const laneKey = (i, j, di, dj) => `${i},${j},${di},${dj}`;
  const tileKey = (i, j) => `${i},${j}`;
  function bookNext(a) {
    const ei = a.i + a.di, ej = a.j + a.dj, junction = links(ei, ej) !== 2, jk = tileKey(ei, ej);
    if (junction && junctionOwner.has(jk) && junctionOwner.get(jk) !== a) return;
    const ways = DIRS.filter(([x, y]) => isRoad(ei + x, ej + y) && !laneOwner.has(laneKey(ei, ej, x, y)));
    const forward = ways.filter(([x, y]) => !(x === -a.di && y === -a.dj));
    const deadEnd = !DIRS.some(([x, y]) => isRoad(ei + x, ej + y) && !(x === -a.di && y === -a.dj));
    const pool = forward.length ? forward : (deadEnd || a.boxed > 1.5 ? ways : []);
    if (!pool.length) return;
    const [x, y] = pool[Math.floor(Math.random() * pool.length)];
    laneOwner.set(laneKey(ei, ej, x, y), a); a.nd = [x, y];
    if (junction) { junctionOwner.set(jk, a); a.jun = jk; }
  }
  function release(a) {
    laneOwner.delete(laneKey(a.i, a.j, a.di, a.dj));
    if (a.nd) laneOwner.delete(laneKey(a.i + a.di, a.j + a.dj, a.nd[0], a.nd[1]));
    for (const [k, v] of junctionOwner) if (v === a) junctionOwner.delete(k);
  }
  function newCar(r) {
    const open = DIRS.filter(([x, y]) => isRoad(r[0] + x, r[1] + y) && !laneOwner.has(laneKey(r[0], r[1], x, y)));
    if (!open.length) return null;
    const [di, dj] = open[Math.floor(Math.random() * open.length)];
    const a = { i: r[0], j: r[1], di, dj, nd: null, jun: null, t: Math.random() * 0.5, speed: 1.15 + Math.random() * 0.45, v: 0, x: null, z: null, hx: di, hz: dj, ry: 0, boxed: 0 };
    laneOwner.set(laneKey(a.i, a.j, di, dj), a);
    return a;
  }
  let player = null;
  function yieldToWalkers(a) {
    if (player) { const rx = player.x - a.x, rz = player.z - a.z, along = rx * a.hx + rz * a.hz, lat = Math.abs(rx * a.hz - rz * a.hx); if (along > -0.08 && along < 0.72 && lat < 0.2) return true; }
    for (const c of crossings) for (const [x, z] of [[c.mx, c.mz], [c.x, c.z]]) {
      const rx = x - a.x, rz = z - a.z, along = rx * a.hx + rz * a.hz, lat = Math.abs(rx * a.hz - rz * a.hx);
      if (along > -0.05 && along < 0.86 && lat < 0.5) return true;
    }
    return false;
  }

  function spawn(list, n, make) {
    while (list.length > n) { const a = list.pop(); if (make === newCar) release(a); }
    for (let tries = 0; list.length < n && roads.length && tries < n * 3; tries++) {
      const a = make(roads[Math.floor(Math.random() * roads.length)]);
      if (a) list.push(a);
    }
  }

  return {
    setPlayer(p) { player = p; },
    carBlocks(x, z, r) { for (const c of drivers) { if (c.x == null) continue; const rx = x - c.x, rz = z - c.z; if (Math.abs(rx * c.hx + rz * c.hz) < 0.15 + r && Math.abs(rx * c.hz - rz * c.hx) < 0.08 + r) return true; } return false; },
    setRoads(city) {
      roads = city.items.filter((it) => BY_ID[it.id].road).map((it) => [it.i, it.j]);
      roadSet = new Set(roads.map(([i, j]) => `${i},${j}`));
      for (let k = walkers.length - 1; k >= 0; k--) { const a = walkers[k]; if (!isRoad(a.at.i, a.at.j) || (a.next && !isRoad(a.next.i, a.next.j))) walkers.splice(k, 1); }
      laneOwner.clear(); junctionOwner.clear();
      for (let k = drivers.length - 1; k >= 0; k--) {
        const a = drivers[k];
        if (!isRoad(a.i, a.j) || !isRoad(a.i + a.di, a.j + a.dj) || laneOwner.has(laneKey(a.i, a.j, a.di, a.dj))) { drivers.splice(k, 1); continue; }
        laneOwner.set(laneKey(a.i, a.j, a.di, a.dj), a); a.nd = null; a.jun = null;
      }
    },
    setCounts(pop, night) {
      spawn(walkers, Math.min(MAX_PEOPLE, Math.round(pop * (night > 0.7 ? 0.12 : 0.4))), newWalker);
      spawn(drivers, Math.min(MAX_CARS, Math.floor(roads.length / 4), Math.round(pop / 10) + (roads.length > 6 ? 2 : 0)), newCar);
    },
    update(dt, night) {
      // ---- people ----
      peopleTime.value += dt;
      crossings.length = 0;
      let n = 0;
      for (const a of walkers) {
        if (a.wait > 0) a.wait -= dt;
        else if (!a.next) nextStep(a);
        if (a.next) {
          a.t += (dt * a.speed) / a.len;
          if (a.t >= 1) { a.at = a.next; a.next = null; a.t = 0; a.cross = false; if (Math.random() < 0.05) a.wait = 1 + Math.random() * 3; }
        }
        const [x0, z0] = nodeXZ(a.at);
        if (a.next) { const [x1, z1] = nodeXZ(a.next); a.x = x0 + (x1 - x0) * a.t; a.z = z0 + (z1 - z0) * a.t; } else { a.x = x0; a.z = z0; }
        if (a.cross) crossings.push(a);
        let d = Math.atan2(a.hx, a.hz) - a.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); a.ry += d * damp(10, dt);
        const bob = a.next ? Math.abs(Math.sin(peopleTime.value * 9.5 + n * 2.399)) * 0.004 : 0; a.mv = (a.mv || 0) + ((a.next ? 1 : 0) - (a.mv || 0)) * damp(9, dt); moveAttr.array[n] = a.mv;
        Q.setFromAxisAngle(Y, a.ry); P.set(a.x, (a.cross ? 0.024 : 0.05) + bob, a.z); M.compose(P, Q, S);
        people.setMatrixAt(n, M); n++;
      }
      people.count = n; people.instanceMatrix.needsUpdate = true; moveAttr.needsUpdate = true;
      // ---- cars ----
      let c = 0;
      for (const a of drivers) {
        if (a.x == null) { const [tx, tz] = tileToWorld(a.i, a.j); a.x = tx + a.di * a.t - a.dj * LANE; a.z = tz + a.dj * a.t + a.di * LANE; a.ry = Math.atan2(-a.dj, a.di); a.hx = a.di; a.hz = a.dj; }
        if (!a.nd && a.t > 0.3) bookNext(a);
        const limit = a.nd ? 2 : 0.56, room = limit - a.t;
        a.boxed = !a.nd && a.t > 0.5 ? a.boxed + dt : 0;
        const want = yieldToWalkers(a) ? 0 : Math.min(a.speed, Math.max(0, room * 5));
        a.v += (want - a.v) * damp(want < a.v ? 16 : 3.5, dt);
        if (want === 0 && a.v < 0.015) a.v = 0;
        a.t = Math.min(a.t + dt * a.v, a.nd ? 9 : Math.max(a.t, limit));
        if (a.t >= 1 && a.nd) {
          laneOwner.delete(laneKey(a.i, a.j, a.di, a.dj));
          a.i += a.di; a.j += a.dj; [a.di, a.dj] = a.nd; a.nd = null; a.t -= 1;
        }
        if (a.jun && a.jun === tileKey(a.i, a.j) && a.t > 0.42) { junctionOwner.delete(a.jun); a.jun = null; }
        const [ax, az] = tileToWorld(a.i, a.j), k = damp(11, dt); // ease through turns instead of snapping
        a.x += (ax + a.di * a.t - a.dj * LANE - a.x) * k; a.z += (az + a.dj * a.t + a.di * LANE - a.z) * k;
        let d = Math.atan2(-a.dj, a.di) - a.ry; d = Math.atan2(Math.sin(d), Math.cos(d)); a.ry += d * damp(9, dt);
        a.hx = Math.cos(a.ry); a.hz = -Math.sin(a.ry);
        Q.setFromAxisAngle(Y, a.ry); P.set(a.x, 0.02, a.z); M.compose(P, Q, CS);
        cars.setMatrixAt(c, M); carTops.setMatrixAt(c, M); lights.setMatrixAt(c, M); a.roll = (a.roll || 0) + (dt * a.v) / 0.03;
        WR.makeRotationZ(-a.roll); SPOTS.forEach(([wx, wz], w) => { WM.makeTranslation(wx, 0.036, wz).multiply(WR).premultiply(M); wheels.setMatrixAt(c * 4 + w, WM); }); c++;
      }
      cars.count = carTops.count = c; wheels.count = c * 4; lights.count = night > 0.4 ? c : 0; wheels.instanceMatrix.needsUpdate = true;
      cars.instanceMatrix.needsUpdate = carTops.instanceMatrix.needsUpdate = lights.instanceMatrix.needsUpdate = true;
    },
    // for automated tests: is anyone being hit, or walking on the road outside a crossing?
    audit() {
      let hits = 0, onRoad = 0;
      for (const p of walkers) {
        for (const c of drivers) {
          if (c.x == null) continue;
          const rx = p.x - c.x, rz = p.z - c.z, along = Math.abs(rx * c.hx + rz * c.hz), lat = Math.abs(rx * c.hz - rz * c.hx);
          if (along < 0.175 && lat < 0.11) hits++;
        }
        if (p.cross) continue;
        const i = Math.floor(p.x + 24), j = Math.floor(p.z + 24);
        if (!isRoad(i, j)) continue;
        const [tx, tz] = tileToWorld(i, j), lx = p.x - tx, lz = p.z - tz;
        if ((Math.abs(lx) < 0.28 && Math.abs(lz) < 0.28) || (Math.abs(lx) < 0.28 && isRoad(i, j + Math.sign(lz))) || (Math.abs(lz) < 0.28 && isRoad(i + Math.sign(lx), j))) onRoad++;
      }
      let carOverlaps = 0;
      for (let x = 0; x < drivers.length; x++) for (let y = x + 1; y < drivers.length; y++) { const a = drivers[x], b = drivers[y]; if (a.x != null && b.x != null && Math.hypot(a.x - b.x, a.z - b.z) < 0.13) carOverlaps++; }
      let moving = 0; for (const a of drivers) if (a.v > 0.05) moving++;
      return { hits, onRoad, carOverlaps, moving, walkers: walkers.length, cars: drivers.length, crossing: crossings.length };
    },
  };
}
