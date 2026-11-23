// Walk mode: become a small person in your own city. Buildings, trees and cars are solid, and
// kerbs and low steps are walked up. Collisions come from a fine map made from the real models.
import * as THREE from 'three';
import { BY_ID } from './catalog.js';
import { worldToTile, tileToWorld } from './world.js';

let GRID = 760, ORIGIN = -38, ISLE = 36; const CELL = 0.1;  // a 76 x 76 world in 10 cm-of-a-tile cells
const STEP = 0.075, BODY = 0.24, RADIUS = 0.05;
const WALK = 0.82, RUN = 1.75, GRAVITY = 5.2, JUMP = 1.32;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const onPier = (x, z) => Math.abs(x - 5.5) < 0.42 && z > ISLE + 0.4 && z < ISLE + 8;

function makeAvatar() {
  const g = new THREE.Group();
  const mat = (color, roughness = 0.75) => new THREE.MeshStandardMaterial({ color, roughness });
  const skin = mat('#e8c4a8'), top = mat('#d97757'), legsM = mat('#3f4654'), shoe = mat('#f0e9dc'), hair = mat('#4b3a32');
  const part = (geo, m, parent, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const limb = (x, y, len, r, m, end, endM) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); g.add(pivot);
    part(new THREE.CapsuleGeometry(r, len, 3, 8), m, pivot, 0, -len / 2 - r / 2, 0);
    if (end) part(end, endM, pivot, 0, -len - r * 1.1, end.type === 'BoxGeometry' ? -0.008 : 0);
    return pivot;
  };
  part(new THREE.CapsuleGeometry(0.034, 0.052, 4, 12), top, g, 0, 0.118, 0);
  const head = part(new THREE.SphereGeometry(0.034, 18, 14), skin, g, 0, 0.19, 0);
  part(new THREE.SphereGeometry(0.0358, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56).rotateX(0.3), hair, head);
  const legL = limb(-0.017, 0.082, 0.052, 0.012, legsM, new THREE.BoxGeometry(0.024, 0.014, 0.04), shoe);
  const legR = limb(0.017, 0.082, 0.052, 0.012, legsM, new THREE.BoxGeometry(0.024, 0.014, 0.04), shoe);
  const armL = limb(-0.043, 0.15, 0.046, 0.0095, top, new THREE.SphereGeometry(0.011, 8, 6), skin);
  const armR = limb(0.043, 0.15, 0.046, 0.0095, top, new THREE.SphereGeometry(0.011, 8, 6), skin);
  return { g, legL, legR, armL, armR };
}

export function makeWalker({ scene, camera, controls, canvas, getCity, getAgents, world, sfx, onEnter, onInteract, onLeave }) {
  let block = new Uint8Array(GRID * GRID), floorMap = new Uint8Array(GRID * GRID), tops = new Uint8Array(GRID * GRID);
  const av = makeAvatar(); av.g.visible = false; scene.add(av.g);
  const pos = new THREE.Vector3(), held = {}, saved = {};
  const introFrom = new THREE.Vector3(), introQ = new THREE.Quaternion(), wantP = new THREE.Vector3(), wantQ = new THREE.Quaternion(), look = new THREE.Vector3(), head = new THREE.Vector3(), euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let on = false, yaw = 0, pitch = -0.12, vx = 0, vz = 0, vy = 0, air = false, facing = 0, phase = 0, firstPerson = false, camDist = 0.66, liveDist = 0.66;
  let room = null; const outside = new THREE.Vector3(); let outsideYaw = 0;
  let menuClosedAt = -1e9, menu = false, target = null, everLocked = false, speedUntil = 0, jumpUntil = 0, eatT = 0;
  let intro = 1, locked = false, noLock = false, lostLockAt = 0, dragging = false, placeT = 0, hintT = 0;
  const $ = (s) => document.querySelector(s);
  const cellOf = (v) => Math.floor((v - ORIGIN) / CELL);

  // ---------- collision map ----------
  function stamp(ix, iz, isBlock, top) {
    if (ix < 0 || iz < 0 || ix >= GRID || iz >= GRID) return;
    const c = iz * GRID + ix; if (isBlock) block[c] = 1; if (top > tops[c]) tops[c] = top;
  }
  function buildMap() {
    if (world.radius !== ISLE) { ISLE = world.radius; ORIGIN = -Math.ceil(ISLE + 2); GRID = Math.ceil((-ORIGIN * 2) / CELL); block = new Uint8Array(GRID * GRID); floorMap = new Uint8Array(GRID * GRID); tops = new Uint8Array(GRID * GRID); }
    block.fill(0); floorMap.fill(0); tops.fill(0);
    for (const geo of getCity().walkGeometries()) {
      const a = geo.attributes.position?.array; if (!a) continue;
      for (let i = 0; i + 8 < a.length; i += 9) {
        const ax = a[i], ay = a[i + 1], az = a[i + 2], bx = a[i + 3], by = a[i + 4], bz = a[i + 5], cx = a[i + 6], cy = a[i + 7], cz = a[i + 8];
        const lo = Math.min(ay, by, cy), hi = Math.max(ay, by, cy), area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (hi <= STEP && hi - lo > 0.004) continue;         // the low side of a kerb
        const isFloor = hi <= STEP, isBlock = !isFloor && lo < BODY, top = Math.min(255, Math.ceil(hi * 40));
        if (Math.abs(area) > 0.0004) {                       // anything with a footprint: fill it
          const x0 = clamp(cellOf(Math.min(ax, bx, cx)), 0, GRID - 1), x1 = clamp(cellOf(Math.max(ax, bx, cx)), 0, GRID - 1), z0 = clamp(cellOf(Math.min(az, bz, cz)), 0, GRID - 1), z1 = clamp(cellOf(Math.max(az, bz, cz)), 0, GRID - 1), s = Math.sign(area), e = -0.0001;
          for (let iz = z0; iz <= z1; iz++) for (let ix = x0; ix <= x1; ix++) {
            const px = ORIGIN + (ix + 0.5) * CELL, pz = ORIGIN + (iz + 0.5) * CELL;
            if (s * ((bx - ax) * (pz - az) - (bz - az) * (px - ax)) < e || s * ((cx - bx) * (pz - bz) - (cz - bz) * (px - bx)) < e || s * ((ax - cx) * (pz - cz) - (az - cz) * (px - cx)) < e) continue;
            if (isFloor) { const c = iz * GRID + ix, f = Math.round(hi * 1000); if (f > floorMap[c]) floorMap[c] = f; } else stamp(ix, iz, isBlock, top);
          }
        }
        if (isFloor) continue;
        for (const [px, pz, qx, qz] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]]) {  // walls have no footprint: trace their edges
          const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / (CELL * 0.5)));
          for (let k = 0; k <= n; k++) stamp(cellOf(px + ((qx - px) * k) / n), cellOf(pz + ((qz - pz) * k) / n), isBlock, top);
        }
      }
    }
    for (const t of world.liveTrees()) {
      const r = Math.max(0.06, 0.075 * t.s), n = Math.ceil(r / CELL);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) if (Math.hypot(a * CELL, b * CELL) <= r) stamp(cellOf(t.x) + a, cellOf(t.z) + b, true, Math.ceil(t.s * 40));
    }
    sealInsides();
  }
  // Anything you can't reach from the shore is the inside of a building: make it solid too.
  function sealInsides() {
    const seen = new Uint8Array(GRID * GRID), stack = new Int32Array(GRID * GRID); let top = 0;
    const push = (c) => { if (!seen[c] && !block[c]) { seen[c] = 1; stack[top++] = c; } };
    for (let k = 0, all = Math.ceil(ISLE * 20); k < all; k++) { const a = (k / all) * Math.PI * 2, ix = cellOf(Math.cos(a) * (ISLE + 0.8)), iz = cellOf(Math.sin(a) * (ISLE + 0.8)); push(iz * GRID + ix); }
    while (top) {
      const c = stack[--top], ix = c % GRID;
      if (ix > 0) push(c - 1); if (ix < GRID - 1) push(c + 1); if (c >= GRID) push(c - GRID); if (c < GRID * (GRID - 1)) push(c + GRID);
    }
    for (let c = 0; c < block.length; c++) if (!seen[c]) block[c] = 1;
  }
  const terrain = (x, z) => { if (onPier(x, z)) return -0.14; const r = Math.hypot(x, z); const top = ISLE * (35.5 / 36), edge = ISLE * (36.2 / 36); return r < top ? -0.003 : r < edge ? -0.003 - ((r - top) / (edge - top)) * 0.197 : -0.2; };
  const floorAt = (x, z) => { if (room) return 0; const ix = cellOf(x), iz = cellOf(z), f = ix >= 0 && iz >= 0 && ix < GRID && iz < GRID ? floorMap[iz * GRID + ix] : 0; return f ? Math.max(terrain(x, z), f / 1000) : terrain(x, z); };
  const inWorld = (x, z) => Math.hypot(x, z) < ISLE * (37.35 / 36) || onPier(x, z);
  const hitCell = (x, z) => { const ix = cellOf(x), iz = cellOf(z); return ix < 0 || iz < 0 || ix >= GRID || iz >= GRID || block[iz * GRID + ix] === 1; };
  const solid = (x, z) => room ? room.solid(x, z) : !inWorld(x, z) || hitCell(x, z) || hitCell(x + RADIUS, z) || hitCell(x - RADIUS, z) || hitCell(x, z + RADIUS) || hitCell(x, z - RADIUS) || hitCell(x + RADIUS * 0.7, z + RADIUS * 0.7) || hitCell(x - RADIUS * 0.7, z + RADIUS * 0.7) || hitCell(x + RADIUS * 0.7, z - RADIUS * 0.7) || hitCell(x - RADIUS * 0.7, z - RADIUS * 0.7);
  const carHit = (x, z) => !room && !!getAgents()?.carBlocks?.(x, z, RADIUS);
  function spawnNear(x, z) {
    for (let r = 0; r < ISLE * 0.5; r += 0.08) for (let k = 0, n = Math.max(1, Math.ceil(r * 16)); k < n; k++) {
      const a = (k / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (!solid(px, pz) && !carHit(px, pz) && Math.hypot(px, pz) < ISLE - 1) return [px, pz];
    }
    return [x, z];
  }

  // You arrive in the middle of the nearest road, preferably a straight stretch, looking along it.
  function roadSpawn(x, z, lx, lz) {
    const city = getCity(); let best = null, bestScore = Infinity;
    for (const it of city.items) {
      if (!BY_ID[it.id].road) continue;
      const [rx, rz] = tileToWorld(it.i, it.j), ns = city.isRoad(it.i, it.j - 1) && city.isRoad(it.i, it.j + 1), ew = city.isRoad(it.i - 1, it.j) && city.isRoad(it.i + 1, it.j), straight = ns !== ew;
      const score = Math.hypot(rx - x, rz - z) + (straight ? 0 : 2.5);
      if (score >= bestScore || solid(rx, rz) || carHit(rx, rz)) continue;
      bestScore = score; best = { x: rx, z: rz, ns, ew };
    }
    if (!best) return null;
    const along = best.ew && !best.ns ? [[-Math.PI / 2, 1, 0], [Math.PI / 2, -1, 0]] : best.ns && !best.ew ? [[0, 0, -1], [Math.PI, 0, 1]] : [[0, 0, -1], [Math.PI, 0, 1], [-Math.PI / 2, 1, 0], [Math.PI / 2, -1, 0]];
    best.yaw = along.reduce((a, b) => (b[1] * lx + b[2] * lz > a[1] * lx + a[2] * lz ? b : a))[0];
    return best;
  }

  // ---------- entering and leaving ----------
  function enter() {
    if (on) return;
    onEnter?.();
    saved.pos = camera.position.clone(); saved.target = controls.target.clone(); saved.fov = camera.fov; saved.near = camera.near; saved.far = camera.far;
    buildMap();
    camera.getWorldDirection(look);
    const road = roadSpawn(controls.target.x, controls.target.z, look.x, look.z), [x, z] = road ? [road.x, road.z] : spawnNear(controls.target.x, controls.target.z);
    pos.set(x, floorAt(x, z), z);
    yaw = road ? road.yaw : Math.atan2(-look.x, -look.z); facing = yaw; pitch = -0.1;
    vx = vz = vy = 0; air = false; intro = 0; liveDist = camDist; introFrom.copy(camera.position); introQ.copy(camera.quaternion);
    controls.enabled = false; on = true; av.g.visible = !firstPerson;
    camera.near = 0.04; camera.far = 460; camera.fov = 64; camera.updateProjectionMatrix();
    document.body.classList.toggle('firstperson', firstPerson);
    getAgents()?.setPlayer?.(pos);
    document.body.classList.add('walking'); $('#walkPause').hidden = true; $('#walkKeys').classList.remove('gone'); hintT = 9; $('#walkPlace').textContent = '';
    requestLock();
  }
  function leave() {
    if (!on) return;
    if (room) exitRoom();
    on = false; menu = false; onLeave?.(); for (const k in held) held[k] = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    av.g.visible = false; getAgents()?.setPlayer?.(null);
    document.body.classList.remove('firstperson');
    camera.fov = saved.fov; camera.near = saved.near; camera.far = saved.far; camera.updateProjectionMatrix();
    camera.position.copy(saved.pos); controls.target.copy(saved.target); controls.enabled = true; controls.update();
    document.body.classList.remove('walking'); $('#walkPause').hidden = true;
  }
  function enterRoom(r) {
    outside.copy(pos); outsideYaw = yaw; room = r; r.scene.add(av.g); getAgents()?.setPlayer?.(null);
    pos.set(r.spawn.x, 0, r.spawn.z); yaw = facing = r.spawn.yaw; pitch = -0.08; vx = vz = vy = 0; air = false; liveDist = 0.34; intro = 1; target = null; placeT = 0;
  }
  function exitRoom() {
    const r = room; room = null; scene.add(av.g); pos.copy(outside); yaw = facing = outsideYaw + Math.PI; pitch = -0.1; vx = vz = vy = 0; air = false; liveDist = camDist; intro = 1; target = null; placeT = 0;
    getAgents()?.setPlayer?.(pos); r.dispose();
  }
  function requestLock() {
    if (noLock || !canvas.requestPointerLock) { noLock = true; return; }
    try { const r = canvas.requestPointerLock(); if (r?.catch) r.catch(() => { if (!on || menu) return; if (everLocked) $('#walkPause').hidden = false; else { noLock = true; $('#walkPause').hidden = true; } }); } catch { noLock = true; }
  }
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (locked && (!on || menu)) { document.exitPointerLock(); return; } // the lock arrived after you'd already left or opened a menu
    if (locked) everLocked = true;
    if (on && !locked) { lostLockAt = performance.now(); for (const k in held) held[k] = false; if (!menu && performance.now() - menuClosedAt > 500) $('#walkPause').hidden = false; }
    if (locked) $('#walkPause').hidden = true;
  });
  document.addEventListener('pointerlockerror', () => { noLock = true; if (on) $('#walkPause').hidden = true; });
  $('#walkResume').onclick = () => { $('#walkPause').hidden = true; requestLock(); };
  $('#walkLeave').onclick = leave;

  // ---------- input ----------
  const turn = (dx, dy) => { yaw -= dx * 0.0024; pitch = clamp(pitch - dy * 0.0022, -1.25, 1.1); };
  addEventListener('keydown', (e) => {
    if (!on || e.target.matches?.('input[type=text]')) return;
    if (!$('#modal').hidden || menu) return;
    if (e.code === 'KeyE' && !e.repeat) { findTarget(); if (target) onInteract?.(target); return; }
    if (e.code === 'Escape') { if (performance.now() - lostLockAt > 260) { if (!locked && !$('#walkPause').hidden) leave(); else if (locked) document.exitPointerLock(); else leave(); } return; }
    if (e.code === 'KeyP') { leave(); return; }
    if (e.code === 'KeyV' && !e.repeat) { firstPerson = !firstPerson; av.g.visible = !firstPerson; document.body.classList.toggle('firstperson', firstPerson); }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space' && !air && !e.repeat) { air = true; vy = JUMP * (performance.now() < jumpUntil ? 1.55 : 1); }
    held[e.code] = true;
  });
  addEventListener('keyup', (e) => { held[e.code] = false; });
  addEventListener('blur', () => { for (const k in held) held[k] = false; });
  canvas.addEventListener('pointerdown', (e) => { if (!on || menu) return; if (!locked && !noLock && e.button === 0) requestLock(); dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  addEventListener('pointermove', (e) => { if (on && !menu && (locked || dragging) && intro >= 1 && $('#modal').hidden) turn(e.movementX || 0, e.movementY || 0); });
  canvas.addEventListener('wheel', (e) => { if (on && !firstPerson) camDist = clamp(camDist * (1 + e.deltaY * 0.001), 0.34, 1.9); }, { passive: true });

  // ---------- each frame ----------
  function move(dt) {
    const fwd = (held.KeyW || held.ArrowUp ? 1 : 0) - (held.KeyS || held.ArrowDown ? 1 : 0), side = (held.KeyD || held.ArrowRight ? 1 : 0) - (held.KeyA || held.ArrowLeft ? 1 : 0);
    const run = held.ShiftLeft || held.ShiftRight, speed = (run ? RUN : WALK) * (performance.now() < speedUntil ? 1.5 : 1), len = Math.hypot(fwd, side) || 1, s = Math.sin(yaw), c = Math.cos(yaw);
    const wx = fwd || side ? ((-s * fwd + c * side) / len) * speed : 0, wz = fwd || side ? ((-c * fwd - s * side) / len) * speed : 0, k = 1 - Math.exp(-(air ? 3.5 : 13) * dt);
    vx += (wx - vx) * k; vz += (wz - vz) * k;
    const dist = Math.hypot(vx, vz) * dt, steps = Math.max(1, Math.ceil(dist / 0.035));  // small steps, so nothing can be walked through
    for (let n = 0; n < steps; n++) {
      const dx = (vx * dt) / steps, dz = (vz * dt) / steps, stuck = carHit(pos.x, pos.z);
      if (!solid(pos.x + dx, pos.z) && (stuck || !carHit(pos.x + dx, pos.z))) pos.x += dx; else vx *= 0.5;
      if (!solid(pos.x, pos.z + dz) && (stuck || !carHit(pos.x, pos.z + dz))) pos.z += dz; else vz *= 0.5;
    }
    const ground = floorAt(pos.x, pos.z);
    if (air) { vy -= GRAVITY * dt; pos.y += vy * dt; if (pos.y <= ground && vy <= 0) { pos.y = ground; air = false; vy = 0; footstep(1.5); } }
    else { pos.y += (ground - pos.y) * (1 - Math.exp(-20 * dt)); }
    const moving = Math.hypot(vx, vz);
    if (moving > 0.08) { let d = Math.atan2(-vx, -vz) - facing; d = Math.atan2(Math.sin(d), Math.cos(d)); facing += d * (1 - Math.exp(-13 * dt)); }
    const before = Math.floor(phase / Math.PI);
    phase = moving > 0.06 ? phase + dt * (5.2 + moving * 7.4) : phase * Math.exp(-9 * dt);
    if (!air && moving > 0.25 && Math.floor(phase / Math.PI) !== before) footstep(moving > 1.2 ? 1.2 : 1);
    return moving;
  }
  function footstep(v) {
    if (room) { sfx.step?.('wood', v * 0.7); return; }
    const city = getCity(), [i, j] = worldToTile(pos.x, pos.z), it = city.itemAt(i, j), r = Math.hypot(pos.x, pos.z);
    const style = it && BY_ID[it.id].road ? BY_ID[it.id].style || 'asphalt' : null, g = city.groundAt(i, j);
    sfx.step?.(onPier(pos.x, pos.z) || style === 'boardwalk' ? 'wood' : r > ISLE * 0.99 || style === 'beach' || (!it && g === 'sand') ? 'sand' : style === 'dirt' || style === 'trail' ? 'grass' : style || (it && BY_ID[it.id].path) || (!it && (g === 'paving' || g === 'pebbles')) ? 'stone' : 'grass', v);
  }
  function pose(moving) {
    const amt = clamp(moving / RUN, 0, 1), swing = Math.sin(phase) * (0.32 + amt * 0.62);
    av.g.position.set(pos.x, pos.y + (air ? 0 : Math.abs(Math.cos(phase)) * 0.006 * Math.min(1, moving * 2)), pos.z);
    av.g.rotation.set(-amt * 0.13, facing, 0, 'YXZ');
    if (air) { av.legL.rotation.x = 0.55; av.legR.rotation.x = -0.4; av.armL.rotation.x = -1.9; av.armR.rotation.x = -1.7; return; }
    av.legL.rotation.x = -swing; av.legR.rotation.x = swing; av.armL.rotation.x = swing * 0.8; av.armR.rotation.x = eatT > 0 ? -2.45 + Math.sin(eatT * 22) * 0.16 : -swing * 0.8;
  }
  function placeCamera(dt, moving) {
    euler.set(pitch, yaw, 0); wantQ.setFromEuler(euler); look.set(0, 0, -1).applyQuaternion(wantQ);
    if (firstPerson) { const bob = reduced ? 0 : Math.sin(phase * 2) * 0.004 * Math.min(1, moving); wantP.set(pos.x + look.x * 0.045, pos.y + 0.195 + bob, pos.z + look.z * 0.045); liveDist = camDist; }
    else {
      head.set(pos.x, pos.y + 0.2, pos.z);
      let free = camDist;
      for (let d = 0.08; d <= camDist; d += 0.035) {  // the camera slides in rather than going through a wall
        const x = head.x - look.x * d, y = head.y - look.y * d, z = head.z - look.z * d, ix = cellOf(x), iz = cellOf(z);
        if (room ? (y < 0.035 || y > room.H - 0.03 || room.wall(x, z)) : (y < floorAt(x, z) + 0.035 || (ix >= 0 && iz >= 0 && ix < GRID && iz < GRID && y < tops[iz * GRID + ix] / 40 + 0.02))) { free = Math.max(0.1, d - 0.05); break; }
      }
      liveDist = free < liveDist ? free : liveDist + (free - liveDist) * (1 - Math.exp(-5 * dt));
      wantP.copy(head).addScaledVector(look, -liveDist);
      av.g.visible = liveDist > 0.16;
    }
    if (intro < 1) { intro = Math.min(1, intro + dt / 0.85); const e = intro * intro * (3 - 2 * intro); camera.position.lerpVectors(introFrom, wantP, e); camera.quaternion.slerpQuaternions(introQ, wantQ, e); }
    else { camera.position.copy(wantP); camera.quaternion.copy(wantQ); }
  }
  function nearby(dt) {
    if (hintT > 0) { hintT -= dt; if (hintT <= 0) $('#walkKeys').classList.add('gone'); }
    placeT -= dt; if (placeT > 0) return; placeT = 0.2;
    findTarget();
    const def = target && !target.kind && BY_ID[target.id], name = target?.kind ? `${target.label} · press E` : def ? `${target.nick || def.name} · press E` : '';
    if ($('#walkPlace').textContent !== name) { $('#walkPlace').textContent = name; $('#walkPlace').classList.toggle('on', !!name); }
  }
  function findTarget() {
    if (room) { target = room.near(pos.x, pos.z); return; }
    const city = getCity(), s = Math.sin(yaw), c = Math.cos(yaw); target = null;
    for (const d of [0, 0.2, 0.42, 0.65, 0.85]) { const [i, j] = worldToTile(pos.x - s * d, pos.z - c * d), it = city.itemAt(i, j); if (it && !BY_ID[it.id].road && !BY_ID[it.id].path) { target = it; return; } }
  }

  return {
    get on() { return on; }, pos, enter, leave, enterRoom, exitRoom,
    get room() { return room; }, get renderScene() { return room ? room.scene : null; }, get worldPos() { return room ? outside : pos; },
    get yaw() { return yaw; }, get target() { return target; }, get menu() { return menu; },
    setMenu(v) { menu = v; for (const k in held) held[k] = false; if (v) { $('#walkPause').hidden = true; if (document.pointerLockElement === canvas) document.exitPointerLock(); } else { menuClosedAt = performance.now(); if (on) requestLock(); } },
    boost(speedSecs, jumpSecs) { const now = performance.now(); if (speedSecs) speedUntil = Math.max(speedUntil, now) + speedSecs * 1000; if (jumpSecs) jumpUntil = Math.max(jumpUntil, now) + jumpSecs * 1000; },
    gesture() { eatT = 0.75; },
    update(dt) {
      if (!on) return;
      const paused = menu || !$('#modal').hidden || (!locked && !noLock && !$('#walkPause').hidden);
      if (paused) for (const k in held) held[k] = false;
      if (!$('#modal').hidden && locked) document.exitPointerLock();
      eatT = Math.max(0, eatT - dt);
      const moving = move(dt);
      pose(moving); placeCamera(dt, moving); nearby(dt);
    },
    // for automated tests
    test: { held, solid, floorAt, set(x, z, y = 0) { pos.set(x, floorAt(x, z), z); vx = vz = 0; yaw = y; intro = 1; }, get firstPerson() { return firstPerson; }, setFirst(v) { firstPerson = v; av.g.visible = !v; document.body.classList.toggle('firstperson', v); }, noLock() { noLock = true; $('#walkPause').hidden = true; } },
  };
}
