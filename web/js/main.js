// Contextville: build a city with the tokens Claude writes for you.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { makeWorld, worldToTile, tileToWorld, HALF, inLand } from './world.js';
import { makeCity, footprint, rng, NEEDS } from './city.js';
import { makeAgents } from './agents.js';
import { makeSfx } from './sfx.js';
import { makeLife } from './life.js';
import { makeMovers } from './movers.js';
import { makeWalker } from './walker.js';
import { makeRoom, hasInside } from './interior.js';
import { makeFlight } from './flight.js';
import { makeInteract, missingOffers, offersFor } from './interact.js';
import { ROAD_STYLES, CATALOG, CATEGORIES, BY_ID, LAND, MILESTONES, ERAS, eraIndex, LEVEL_MULT, upgradeCost, investedIn } from './catalog.js';
import { Builder, materials, meshesFrom } from './models.js';

const $ = (s) => document.querySelector(s);
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : Math.round(n).toLocaleString());
const sfx = makeSfx();
addEventListener('pointerdown', () => sfx.ensure(), { capture: true });

// ---------- Renderer, scene, camera ----------
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Render at the screen's full sharpness. Only step down if this computer really can't keep up.
const MAX_PR = Math.min(devicePixelRatio || 1, 2);
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.3, 900);
camera.position.set(8.5, 9.5, 11);
const controls = new MapControls(camera, canvas);
controls.target.set(0, 0, 0); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 5; controls.maxDistance = 75; controls.maxPolarAngle = 1.22; controls.screenSpacePanning = false;
controls.update();
// Tilt-shift: a soft blur at the top and bottom of the screen makes the city look like a miniature.
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } };
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 }));
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));
const tiltH = new ShaderPass(HorizontalTiltShiftShader), tiltV = new ShaderPass(VerticalTiltShiftShader);
composer.addPass(tiltH); composer.addPass(tiltV); composer.addPass(new OutputPass());
// The miniature blur is now an opt-in photo effect, so the city is sharp by default.
let tiltOn = store.get('cc-miniature', false);
function setTilt(on) { tiltOn = on; store.set('cc-miniature', on); }
let qFrames = 0, qTime = 0, qHold = 0, qNoRaise = false;
function adaptQuality(dt) {
  if (dt >= 0.1 || document.hidden) return;
  qHold -= dt; qFrames++; qTime += dt;
  if (qFrames < 90) return;
  const avg = qTime / qFrames; qFrames = 0; qTime = 0;
  if (qHold > 0) return;
  let next = pixelRatio;
  if (avg > 1 / 38 && pixelRatio > 1) { next = Math.max(1, pixelRatio - 0.25); if (qHold > -20) qNoRaise = true; }
  else if (avg < 1 / 57 && pixelRatio < MAX_PR && !qNoRaise) next = Math.min(MAX_PR, pixelRatio + 0.25);
  if (next !== pixelRatio) { pixelRatio = next; renderer.setPixelRatio(next); composer.setPixelRatio(next); qHold = 6; }
}
function updateTilt() {
  const d = camera.position.distanceTo(controls.target), k = Math.min(1, Math.max(0, (d - 4) / 22)); // stronger when zoomed out
  // at the very top and bottom the blur reaches about 9 css pixels; the middle stays sharp
  tiltH.uniforms.h.value = (1.5 * k) / innerWidth; tiltV.uniforms.v.value = (1.5 * k) / innerHeight;
  tiltH.uniforms.r.value = tiltV.uniforms.r.value = 0.5;
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); });

const world = makeWorld(scene);
const life = makeLife(scene);
const movers = makeMovers(scene);
const flight = makeFlight({ canvas, sfx });
const mats = materials();

// ---------- Save + usage ----------
let save = null, usage = { out: 0, replies: 0, sessions: 0, tools: {}, days: {}, headlines: [] };
let lastEventT = 0, shownBalance = 0;
const api = {
  async load() { try { return await (await fetch('/api/save')).json(); } catch { return JSON.parse(localStorage.getItem('claudecity') || '{}'); } },
  async usage(after) { const r = await fetch(`/api/usage?after=${after || 0}`); return r.json(); },
};
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    save.items = moving ? [...city.items, moving] : city.items; save.land = city.R; save.name = $('#cityName').value;
    const body = JSON.stringify(save);
    try { localStorage.setItem('claudecity', body); } catch { /* full */ }
    fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
  }, 400);
}
const earned = () => usage.out || 0;
const balance = () => earned() + (save.bonus || 0) - (save.spent || 0); // bonus = street rewards; eras and unlocks only count Claude's tokens

// The starting town: City Hall, a crossroads, a cottage and a few trees. Free.
function starterTown() {
  const items = [{ id: 'hall', i: 23, j: 23, rot: 0, seed: 1 }];
  for (let i = 18; i < 30; i++) items.push({ id: 'road', i, j: 25, rot: 0, seed: 0 });
  for (let j = 18; j < 30; j++) if (j !== 25) items.push({ id: 'road', i: 22, j, rot: 0, seed: 0 });
  items.push({ id: 'cottage', i: 24, j: 26, rot: 2, seed: 7 }, { id: 'tree', i: 25, j: 23, rot: 0, seed: 3 }, { id: 'tree', i: 20, j: 23, rot: 0, seed: 4 }, { id: 'flowers', i: 23, j: 26, rot: 0, seed: 5 }, { id: 'bench', i: 25, j: 24, rot: 0, seed: 6 });
  return items;
}

let city, agents;
// Walk mode: become a person in the city.
const walker = makeWalker({ scene, camera, controls, canvas, world, sfx, getCity: () => city, getAgents: () => agents, onEnter() {
  stopDrift(); if (document.body.classList.contains('photo')) exitPhoto();
  setCat(null); setMode('look'); toggleNeeds(false); fly = null; $('#info').hidden = true; $('#soundPanel').hidden = true; dismissCoach();
  for (const k in keys) keys[k] = false;
  street.renderPocket(); guideSee('walk');
}, onInteract: useThing, onLeave: () => { street.close(); } });
// E: go through a door, talk to whoever's at the counter, or use the thing in front of you.
let fading = false;
function fadeThen(fn) {
  if (fading) return; fading = true; const f = $('#fade'); f.classList.add('on'); sfx.door();
  setTimeout(() => { fn(); f.classList.remove('on'); setTimeout(() => { fading = false; }, 180); }, 190);
}
function useThing(t) {
  if (fading) return;
  if (t.kind === 'door') { fadeThen(() => walker.exitRoom()); return; }
  if (t.kind === 'counter') { street.open(t.item); return; }
  const def = BY_ID[t.id];
  if (t.id === 'airport') { openDepartures(); return; }
  if (hasInside(def)) fadeThen(() => { walker.enterRoom(makeRoom(t, def, world.night)); guideSee('inside'); }); else street.open(t);
}
const street = makeInteract({ walker, sfx, getSave: () => save, getEarned: () => earned(), balance: () => balance(), fmt: (n) => fmt(n), esc: (x) => esc(x), toast: (h, ms) => toast(h, ms),
  changed(gained) { shownTarget = balance(); if (shownBalance > shownTarget) shownBalance = shownTarget; updateHud(); persist(); if (gained) { $('#tokenPill').classList.add('bump'); setTimeout(() => $('#tokenPill').classList.remove('bump'), 500); } },
  fx(k) { if (k === 'rocket') launchRocket(); if (k === 'fireworks') life.fireworks(10, HALL, () => sfx.firework()); } });
async function boot() {
  save = await api.load();
  const fresh = !save || !save.founded;
  if (fresh) {
    save = { founded: Date.now(), items: starterTown(), land: LAND.start, spent: 0, name: 'Contextville', milestones: [], lastSeenOut: 0, landBuys: 0 };
    await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(save) }).catch(() => {});
  }
  $('#cityName').value = save.name || 'Contextville';
  city = makeCity(scene, save);
  agents = makeAgents(scene);
  ensureIslands(); world.setIsland(islandRadius(save.activeIsland)); applyIslandView();
  world.setLand(city.R);
  city.rebuild(); world.setOccupied(city.treeBlock); agents.setRoads(city); collectWonders();
  usage = await api.usage(0).catch(() => usage);
  lastEventT = usage.now || Date.now();
  shownBalance = balance();
  buildToolbar(); updateHud(true);
  showCoach();
  if (fresh) welcomeNew();
  else {
    const away = earned() - (save.lastSeenOut || 0);
    if (away > 0) welcomeBack(away);
  }
  save.lastSeenOut = earned(); persist();
  applyFestival(); life.setDucks(!!save.ducks); checkMoments(); initGuide(); updateWish();
  $('#bSound').classList.toggle('off', !sfx.enabled);
  setInterval(poll, 3000);
  renderer.setAnimationLoop(frame);
}

// ---------- Live tokens ----------
async function poll() {
  let u; try { u = await api.usage(lastEventT); } catch { return; }
  const fresh = (u.recent || []).filter((e) => e.out > 0);
  const gained = u.out - (usage.out || 0);
  usage = u;
  if (u.recent && u.recent.length) lastEventT = u.recent[u.recent.length - 1].t;
  if (gained > 0) {
    const n = Math.min(6, Math.max(1, fresh.length));
    const per = gained / n;
    for (let k = 0; k < n; k++) setTimeout(() => sendSpark(per), k * 350);
    save.lastSeenOut = earned(); persist();
  }
  checkMilestones();
}

// A glowing spark falls from the sky into City Hall; the counter ticks up when it lands.
const sparks = [];
const sparkGeo = new THREE.IcosahedronGeometry(0.22, 1);
function sendSpark(amount) {
  const size = Math.min(2.2, 0.7 + Math.log10(Math.max(10, amount)) * 0.25);
  const m = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: '#ff8a5c', toneMapped: false, transparent: true }));
  m.scale.setScalar(size);
  const a = Math.random() * Math.PI * 2;
  const from = new THREE.Vector3(Math.cos(a) * 22, 26 + Math.random() * 6, Math.sin(a) * 22);
  const to = new THREE.Vector3(0, 2.1, 0);
  const trail = [];
  for (let k = 0; k < 10; k++) { const t = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color: '#ffb48a', toneMapped: false, transparent: true, opacity: 0.6 * (1 - k / 10) })); t.scale.setScalar(size * (0.8 - k * 0.06)); scene.add(t); trail.push(t); }
  scene.add(m);
  sparks.push({ m, trail, from, to, t: 0, amount, hist: [] });
}
const rings = [];
function landSpark(s) {
  scene.remove(s.m); s.trail.forEach((t) => scene.remove(t));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 6, 32), new THREE.MeshBasicMaterial({ color: '#ff9a6a', toneMapped: false, transparent: true }));
  ring.rotation.x = Math.PI / 2; ring.position.set(0, 2.05, 0); scene.add(ring); rings.push({ ring, t: 0 });
  floatLabel(`+${fmt(s.amount)} tokens`, new THREE.Vector3(0, 2.6, 0));
  shownTarget = balance();
  sfx.token(Math.min(3, Math.log10(s.amount + 1) - 1));
  $('#tokenPill').classList.add('bump'); setTimeout(() => $('#tokenPill').classList.remove('bump'), 500);
}
let shownTarget = 0;

// ---------- Floating labels ----------
const labels = [];
function floatLabel(text, pos) { const el = document.createElement('div'); el.className = 'plus'; el.textContent = text; $('#labels').append(el); labels.push({ el, pos: pos.clone(), born: performance.now() }); }

// ---------- HUD ----------
const LEVELS = [[0, 'Hamlet'], [20, 'Village'], [60, 'Town'], [150, 'Small city'], [400, 'City'], [1000, 'Big city'], [2500, 'Metropolis'], [6000, 'Megacity'], [15000, 'Capital'], [40000, 'World city'], [100000, 'Legend']];
function updateHud(force) {
  const st = city.stats;
  let lvl = 0; while (lvl < LEVELS.length - 1 && st.pop >= LEVELS[lvl + 1][0]) lvl++;
  $('#level').textContent = LEVELS[lvl][1];
  $('#pop').textContent = st.pop.toLocaleString(); $('#pop').parentElement.title = 'People';
  $('#joy').textContent = `${st.happiness}%`; $('#joy').parentElement.title = 'Happiness';
  $('#lifetime').textContent = `${fmt(earned())} earned since founding`;
  const ek = eraIndex(earned()), nextEra = ERAS[ek + 1];
  $('#era').textContent = nextEra ? `Era ${ek + 1} of ${ERAS.length} · ${ERAS[ek].name} · next at ${fmt(nextEra.at)}` : `Era ${ERAS.length} of ${ERAS.length} · ${ERAS[ek].name}`;
  $('#eraBar').style.width = `${nextEra ? Math.min(100, ((earned() - ERAS[ek].at) / (nextEra.at - ERAS[ek].at)) * 100).toFixed(1) : 100}%`;
  if (force) { shownBalance = balance(); shownTarget = balance(); $('#balance').textContent = fmt(shownBalance); }
  const land = $('#bLand');
  if (city.R >= landMax()) land.innerHTML = 'All land owned';
  else land.innerHTML = `Expand land<small>${fmt(landCost())}</small>`;
  refreshItems();
}

// ---------- Toolbar + thumbnails ----------
let cat = null, selected = null, mode = 'look', rot = 0, ghost = null, ghostSeed = 1;
const thumbs = {};
function makeThumbs() {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(160, 110); r.toneMapping = THREE.ACESFilmicToneMapping; r.outputColorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight('#ffffff', '#b09070', 1.8)); const dl = new THREE.DirectionalLight('#fff1dc', 2.2); dl.position.set(3, 5, 4); sc.add(dl);
  const cam = new THREE.PerspectiveCamera(30, 160 / 110, 0.1, 100);
  for (const def of CATALOG) {
    const b = new Builder();
    if (def.road) { const st = ROAD_STYLES[def.style || 'asphalt']; b.box(0, 0, 0, 1, 0.04, 1, st.asph); b.box(0, 0.04, -0.25, 0.05, 0.005, 0.22, st.line || st.mark); b.box(0, 0.04, 0.25, 0.05, 0.005, 0.22, st.line || st.mark); }
    else def.build(b, rng(7));
    const g = meshesFrom(b.build()); sc.add(g);
    const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const d = Math.max(size.x, size.y * 1.2, size.z) * 2.3 + 0.6;
    cam.position.set(c.x + d * 0.75, c.y + d * 0.6, c.z + d * 0.9); cam.lookAt(c);
    r.render(sc, cam); thumbs[def.id] = r.domElement.toDataURL();
    sc.remove(g);
  }
  r.dispose();
}
const CAT_ICONS = {
  roads: '<path d="M8 3 5 21M16 3l3 18M12 4v3M12 11v3M12 18v2"/>',
  ground: '<path d="M3 18c3-2 6-2 9 0s6 2 9 0M3 13c3-2 6-2 9 0s6 2 9 0M8 8l2-3 2 3M14 8l2-3 2 3"/>',
  homes: '<path d="M4 11l8-7 8 7"/><path d="M6.500 9.500V20h11V9.500M10 20v-5h4v5"/>',
  shops: '<path d="M5 10v10h14V10M4 10l2-6h12l2 6a2.700 2.700 0 0 1-5.300 0 2.700 2.700 0 0 1-5.400 0A2.700 2.700 0 0 1 4 10z"/>',
  civic: '<path d="M4 9l8-5 8 5zM6 9v8M10 9v8M14 9v8M18 9v8M4 20h16M5 17h14"/>',
  nature: '<path d="M12 21v-7M12 14c-4 0-6-2.500-6-5.500S8.500 3 12 3s6 2.500 6 5.500-2 5.500-6 5.500z"/>',
  wonders: '<path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500l-15.600 9"/>',
};
function setCat(c) {
  cat = c; $('#brush').classList.toggle('tray', !!c); $$('#cats button').forEach((x) => x.classList.toggle('on', x.dataset.cat === c));
  $('#tray').hidden = !c; $('#hint').classList.toggle('tray', !!c); refreshItems();
  if (c) $('#items').scrollLeft = 0;
}
function buildToolbar() {
  makeThumbs();
  $('#cats').innerHTML = CATEGORIES.map((c, k) => `<button data-cat="${c.id}" aria-label="${c.name}" data-tip="${c.name} (${k + 1})"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${CAT_ICONS[c.id]}</svg><span>${c.name}</span></button>`).join('');
  $('#cats').onclick = (e) => { const b = e.target.closest('[data-cat]'); if (!b) return; sfx.click(); setCat(cat === b.dataset.cat ? null : b.dataset.cat); };
  $('#items').onclick = (e) => {
    const b = e.target.closest('[data-id]'); if (!b) return;
    const def = BY_ID[b.dataset.id];
    if ((def.unlock || 0) > earned()) { sfx.deny(); toast(`<b>${def.name}</b> unlocks at ${fmt(def.unlock)} tokens earned.`); return; }
    if (def.needsFullLand && city.R < landMax()) { sfx.deny(); toast(`<b>${def.name}</b>: own all of this island's land first.`); return; }
    if (def.id === 'airport' && city.items.some((x) => x.id === 'airport')) { sfx.deny(); toast('This island already has an airport.'); return; }
    if ((def.pride || 0) > (save.pride || 0)) { sfx.deny(); toast(`<b>${def.name}</b> needs <b>${def.pride} Civic Pride</b>. Grant residents' wishes to earn it.`); return; }
    if (selected === def.id) { setMode('look'); return; }
    selected = def.id; setMode('build'); sfx.click(); setCat(null);
  };
  document.querySelectorAll('.mode[data-mode]').forEach((b) => { b.onclick = () => { setCat(null); setMode(mode === b.dataset.mode ? 'look' : b.dataset.mode); sfx.click(); }; });
  $('#hintStop').onclick = () => { setMode('look'); sfx.click(); };
  $('#bLand').onclick = buyLand;
  refreshItems();
}
const $$ = (s) => [...document.querySelectorAll(s)];
function refreshItems() {
  const bal = balance(), life = earned();
  const free = (save.freebies || []).length;
  if (!cat) { itemsHtml = ''; $('#items').innerHTML = ''; return; }
  const html = CATALOG.filter((d) => d.cat === cat && !d.fixed && (!d.freebie || free)).map((d) => {
    const needPride = (d.pride || 0) > (save.pride || 0), needLand = !!d.needsFullLand && city.R < landMax(), locked = (d.unlock || 0) > life || needPride || needLand;
    return `<button class="item${selected === d.id ? ' on' : ''}${locked ? ' locked' : d.cost > bal ? ' poor' : ''}" data-id="${d.id}" title="${d.desc || ''}">
      <img src="${thumbs[d.id] || ''}" alt=""><b>${d.name}</b><span>${needPride ? `${d.pride} Civic Pride` : needLand && (d.unlock || 0) <= life ? 'Own all land first' : locked ? `Unlocks at ${fmt(d.unlock)}` : d.freebie ? `Free · ${free} waiting` : `${fmt(d.cost)} tokens`}</span></button>`;
  }).join('');
  if (html !== itemsHtml) { itemsHtml = html; const x = $('#items').scrollLeft; $('#items').innerHTML = html; $('#items').scrollLeft = x; } // rebuilding on every token tick would break hover and scroll
}
let itemsHtml = '';
function setMode(m) {
  if (m !== 'build' && moving) { const o = moving; moving = null; const back = city.place(o.id, o.i, o.j, o.rot, o.seed); for (const f of ['lvl', 'label', 'since', 'nick']) if (o[f] != null) back[f] = o[f]; afterChange(); }
  mode = m; lastPreview = '';
  if (m !== 'build') selected = null;
  $$('.mode[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m || (m === 'build' && false)));
  world.grid.visible = m !== 'look'; world.edge.visible = m !== 'look';
  if (ghost) { scene.remove(ghost); ghost = null; }
  foot.visible = false;
  if (m === 'build') { ghostSeed = moving ? moving.seed : Math.floor(Math.random() * 1e9); ghost = city.ghost(selected, ghostSeed); ghost.visible = !BY_ID[selected].ground; scene.add(ghost); }
  $('#brush').hidden = !(m === 'build' && BY_ID[selected]?.ground); if (!$('#brush').hidden) drawBrush();
  hint(m === 'build' ? `${BY_ID[selected].name} · ${PAINT.includes(selected) ? 'click or drag to place · hold Space to move' : 'click to place · drag to move · R to rotate'}` : m === 'bulldoze' ? 'Click a building to sell it for half its value' : '');
  refreshItems();
  if (m !== 'look') $('#info').hidden = true;
}
let hintTimer = 0;
function hint(text) { if (text) $('#hintText').textContent = text; $('#hint').classList.toggle('on', !!text); }
// One small note at a time: a new message replaces the old one instead of stacking up.
let noteTimer = 0;
function toast(html, ms = 4000) {
  const box = $('#toasts');
  let el = box.firstElementChild;
  if (!el) { el = document.createElement('div'); el.className = 'toast'; box.append(el); }
  if (el.innerHTML !== html) { el.innerHTML = html; el.classList.remove('nudge'); void el.offsetWidth; el.classList.add('nudge'); }
  el.classList.remove('out');
  clearTimeout(noteTimer); noteTimer = setTimeout(() => { el.classList.add('out'); setTimeout(() => { if (el.classList.contains('out')) el.remove(); }, 400); }, ms);
}

// ---------- Pointer: placing, selling, inspecting ----------
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
let hover = null, downAt = null, painting = false, lastPaint = '';
const foot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#7ad38a', transparent: true, opacity: 0.35, depthWrite: false }));
foot.rotation.x = -Math.PI / 2; foot.position.y = 0.04; foot.visible = false; scene.add(foot);
function tileUnder(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  if (!ray.ray.intersectPlane(ground, hitP)) return null;
  return worldToTile(hitP.x, hitP.z);
}
function anchorFor(i, j) { // centre multi-tile footprints on the cursor
  const def = BY_ID[selected], [w, d] = footprint(def, rot);
  return [i - Math.floor((w - 1) / 2), j - Math.floor((d - 1) / 2)];
}
canvas.addEventListener('pointermove', (e) => {
  hover = tileUnder(e);
  if (mode === 'build' && ghost && hover) {
    const [i, j] = anchorFor(...hover);
    const M = city.placementMatrix({ id: selected, i, j, rot });
    ghost.position.setFromMatrixPosition(M); ghost.rotation.set(0, -rot * Math.PI / 2, 0);
    const ok = BY_ID[selected].ground ? inLand(i, j, city.R) && BY_ID[selected].cost <= balance() : city.canPlace(selected, i, j, rot) && (!!moving || BY_ID[selected].cost <= balance());
    showPreview(i, j, ok);
    ghost.traverse((o) => { if (o.isMesh) { o.material.opacity = ok ? 0.75 : 0.4; if (o.material.color) o.material.color.set(ok ? '#ffffff' : '#ff9a8a'); } });
    const [fw, fd] = footprint(BY_ID[selected], rot);
    const bs = BY_ID[selected].ground ? brush : 1; foot.visible = true; foot.scale.set(fw * bs, fd * bs, 1); foot.position.x = ghost.position.x; foot.position.z = ghost.position.z;
    foot.material.color.set(ok ? '#7ad38a' : '#ff6a5a');
    if (painting) tryPlace(i, j, true);
  }
});
const PAINT = ['path', 'tree', 'flowers', 'grove', 'lamppost', 'bench', ...CATALOG.filter((d) => d.road || d.ground || d.paint).map((d) => d.id)];
const cameraHeld = (e) => !!(keys[' '] || e.altKey || e.shiftKey || e.metaKey);
// Decide what a left-drag does just before the camera controls see the press.
addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  const paints = mode === 'build' && PAINT.includes(selected) && !cameraHeld(e);
  controls.mouseButtons = { LEFT: paints ? null : e.altKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  dismissCoach();
}, { capture: true });
canvas.addEventListener('pointerdown', (e) => {
  sfx.ensure();
  downAt = [e.clientX, e.clientY];
  fly = null;
  if (e.button !== 0) return;
  // roads and small things paint as you drag; everything else places on a click, so dragging always moves the view
  if (mode === 'build' && PAINT.includes(selected) && !cameraHeld(e)) { hover = tileUnder(e); if (hover) { painting = true; lastPaint = ''; stroke++; const [i, j] = anchorFor(...hover); tryPlace(i, j, false); } }
});
addEventListener('pointerup', (e) => {
  painting = false;
  if (walker.on || flight.active) { downAt = null; return; }
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6; downAt = null;
  if (e.button === 2 && !moved && mode !== 'look') { setMode('look'); return; } // a plain right-click stops building
  if (e.button !== 0 || moved || e.target !== canvas) return;
  const t = tileUnder(e); if (!t) return;
  if (mode === 'build') { if (!PAINT.includes(selected) && !cameraHeld(e)) { const [i, j] = anchorFor(...t); tryPlace(i, j, false); } return; }
  const it = city.itemAt(t[0], t[1]);
  if (mode === 'bulldoze') { if (it) sell(it); return; }
  if (mode === 'look') { if (it) inspect(it); else $('#info').hidden = true; }
});
function tryPlace(i, j, quiet) {
  const k = `${i},${j}`; if (quiet && k === lastPaint) return; lastPaint = k;
  const def = BY_ID[selected];
  if (def.ground) { paintGround(def, i, j, quiet); return; }
  if (!city.canPlace(selected, i, j, rot)) { if (!quiet) { sfx.deny(); if (!inLand(i, j, city.R)) toast('That land isn\'t yours yet. Use <b>Expand land</b>.'); } return; }
  if (moving) {
    const o = moving; moving = null;
    const back = city.place(o.id, i, j, rot, o.seed); for (const f of ['lvl', 'label', 'since', 'nick']) if (o[f] != null) back[f] = o[f];
    popIn(back); sfx.place(def.cat); const [mx, mz] = tileToWorld(i, j); dust(mx, mz, def.size[0]);
    setMode('look'); afterChange(); return;
  }
  if (def.cost > balance()) { if (!quiet) { sfx.deny(); toast(`${def.name}: <b>${fmt(def.cost - balance())}</b> more tokens needed`); } return; }
  save.spent = (save.spent || 0) + def.cost;
  if (def.freebie && !(save.freebies || []).length) { sfx.deny(); setMode('look'); return; }
  const placed = city.place(selected, i, j, rot, ghostSeed);
  if (def.freebie) { const f = save.freebies.shift(); placed.label = f.label; placed.since = f.t; toast(`A landmark for <b>${esc(f.label)}</b> now stands in the city.`); if (!save.freebies.length) setTimeout(() => setMode('look'), 0); }
  if (!def.freebie) { if (!quiet) stroke++; undoStack.push({ kind: 'place', it: placed, stroke }); if (undoStack.length > 200) undoStack.shift(); }
  if (!def.road && !def.path) { popIn(placed); sfx.pop(); }
  ghostSeed = Math.floor(Math.random() * 1e9);
  if (ghost && !def.road) { scene.remove(ghost); ghost = city.ghost(selected, ghostSeed); scene.add(ghost); }
  def.road || def.path ? sfx.road() : sfx.place(def.cat);
  const [x, z] = tileToWorld(i, j);
  dust(x, z, def.size[0]);
  afterChange();
}
function sell(it) {
  const def = BY_ID[it.id];
  if (def.fixed) { sfx.deny(); toast('City Hall stays. It\'s where the tokens arrive.'); return; }
  if (it.free) { sfx.deny(); toast('This island\'s airport stays. It\'s your way home.'); return; }
  const back = Math.floor(investedIn(def, it.lvl || 1) / 2);
  if (def.freebie) { save.freebies = save.freebies || []; save.freebies.push({ label: it.label || 'a project', t: it.since }); }
  save.spent = Math.max(0, (save.spent || 0) - back);
  if (!def.freebie) { const { ...copy } = it; undoStack.push({ kind: 'sell', copy, back, stroke: ++stroke }); }
  if (!def.road) crumble(it);
  city.remove(it); sfx.sell();
  const [x, z] = tileToWorld(it.i, it.j); floatLabel(`+${fmt(back)}`, new THREE.Vector3(x, 0.8, z));
  afterChange(); $('#info').hidden = true;
}
function afterChange() {
  city.rebuild(); world.setOccupied(city.treeBlock); collectWonders(); checkGoals(); checkGuide(); updateWish(); if (needsOn) drawNeeds(); agents.setRoads(city); applyFestival(); shownTarget = balance(); shownBalance = Math.min(shownBalance, shownTarget);
  $('#balance').textContent = fmt(shownBalance); updateHud(); persist();
}
// Nobody comes with a name. You can name any building yourself, and the city remembers it.
const canName = (def) => !def.road && !def.path && !def.freebie;
const placeName = (it) => (it.nick ? esc(it.nick) : `the ${esc(BY_ID[it.id].name)}`);
// The camera glides down to street level when you open a building.
let fly = null;
function flyTo(pos, dist = 3.6) {
  const dir = camera.position.clone().sub(controls.target); dir.y = 0; if (dir.lengthSq() < 0.01) dir.set(1, 0, 1); dir.normalize();
  fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), t1: pos.clone(), p1: pos.clone().addScaledVector(dir, dist * 0.85).add(new THREE.Vector3(0, dist * 0.6, 0)) };
}
function updateFly(dt) {
  if (!fly) return;
  fly.t = Math.min(1, fly.t + dt / 1.2); const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - (-2 * fly.t + 2) ** 3 / 2;
  camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
  if (fly.t >= 1) fly = null;
}
canvas.addEventListener('wheel', () => { fly = null; }, { passive: true });
canvas.addEventListener('dblclick', (e) => {
  if (mode !== 'look' || walker.on) return;
  const t = tileUnder(e); if (!t) return;
  const it = city.itemAt(t[0], t[1]);
  if (it && !BY_ID[it.id].road && !BY_ID[it.id].path) flyTo(new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(it)).setY(0.2), Math.max(3.2, BY_ID[it.id].size[0] * 2.2));
  else flyTo(hitP.clone(), 5);
});
// ---------- Looking around ----------
const orbitS = new THREE.Spherical(), orbitV = new THREE.Vector3();
function orbit(yaw, pitch = 0) {
  orbitV.copy(camera.position).sub(controls.target); orbitS.setFromVector3(orbitV);
  orbitS.theta += yaw; orbitS.phi = Math.max(0.18, Math.min(controls.maxPolarAngle, orbitS.phi + pitch));
  camera.position.copy(controls.target).add(orbitV.setFromSpherical(orbitS));
}
let turnLeft = 0;
function zoomBy(k) {
  const off = camera.position.clone().sub(controls.target), d = Math.max(controls.minDistance, Math.min(controls.maxDistance, off.length() * k));
  fly = { t: 0.25, p0: camera.position.clone(), t0: controls.target.clone(), t1: controls.target.clone(), p1: controls.target.clone().add(off.setLength(d)) };
}
function goHome() { fly = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), t1: new THREE.Vector3(0, 0, 0), p1: new THREE.Vector3(10, 11, 14) }; }
$('#vLeft').onclick = () => { turnLeft += Math.PI / 4; }; $('#vRight').onclick = () => { turnLeft -= Math.PI / 4; };
$('#vIn').onclick = () => zoomBy(0.72); $('#vOut').onclick = () => zoomBy(1.38); $('#vHome').onclick = goHome; $('#vWalk').onclick = () => { sfx.click(); walker.enter(); };
// Two-finger sideways swipe turns the city (and must not trigger the browser's back gesture).
addEventListener('wheel', (e) => {
  if (e.target !== canvas) return;
  e.preventDefault();
  if (walker.on) return;
  if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.2) { e.stopPropagation(); fly = null; orbit(e.deltaX * 0.0035); }
}, { capture: true, passive: false });
function dismissCoach() { const c = $('#coach'); if (c.hidden || c.classList.contains('out')) return; c.classList.add('out'); store.set('cc-coached', true); setTimeout(() => { c.hidden = true; }, 450); }
function showCoach() { if (store.get('cc-coached', false)) return; $('#coach').hidden = false; setTimeout(dismissCoach, 14000); }
function inspect(it) {
  const def = BY_ID[it.id], ok = city.connected(it), mult = LEVEL_MULT[it.lvl || 1], upCost = city.canUpgrade(it) ? upgradeCost(def, it.lvl || 1) : 0;
  const el = $('#info'); el.hidden = false;
  const landmark = def.freebie ? `<p>For <b>${esc(it.label || 'a project')}</b>${it.since ? `, started ${new Date(it.since).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : ''}.</p>` : '';
  el.innerHTML = `<h3 id="iTitle">${it.nick ? esc(it.nick) : def.name}</h3><p>${def.desc || ''}</p>${landmark}${canName(def) ? `<input id="iNick" type="text" maxlength="24" spellcheck="false" placeholder="Give it a name" aria-label="Name this building" value="${esc(it.nick || '')}">` : ''}
    ${city.canUpgrade(it) || (it.lvl || 1) > 1 ? `<div class="row"><span>Level</span><b>${it.lvl || 1} of 3</b></div>` : ''}${def.pop ? `<div class="row"><span>Residents</span><b>${Math.round(def.pop * mult)}</b></div>` : ''}${def.jobs ? `<div class="row"><span>Jobs</span><b>${Math.round(def.jobs * mult)}</b></div>` : ''}${def.joy ? `<div class="row"><span>Makes neighbours happier</span><b>+${+(def.joy * mult).toFixed(1)}</b></div>` : ''}
    ${def.road || def.path ? '' : `<div class="row"><span>Status</span>${ok ? '<b>Open</b>' : '<span class="warn">Needs a road next to it</span>'}</div>`}
    ${it.id === 'airport' ? '<div class="actions"><button class="btn" id="iFly">Departures</button></div>' : ''}${upCost ? `<div class="actions"><button class="btn" id="iUp"${upCost > balance() ? ' disabled' : ''}>Upgrade · ${fmt(upCost)}</button></div>` : ''}
    ${def.pop && ok ? `<div class="needs">${Object.keys(NEEDS).map((k) => `<span class="${city.needsOf(it)[k] ? 'yes' : ''}">${{ shop: 'Shops', green: 'Green space', civic: 'Services' }[k]}</span>`).join('')}</div>` : ''}
    ${def.fixed ? '' : `<div class="actions"><button class="btn ghost" id="iMove">Move</button><button class="btn ghost" id="iSell">Sell ${fmt(Math.floor(investedIn(def, it.lvl || 1) / 2))}</button><button class="btn ghost" id="iClose">Close</button></div>`}`;
  if (canName(def)) $('#iNick').oninput = (e) => { const v = e.target.value.trim(); if (v) it.nick = v; else delete it.nick; $('#iTitle').textContent = v || def.name; updateWish(); persist(); };
  if (it.id === 'airport') $('#iFly').onclick = openDepartures;
  if (upCost) $('#iUp').onclick = () => upgrade(it);
  if (!def.fixed) { $('#iMove').onclick = () => startMove(it); $('#iSell').onclick = () => sell(it); $('#iClose').onclick = () => { el.hidden = true; }; }
}

function upgrade(it) {
  const def = BY_ID[it.id]; if (!city.canUpgrade(it)) return;
  const cost = upgradeCost(def, it.lvl || 1);
  if (cost > balance()) { sfx.deny(); toast(`Upgrade needs <b>${fmt(cost - balance())}</b> more tokens`); return; }
  save.spent = (save.spent || 0) + cost; it.lvl = (it.lvl || 1) + 1;
  popIn(it); sfx.upgrade(); const p = new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(it)); dust(p.x, p.z, def.size[0]);
  toast(`<b>${def.name}</b> is now level ${it.lvl}.`); afterChange(); inspect(it);
}

// New buildings pop up with a little squash-and-bounce before joining the merged city mesh.
const pops = [];
function popIn(it) {
  city.hidden.add(it);
  const g = meshesFrom(city.modelOf(it, false)), M = city.placementMatrix(it);
  g.position.setFromMatrixPosition(M); g.rotation.y = -it.rot * Math.PI / 2; g.scale.set(0.82, 0.01, 0.82);
  scene.add(g); pops.push({ g, it, t: 0 });
}
function updatePops(dt) {
  let done = false;
  for (let k = pops.length - 1; k >= 0; k--) {
    const p = pops[k]; p.t += dt;
    const t = Math.min(1, p.t / 0.68);
    // rises out of the ground, overshoots, then settles with a small squash
    const y = 1 - Math.exp(-7 * t) * Math.cos(t * 13);
    const xz = 1 + (1 - y) * 0.42;
    p.g.scale.set(xz, Math.max(0.01, y), xz);
    if (t >= 1 || !city.items.includes(p.it)) { scene.remove(p.g); city.hidden.delete(p.it); pops.splice(k, 1); done = true; }
  }
  if (done) city.rebuild();
  for (let k = falls.length - 1; k >= 0; k--) {
    const f = falls[k]; f.t += dt; const t = Math.min(1, f.t / 0.42);
    f.g.scale.set(1 + t * 0.1, Math.max(0.01, 1 - t * t), 1 + t * 0.1); f.g.rotation.z = Math.sin(t * 22) * 0.012 * (1 - t);
    if (t >= 1) { scene.remove(f.g); falls.splice(k, 1); }
  }
}
// Selling: the building shakes, sinks into a cloud of dust and is gone.
const falls = [];
function crumble(it) {
  const g = meshesFrom(city.modelOf(it, false)), M = city.placementMatrix(it);
  g.position.setFromMatrixPosition(M); g.rotation.y = -it.rot * Math.PI / 2; scene.add(g); falls.push({ g, t: 0 });
  dust(g.position.x, g.position.z, BY_ID[it.id].size[0]); dust(g.position.x, g.position.z, BY_ID[it.id].size[0] * 0.6);
}

// ---------- Undo, moving, previews, needs and wishes ----------
const undoStack = []; let stroke = 0, moving = null, lastPreview = '';
// Painting the ground: a brush of 1, 3 or 5 tiles, or fill all your land. Buildings sit on top of it.
let brush = 1, groundDirty = false;
function setGround(k, type) { if (type === 'grass' || !type) delete city.ground[k]; else city.ground[k] = type; }
function paintTiles(def, tiles, quiet) {
  const want = def.ground, change = tiles.filter(([i, j]) => inLand(i, j, city.R) && (city.ground[`${i},${j}`] || 'grass') !== want);
  if (!change.length) return;
  const cost = change.length * def.cost;
  if (cost > balance()) { if (!quiet) { sfx.deny(); toast(`${def.name}: <b>${fmt(cost - balance())}</b> more tokens needed`); } return; }
  const undoList = change.map(([i, j]) => [`${i},${j}`, city.ground[`${i},${j}`]]);
  for (const [k] of undoList) setGround(k, want);
  save.spent = (save.spent || 0) + cost; undoStack.push({ kind: 'ground', list: undoList, cost, stroke }); if (undoStack.length > 400) undoStack.shift();
  groundDirty = true; shownTarget = balance(); shownBalance = Math.min(shownBalance, shownTarget); $('#balance').textContent = fmt(shownBalance); sfx.road(); persist();
}
function paintGround(def, i, j, quiet) {
  if (!inLand(i, j, city.R) && !quiet) { sfx.deny(); toast('That land isn\'t yours yet. Use <b>Expand land</b>.'); return; }
  const h = (brush - 1) / 2, tiles = []; for (let a = -h; a <= h; a++) for (let b = -h; b <= h; b++) tiles.push([i + a, j + b]);
  paintTiles(def, tiles, quiet);
}
function fillLand() {
  const def = BY_ID[selected]; if (!def?.ground) return;
  const tiles = []; for (let i = HALF - city.R; i < HALF + city.R; i++) for (let j = HALF - city.R; j < HALF + city.R; j++) tiles.push([i, j]);
  stroke++; paintTiles(def, tiles, false);
}
function drawBrush() {
  $$('#brush [data-b]').forEach((x) => x.classList.toggle('on', Number(x.dataset.b) === brush));
  const def = BY_ID[selected]; if (!def?.ground) return;
  let n = 0; for (let i = HALF - city.R; i < HALF + city.R; i++) for (let j = HALF - city.R; j < HALF + city.R; j++) if ((city.ground[`${i},${j}`] || 'grass') !== def.ground) n++;
  $('#bFill').textContent = n ? `Fill all land · ${fmt(n * def.cost)}` : 'All land done';
}
$('#brush').addEventListener('click', (e) => { const x = e.target.closest('[data-b]'); if (x) { brush = Number(x.dataset.b); sfx.click(); lastPreview = ''; drawBrush(); } else if (e.target.closest('#bFill')) { fillLand(); drawBrush(); } });
function undo() {
  const last = undoStack[undoStack.length - 1];
  if (!last) { toast('Nothing to undo.'); return; }
  if (last.kind === 'ground') {
    let back = 0;
    while (undoStack.length && undoStack[undoStack.length - 1].kind === 'ground' && undoStack[undoStack.length - 1].stroke === last.stroke) { const u = undoStack.pop(); for (const [k, prev] of [...u.list].reverse()) setGround(k, prev); back += u.cost; }
    save.spent = Math.max(0, (save.spent || 0) - back); groundDirty = true; sfx.sell(); shownTarget = balance(); updateHud(); persist(); if (!$('#brush').hidden) drawBrush(); toast('Ground undone. Tokens returned.'); return;
  }
  if (last.kind === 'sell') {
    const c = last.copy;
    if (!city.canPlace(c.id, c.i, c.j, c.rot)) { undoStack.pop(); sfx.deny(); toast('Something else is standing there now.'); return; }
    if (last.back > balance()) { sfx.deny(); toast(`Undoing that needs <b>${fmt(last.back - balance())}</b> more tokens.`); return; }
    undoStack.pop(); save.spent = (save.spent || 0) + last.back;
    const back = city.place(c.id, c.i, c.j, c.rot, c.seed); for (const f of ['lvl', 'label', 'since', 'nick']) if (c[f] != null) back[f] = c[f];
    popIn(back); sfx.place(BY_ID[c.id].cat); afterChange(); toast('Sale undone.'); return;
  }
  let n = 0;
  while (undoStack.length && undoStack[undoStack.length - 1].kind === 'place' && undoStack[undoStack.length - 1].stroke === last.stroke) {
    const { it } = undoStack.pop(); if (!city.items.includes(it)) continue;
    const def = BY_ID[it.id]; save.spent = Math.max(0, (save.spent || 0) - investedIn(def, it.lvl || 1));
    if (!def.road) crumble(it); city.remove(it); n++;
  }
  if (n) { sfx.sell(); afterChange(); toast(n === 1 ? 'Undone. Tokens returned.' : `Undid ${n} tiles. Tokens returned.`); }
}
function startMove(it) {
  $('#info').hidden = true; city.remove(it); city.rebuild(); moving = it; selected = it.id; rot = it.rot; setMode('build');
  hint(`Moving ${BY_ID[it.id].name} · click a free spot · R to rotate · Esc to cancel`);
}
function showPreview(i, j, ok) {
  if (painting || !selected) return;
  const k = `${selected},${i},${j},${rot},${ok}`; if (k === lastPreview) return; lastPreview = k;
  const def = BY_ID[selected];
  if (def.ground) { hint(`${def.name} · drag to paint${def.cost ? ` · ${def.cost} a tile` : ' · free'}`); return; }
  if (moving) { hint(`Moving ${def.name} · click a free spot · R to rotate · Esc to cancel`); return; }
  if (!ok || def.road || def.path) { hint(`${def.name} · ${PAINT.includes(selected) ? 'click or drag to place · hold Space to move' : 'click to place · drag to move · R to rotate'}`); return; }
  const p = city.preview(selected, i, j, rot), bits = [];
  if (p.pop) bits.push(`${p.pop > 0 ? '+' : ''}${p.pop.toLocaleString()} people`);
  if (p.jobs) bits.push(`+${p.jobs.toLocaleString()} jobs`);
  if (p.joy) bits.push(`${p.joy > 0 ? '+' : ''}${p.joy}% happy`);
  if (!p.open) bits.push('needs a road');
  hint(`${def.name}${bits.length ? ` · ${bits.join(' · ')}` : ''}`);
}
// The Needs map: green homes have everything nearby, amber are missing something, red most things.
let needsOn = false;
const needTile = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.62, depthTest: false, toneMapped: false }), 2400);
needTile.count = 0; needTile.renderOrder = 8; needTile.frustumCulled = false; needTile.visible = false; scene.add(needTile);
function drawNeeds() {
  const M = new THREE.Matrix4(), col = new THREE.Color(); let n = 0;
  for (const it of city.items) {
    const def = BY_ID[it.id]; if (!def.pop) continue;
    const g = city.needsOf(it), met = city.connected(it) ? g.shop + g.green + g.civic : 0, [w, d] = footprint(def, it.rot);
    col.set(['#ff6b57', '#ff9d57', '#f6cf5c', '#6fdc95'][met]);
    for (let a = 0; a < w; a++) for (let b = 0; b < d && n < 2400; b++) { const [x, z] = tileToWorld(it.i + a, it.j + b); M.makeTranslation(x, 0.09, z); needTile.setMatrixAt(n, M); needTile.setColorAt(n++, col); }
  }
  needTile.count = n; needTile.instanceMatrix.needsUpdate = true; if (needTile.instanceColor) needTile.instanceColor.needsUpdate = true;
}
function toggleNeeds(on = !needsOn) {
  needsOn = on; needTile.visible = on; $('#bNeeds').classList.toggle('active', on); $('#needsKey').hidden = !on;
  if (on) { drawNeeds(); guideSee('needs'); }
}
// A short first-time guide. Cities that are already established never see it.
const GUIDE = [
  ['Earn your first 400 tokens', 'Use Claude as usual. Tokens land at City Hall as sparks.', () => earned() >= 400],
  ['Build a second home', 'Open Homes and place one beside a road.', () => city.items.filter((x) => BY_ID[x.id].pop && city.connected(x)).length >= 2],
  ['Open a shop', 'Open Work and place a Corner shop beside a road.', () => city.items.some((x) => BY_ID[x.id].cat === 'shops' && city.connected(x))],
  ['Plant some green space', 'Open Nature and add a Park or Little grove near your homes.', () => city.items.some((x) => ['park', 'grove', 'orchard', 'pond'].includes(x.id))],
  ['See what homes need', 'Press N. Green homes have everything nearby.', () => !!save.guideSeen?.needs],
  ['Become a person', 'Press P to walk around your city.', () => !!save.guideSeen?.walk],
  ['Go inside a building', 'Walk up to your shop and press E.', () => !!save.guideSeen?.inside],
];
function initGuide() { if (save.guide == null) save.guide = city.items.length <= 45 ? 'on' : 'done'; checkGuide(); }
function guideSee(k) { save.guideSeen = save.guideSeen || {}; if (save.guideSeen[k]) return; save.guideSeen[k] = true; persist(); checkGuide(); }
function endGuide(done) { save.guide = 'done'; $('#guide').hidden = true; persist(); if (done) { sfx.goal(); toast('<b>You know the city now.</b> Residents will start asking for things.', 6000); } updateWish(); }
function checkGuide() {
  if (!save || save.guide !== 'on') { $('#guide').hidden = true; return; }
  const k = GUIDE.findIndex((g) => !g[2]());
  if (k < 0) { endGuide(true); return; }
  const key = `${k}`, box = $('#guide'); box.hidden = false;
  if (box.dataset.step === key) return;
  box.dataset.step = key; box.innerHTML = `<small>Getting started · ${k + 1} of ${GUIDE.length}</small><b>${GUIDE[k][0]}</b><span>${GUIDE[k][1]}</span><button id="guideSkip">Skip</button>`;
  $('#guideSkip').onclick = () => endGuide(false);
}
// Residents ask for one thing at a time. Granting wishes earns Civic Pride, which unlocks special buildings.
function updateWish() {
  const box = $('#wish');
  let w = save.wish, home = w && city.items.find((x) => x.i === w.i && x.j === w.j && x.id === w.id);
  if (w && !home) w = save.wish = null;
  if (w && city.needsOf(home)[w.need]) {
    save.pride = (save.pride || 0) + 1; w = save.wish = null; sfx.goal(); life.fireworks(3, HALL, () => sfx.firework());
    const p = new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(home)); floatLabel('Wish granted', p.setY(1.2));
    toast(`People in <b>${placeName(home)}</b> are delighted. <b>+1 Civic Pride</b>`, 5000); refreshItems(); persist();
  }
  if (!w) {
    const open = city.items.filter((x) => BY_ID[x.id].pop && city.connected(x) && Object.keys(NEEDS).some((k) => !city.needsOf(x)[k]));
    if (open.length) { const it = open[Math.floor(Math.random() * open.length)], k = Object.keys(NEEDS).find((n) => !city.needsOf(it)[n]); w = save.wish = { id: it.id, i: it.i, j: it.j, need: k }; home = it; persist(); }
  }
  box.hidden = !w || save.guide === 'on';
  $('#prideN').textContent = save.pride || 0;
  if (w) $('#wishText').innerHTML = `People in <b>${placeName(home)}</b> want ${NEEDS[w.need].word} nearby`;
}
$('#wish').onclick = () => { const w = save.wish; if (!w) return; const it = city.items.find((x) => x.i === w.i && x.j === w.j && x.id === w.id); if (it) { sfx.click(); flyTo(new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(it)).setY(0.2), 7); } };
$('#bNeeds').onclick = () => { sfx.click(); toggleNeeds(); };

// little puffs when something is built
const puffs = [];
const puffGeo = new THREE.IcosahedronGeometry(0.12, 0), puffMat = new THREE.MeshStandardMaterial({ color: '#f4efe4', transparent: true, opacity: 0.9 });
function dust(x, z, s) { for (let k = 0; k < 8; k++) { const m = new THREE.Mesh(puffGeo, puffMat.clone()); const a = (k / 8) * Math.PI * 2; m.position.set(x + Math.cos(a) * 0.3 * s, 0.1, z + Math.sin(a) * 0.3 * s); scene.add(m); puffs.push({ m, v: new THREE.Vector3(Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.8), t: 0 }); } }

// ---------- Living wonders ----------
const beams = [], beamGeo = new THREE.ConeGeometry(0.9, 7, 16, 1, true); beamGeo.translate(0, -3.5, 0); beamGeo.rotateZ(Math.PI / 2);
const beamMat = new THREE.MeshBasicMaterial({ color: '#fff1c0', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
let pads = [], rocketFx = null, rocketTimer = 40;
function collectWonders() {
  for (const b of beams) scene.remove(b); beams.length = 0;
  pads = [];
  for (const it of city.items) {
    const p = new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(it));
    if (it.id === 'lighthouse') { const b = new THREE.Mesh(beamGeo, beamMat); b.position.set(p.x, 2.25, p.z); scene.add(b); beams.push(b); }
    if (it.id === 'rocket') pads.push(p);
  }
}
function launchRocket() {
  if (!pads.length || rocketFx) return;
  const p = pads[Math.floor(Math.random() * pads.length)];
  const b = new Builder(); b.cyl(0, 0, 0, 0.28, 0.28, 1.7, '#faf6ee', 14); b.cone(0, 1.7, 0, 0.28, 0.6, '#d97757', 14); b.cyl(0, -0.25, 0, 0.12, 0.2, 0.25, '#ffb060', 10, { glow: true });
  const g = meshesFrom(b.build()); g.position.set(p.x, 0.12, p.z); scene.add(g);
  rocketFx = { g, t: 0, x: p.x, z: p.z }; sfx.rocket();
  toast('A rocket just launched from the pad. Something big must have shipped.');
}
function updateWonders(dt) {
  beamMat.opacity = world.night * 0.07;
  for (const b of beams) b.rotation.y += dt * 0.9;
  if (pads.length) { rocketTimer -= dt; if (rocketTimer <= 0) { rocketTimer = 150 + Math.random() * 120; launchRocket(); } }
  if (rocketFx) {
    const r = rocketFx; r.t += dt;
    const lift = r.t < 1.2 ? 0 : Math.pow(r.t - 1.2, 2.2) * 1.4;
    r.g.position.y = 0.12 + lift; r.g.position.x = r.x + (r.t < 1.2 ? Math.sin(r.t * 60) * 0.02 : 0);
    if (Math.random() < 0.6) dust(r.x + (Math.random() - 0.5) * 0.6, r.z + (Math.random() - 0.5) * 0.6, 0.4);
    if (r.g.position.y > 60) { scene.remove(r.g); rocketFx = null; }
  }
}

// ---------- Land ----------
function buyLand() {
  if (city.R >= landMax()) return;
  const cost = landCost();
  if (cost > balance()) { sfx.deny(); toast(`More land costs <b>${fmt(cost)}</b> tokens. You have ${fmt(balance())}.`); return; }
  save.spent += cost; save.landBuys = (save.landBuys || 0) + 1;
  city.R = Math.min(landMax(), city.R + landStep()); world.setLand(city.R);
  sfx.land(); toast(`The city grows. You now own <b>${city.R * 2} × ${city.R * 2}</b> tiles.`);
  afterChange();
}

// ---------- Islands ----------
// Finish an island, build an Airport, and you can buy the next one. Each is bigger than the last.
const ISLES = [{ name: 'Home Island', r: 24, price: 0 }, { name: 'Emerald Isle', r: 32, price: 500000 }, { name: 'Amber Isle', r: 42, price: 3000000 }, { name: 'Sapphire Isle', r: 54, price: 12000000 }, { name: 'Grand Isle', r: 68, price: 40000000 }];
const activeIsle = () => save.activeIsland || 0;
const islandRadius = (k) => ISLES[k || 0].r * 1.5;
const landMax = (k = activeIsle()) => ISLES[k].r;
const landStep = (k = activeIsle()) => (k ? Math.max(2, Math.ceil((ISLES[k].r - LAND.start) / 20) * 2) : LAND.step);
const landCost = (k = activeIsle()) => (k ? Math.round(LAND.cost(Math.min(9, save.landBuys || 0)) * (1 + k * 1.5) / 100) * 100 : LAND.cost(save.landBuys || 0));
function ensureIslands() { if (!save.islands) save.islands = [{ name: ISLES[0].name }]; save.activeIsland = save.activeIsland || 0; }
function applyIslandView() { controls.maxDistance = 75 * (islandRadius(activeIsle()) / 36); }
function newIslandData() {
  const items = [{ id: 'hall', i: 23, j: 23, rot: 0, seed: 1 + save.islands.length }, { id: 'airport', i: 25, j: 26, rot: 0, seed: 40 + save.islands.length, free: true }];
  for (let i = 18; i < 30; i++) items.push({ id: 'road', i, j: 25, rot: 0, seed: 0 });
  for (let j = 18; j < 30; j++) if (j !== 25) items.push({ id: 'road', i: 22, j, rot: 0, seed: 0 });
  return { items, land: LAND.start, landBuys: 0, ground: {}, wish: null };
}
const islandData = (k) => (k === activeIsle() ? { items: city.items, land: city.R } : save.islands[k]);
function canBuyNext() { const last = save.islands.length - 1, d = islandData(last); return last < ISLES.length - 1 && d.land >= landMax(last) && d.items.some((x) => x.id === 'airport'); }
function switchIsland(k) {
  if (k === activeIsle()) return;
  const a = activeIsle(); save.islands[a] = { name: ISLES[a].name, items: city.items, land: city.R, landBuys: save.landBuys || 0, ground: city.ground, wish: save.wish || null };
  const d = save.islands[k]; save.items = d.items; save.land = d.land; save.landBuys = d.landBuys || 0; save.ground = d.ground || {}; save.wish = d.wish || null; save.activeIsland = k; save.islands[k] = { name: ISLES[k].name };
  undoStack.length = 0; for (const p of pops) scene.remove(p.g); pops.length = 0; $('#info').hidden = true;
  city.loadIsland(save); world.setIsland(islandRadius(k)); world.setLand(city.R); applyIslandView(); city.rebuild(); lastMarks = null; world.setOccupied(city.treeBlock); collectWonders(); agents.setRoads(city); agents.setCounts(city.stats.pop, world.night); applyFestival(); updateWish();
  const port = city.items.find((x) => x.id === 'airport'), p = port ? new THREE.Vector3().setFromMatrixPosition(city.placementMatrix(port)) : new THREE.Vector3();
  controls.target.set(p.x, 0, p.z); camera.position.set(p.x + 8, 9, p.z + 11); controls.update(); updateHud(true); persist();
}
function flyTo2(k) {
  closeModal(); if (walker.on) walker.leave(); setCat(null); setMode('look'); toggleNeeds(false);
  const from = activeIsle(), fromItems = [...city.items], to = save.islands[k]; controls.enabled = false;
  flight.play({ from: { items: fromItems, radius: islandRadius(from) }, to: { items: to.items, radius: islandRadius(k) }, toName: ISLES[k].name, toSize: `${ISLES[k].r * 2} × ${ISLES[k].r * 2}`, night: world.night, build: (items) => city.modelsGroup(items),
    onSwap: () => switchIsland(k), onDone: () => { controls.enabled = true; sfx.land(); toast(`Welcome to <b>${ISLES[k].name}</b>.`, 4500); } });
}
function openDepartures() {
  const here = activeIsle(), hasPort = city.items.some((x) => x.id === 'airport'), n = save.islands.length;
  const rows = save.islands.map((_, k) => { const d = islandData(k), homes = d.items.filter((x) => !BY_ID[x.id].road).length; return `<div class="dep${k === here ? ' here' : ''}"><span><b>${ISLES[k].name}</b><small>${ISLES[k].r * 2} × ${ISLES[k].r * 2} tiles · ${homes.toLocaleString()} buildings</small></span>${k === here ? '<em>You are here</em>' : `<button class="btn" data-fly="${k}"${hasPort ? '' : ' disabled'}>Fly</button>`}</div>`; }).join('');
  let next = '';
  if (n < ISLES.length) {
    const nx = ISLES[n], ready = canBuyNext(), afford = nx.price <= balance(), last = islandData(n - 1), why = last.land < landMax(n - 1) ? `Own all of ${ISLES[n - 1].name} first` : !last.items.some((x) => x.id === 'airport') ? `Build an Airport on ${ISLES[n - 1].name} first` : !afford ? `${fmt(nx.price - balance())} more tokens needed` : '';
    next = `<div class="dep next"><span><b>${nx.name}</b><small>${nx.r * 2} × ${nx.r * 2} tiles${why ? ` · ${why}` : ''}</small></span><button class="btn" id="buyIsle"${ready && afford ? '' : ' disabled'}>Buy · ${fmt(nx.price)}</button></div>`;
  }
  openModal(`<h2>Departures</h2><p>${hasPort ? 'Where to?' : 'This island needs an Airport before you can fly.'}</p><div class="deps">${rows}${next}</div><div class="foot"><button class="btn ghost" data-close>Close</button></div>`);
  $$('[data-fly]').forEach((b) => { b.onclick = () => flyTo2(Number(b.dataset.fly)); });
  if ($('#buyIsle')) $('#buyIsle').onclick = () => { if (!canBuyNext() || ISLES[n].price > balance()) return; save.spent = (save.spent || 0) + ISLES[n].price; save.islands.push({ name: ISLES[n].name, ...newIslandData() }); persist(); sfx.era(); flyTo2(n); };
}
$('#bIslands').onclick = () => { sfx.click(); openDepartures(); };

// ---------- Keys ----------
addEventListener('keydown', (e) => {
  if (e.target.matches?.('input[type=text], #cityName')) { if (e.key === 'Enter' || e.key === 'Escape') { e.target.blur(); persist(); } return; }
  if (walker.on || flight.active) return;
  if (drift) return;
  if ((e.key === 'p' || e.key === 'P') && $('#modal').hidden && !e.metaKey && !e.ctrlKey) { walker.enter(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'n' || e.key === 'N') toggleNeeds();
  if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (document.body.classList.contains('photo')) exitPhoto(); else { if (cat) setCat(null); setMode('look'); } $('#info').hidden = true; }
  if (e.key === 'r' || e.key === 'R') { rot = (rot + 1) % 4; if (mode === 'build') { const ev = new PointerEvent('pointermove', { clientX: lastMouse[0], clientY: lastMouse[1] }); canvas.dispatchEvent(ev); } }
  if (e.key === 'x' || e.key === 'X') setMode(mode === 'bulldoze' ? 'look' : 'bulldoze');
  if (e.key === 'h' || e.key === 'H') goHome();
  if (e.key === '+' || e.key === '=') zoomBy(0.8);
  if (e.key === '-') zoomBy(1.25);
  if ((e.key === '[' || e.key === ']') && mode === 'build' && BY_ID[selected]?.ground) { brush = Math.max(1, Math.min(5, brush + (e.key === ']' ? 2 : -2))); drawBrush(); }
  if (/^[1-7]$/.test(e.key) && $('#modal').hidden && !e.metaKey && !e.ctrlKey) { const c = CATEGORIES[Number(e.key) - 1].id; setCat(cat === c ? null : c); }
  if (e.key === ' ' || e.key.startsWith('Arrow')) { e.preventDefault(); if (document.activeElement?.tagName === 'BUTTON') document.activeElement.blur(); }
  keys[e.key.toLowerCase()] = true;
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const keys = {}; let lastMouse = [0, 0];
addEventListener('pointermove', (e) => { lastMouse = [e.clientX, e.clientY]; });
$('#cityName').addEventListener('change', persist);

// ---------- Panels ----------
function openModal(html, cls = '') { $('#sheet').className = `sheet ${cls}`; $('#sheet').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; }
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal') || e.target.closest('[data-close]')) closeModal(); });
const SPARK = '<svg viewBox="0 0 24 24" class="big-spark" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><circle cx="12" cy="12" r="6.200" fill="none" stroke="#23120c" stroke-opacity=".42" stroke-width="1.500"/><path d="M12 8.800v6.400M9.800 12h4.400" stroke="#23120c" stroke-opacity=".62" stroke-width="1.700" stroke-linecap="round"/></svg>';
function welcomeNew() {
  openModal(`${SPARK}<h2>Welcome to Contextville</h2>
    <p>Your city starts today, from zero. Every token Claude writes for you from now on lands here as money: watch for sparks falling into City Hall.</p>
    <p>Spend tokens on roads, homes, shops, parks and wonders. Buildings need a road next to them to open. Parks and trees make neighbours happier. Bigger milestones unlock bigger buildings.</p>
    <p><b>Go use Claude.</b> Come back and build.</p><div class="foot"><button class="btn" data-close>Found the city</button></div>`);
}
function welcomeBack(away) {
  openModal(`${SPARK}<h2>Welcome back</h2><p>While you were away, Claude wrote <b>${fmt(away)}</b> tokens for you. They're in the treasury.</p>
    <p>You have <b>${fmt(balance())}</b> tokens to spend.</p><div class="foot"><button class="btn" data-close>Let's build</button></div>`);
  setTimeout(() => sendSpark(away), 900);
}
const TOOL_WORDS = [['Bash', 'commands run'], ['Read', 'files read'], ['Write', 'files written'], ['Edit', 'edits made'], ['WebSearch', 'web searches'], ['Agent', 'helpers sent out']];
$('#bTimes').onclick = () => {
  sfx.click();
  const today = new Date().toISOString().slice(0, 10);
  const heads = usage.headlines || [];
  const lead = heads[0] ? heads[0].title : 'A quiet day in Contextville';
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const figs = [[fmt(usage.days?.[today] || 0), 'tokens today'], [fmt(earned()), 'since founding'], [(usage.replies || 0).toLocaleString(), 'replies from Claude'], [(usage.sessions || 0).toLocaleString(), 'sessions'],
    ...TOOL_WORDS.filter(([k]) => usage.tools?.[k]).map(([k, w]) => [usage.tools[k].toLocaleString(), w])];
  openModal(`<div class="masthead"><h2>The Contextville Times</h2><small>${date} · Population ${city.stats.pop.toLocaleString()} · ${esc($('#cityName').value)}</small></div>
    <div class="cols"><div><small style="font-family:var(--sans);color:var(--ink2);text-transform:uppercase;letter-spacing:.08em;font-size:11px">Today's headline</small><p class="lead">${esc(lead)}</p>
    <ul class="heads">${heads.slice(1, 8).map((h) => `<li>${esc(h.title)}<small>${new Date(h.t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</small></li>`).join('') || '<li>More news as Claude gets to work.</li>'}</ul></div>
    <div><div class="figs">${figs.map(([n, l]) => `<div class="fig"><b>${n}</b><span>${l}</span></div>`).join('')}</div><canvas id="chart" width="600" height="240"></canvas></div></div>
    <div class="foot"><button class="btn ghost" data-close>Close</button></div>`, 'times');
  drawChart($('#chart'));
};
function drawChart(cv) {
  const g = cv.getContext('2d'), days = [];
  for (let k = 13; k >= 0; k--) { const d = new Date(Date.now() - k * 864e5).toISOString().slice(0, 10); days.push([d, usage.days?.[d] || 0]); }
  const max = Math.max(1, ...days.map((d) => d[1])), W = cv.width, H = cv.height, bw = W / days.length;
  g.clearRect(0, 0, W, H); g.font = '20px Inter, sans-serif'; g.fillStyle = '#a5a2a0'; g.fillText('Tokens per day, last 2 weeks', 0, 20);
  days.forEach(([d, v], k) => { const h = (v / max) * (H - 60); g.fillStyle = v ? '#e8825f' : '#2c2c33'; g.fillRect(k * bw + 4, H - 24 - Math.max(2, h), bw - 8, Math.max(2, h)); if (k % 2 === 0) { g.fillStyle = '#74716f'; g.font = '16px Inter'; g.fillText(d.slice(8), k * bw + 6, H - 4); } });
}
$('#bGoals').onclick = () => {
  sfx.click();
  const life = earned();
  const done = save.goals || [];
  openModal(`<h2>Goals</h2><p>City goals</p><ul class="goals">${[...GOALS].sort((x, y) => done.includes(x[0]) - done.includes(y[0])).map(([id, name, , reward]) => `<li class="${done.includes(id) ? 'done' : ''}"><span class="n">${done.includes(id) ? '✓' : '○'}</span><span style="flex:1">${name}</span>${reward ? `<span class="reward">${REWARDS[reward]}</span>` : ''}</li>`).join('')}</ul>
    <p style="margin-top:22px">Milestones: lifetime tokens earned since founding unlock new buildings.</p><ul class="goals">${MILESTONES.map((m) => {
    const un = CATALOG.filter((d) => d.unlock === m).map((d) => d.name);
    const p = Math.min(1, life / m);
    return `<li class="${life >= m ? 'done' : ''}"><span class="n">${fmt(m)}</span><span class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span><small>${un.length ? un.join(', ') : life >= m ? 'Reached' : '—'}</small></li>`;
  }).join('')}</ul><div class="foot"><button class="btn ghost" data-close>Close</button></div>`);
};
$('#bSound').onclick = (e) => { e.stopPropagation(); sfx.ensure(); $('#soundPanel').hidden = !$('#soundPanel').hidden; syncSound(); };
function syncSound() { $('#sOn').textContent = sfx.enabled ? 'Sound on' : 'Turn sound on'; $('#sOn').classList.toggle('on', sfx.enabled); $('#bSound').classList.toggle('off', !sfx.enabled); for (const k of ['music', 'fx', 'amb']) $(`#s-${k}`).value = sfx.volumes[k]; }
$('#sOn').onclick = () => { sfx.ensure(); sfx.enabled = !sfx.enabled; syncSound(); };
for (const k of ['music', 'fx', 'amb']) $(`#s-${k}`).oninput = (e) => sfx.setVolume(k, Number(e.target.value));
$('#soundPanel').onclick = (e) => e.stopPropagation();
addEventListener('pointerdown', (e) => { if (!$('#soundPanel').hidden && !e.target.closest('#soundPanel, #bSound')) $('#soundPanel').hidden = true; });
$('#bHelp').onclick = () => {
  openModal(`<h2>How Contextville works</h2>
    <p>Every token Claude writes for you (in Claude Code, on this computer) after you founded the city becomes money here. They arrive as sparks at City Hall, even while the game is closed.</p>
    <div class="keys"><kbd>Drag</kbd><span>Move around, any time</span><kbd>Right-drag or Option-drag</kbd><span>Turn and tilt</span><kbd>Scroll or pinch</kbd><span>Zoom</span><kbd>Swipe sideways</kbd><span>Turn the city</span><kbd>Q E</kbd><span>Turn</span><kbd>W A S D or arrows</kbd><span>Move around</span><kbd>Double-click</kbd><span>Fly to that spot</span><kbd>H</kbd><span>Back to City Hall</span><kbd>1 to 7</kbd><span>Open a build menu</span><kbd>Space + drag</kbd><span>Move while placing roads</span><kbd>R</kbd><span>Rotate the building you're placing</span><kbd>X</kbd><span>Sell</span><kbd>P</kbd><span>Become a person and walk around</span><kbd>E</kbd><span>While walking: go into or use what's in front of you</span><kbd>N</kbd><span>Show what homes need</span><kbd>Cmd or Ctrl + Z</kbd><span>Undo</span><kbd>Esc or right-click</kbd><span>Stop building</span></div>
    <p>Buildings need a road next to them, or a red marker appears and they stay closed. Homes bring people. Shops and offices give them jobs. Trees, parks and fountains make them happy. A home with shops, green space and services nearby thrives, with 20% more residents. Grant residents' wishes to earn Civic Pride, which unlocks special buildings.</p>
    <label class="autoOpen"><input id="hAuto" type="checkbox"> Open this city when Claude Code starts</label><div class="foot"><button class="btn ghost" id="hReset">Start a new city</button><button class="btn" data-close>Got it</button></div>`);
  fetch('/api/settings').then((r) => r.json()).then((c) => { if ($('#hAuto')) $('#hAuto').checked = c.autoOpen !== false; }).catch(() => {});
  $('#hAuto').onchange = (e) => fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoOpen: e.target.checked }) }).catch(() => {});
  $('#hReset').onclick = async () => { if (!confirm('Start over from zero? Your city will be replaced.')) return; await fetch('/api/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); localStorage.removeItem('claudecity'); location.reload(); };
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function checkMilestones() {
  save.milestones = save.milestones || [];
  const fresh = MILESTONES.filter((m) => earned() >= m && !save.milestones.includes(m));
  if (fresh.length) {
    save.milestones.push(...fresh); persist();
    const un = CATALOG.filter((d) => fresh.includes(d.unlock)).map((d) => `<b>${d.name}</b>`);
    sfx.milestone();
    toast(`Milestone: ${fmt(fresh[fresh.length - 1])} tokens earned.${un.length ? ` Unlocked: ${un.join(', ')}.` : ''}`, 7000);
    refreshItems();
  }
  checkEras(); checkGoals(); checkMoments(); checkGuide();
  if ((save.festivalUntil || 0) && save.festivalUntil < Date.now()) { save.festivalUntil = 0; applyFestival(); persist(); }
}

// A new era is a proper moment. Existing cities are caught up quietly on first load.
function checkEras() {
  const k = eraIndex(earned());
  if (save.era == null) { save.era = k; persist(); return; }
  if (k <= save.era) return;
  save.era = k; persist(); sfx.era(); life.fireworks(14 + k * 2, HALL, () => sfx.firework());
  const un = CATALOG.filter((d) => d.unlock && d.unlock > ERAS[k - 1].at && d.unlock <= ERAS[k].at).map((d) => d.name);
  openModal(`${SPARK}<h2>Era ${k + 1}: ${ERAS[k].name}</h2><p>${ERAS[k].blurb}</p>${un.length ? `<p>Now you can build <b>${un.join(', ')}</b>.</p>` : ''}<div class="foot"><button class="btn" data-close>Keep building</button></div>`);
  refreshItems();
}

// City goals: a checklist that teaches the game. Rewards are little celebrations, never tokens:
// tokens only come from Claude.
const centre = (it) => { const [w, d] = footprint(BY_ID[it.id], it.rot); return [it.i + w / 2, it.j + d / 2]; };
const near = (a, b, dist) => city.items.some((x) => a(x) && city.items.some((y) => y !== x && b(y) && Math.hypot(centre(x)[0] - centre(y)[0], centre(x)[1] - centre(y)[1]) <= dist));
const is = (...ids) => (it) => ids.includes(it.id);
const has = (id) => city.items.some((it) => it.id === id);
const REWARDS = { fireworks: 'Fireworks tonight', festival: 'A street festival', ducks: 'Ducks move in' };
const GOALS = [
  ['cosy', 'Put a bench by a home', () => near(is('bench'), (it) => BY_ID[it.id].pop, 1.8), 'festival'],
  ['cafepark', 'Open a café next to a park', () => near(is('cafe'), is('park', 'pond', 'grove'), 2.6), 'fireworks'],
  ['bakery', 'A bakery and a café side by side', () => near(is('bakery'), is('cafe'), 1.6), 'festival'],
  ['pondgoal', 'Dig a pond', () => city.items.some((it) => it.id === 'pond'), 'ducks'],
  ['lamps', 'Put up 3 street lamps', () => city.items.filter((it) => it.id === 'lamppost').length >= 3, 'fireworks'],
  ['home', 'Build a home', () => city.items.some((it) => BY_ID[it.id].pop)],
  ['work', 'Open a shop or café', () => city.items.some((it) => BY_ID[it.id].jobs && city.connected(it))],
  ['park', 'Plant a park', () => city.items.some((it) => it.id === 'park')],
  ['ten', 'Have 10 buildings', () => city.stats.buildings >= 10],
  ['fifty', 'Reach 50 people', () => city.stats.pop >= 50],
  ['land', 'Buy more land', () => (save.landBuys || 0) >= 1],
  ['happy', 'Get happiness to 75%', () => city.stats.happiness >= 75 && city.stats.pop >= 20],
  ['twohundred', 'Reach 200 people', () => city.stats.pop >= 200],
  ['wonder', 'Build a wonder', () => city.items.some((it) => BY_ID[it.id].cat === 'wonders')],
  ['thousand', 'Reach 1,000 people', () => city.stats.pop >= 1000],
  ['island', 'Own the whole island', () => city.R >= landMax()],
  ['rocket', 'Build the Launch Pad', () => city.items.some((it) => it.id === 'rocket')],
  ['up1', 'Upgrade a building', () => city.items.some((it) => (it.lvl || 1) >= 2), 'festival'],
  ['up3', 'Take a building to level 3', () => city.items.some((it) => (it.lvl || 1) >= 3), 'fireworks'],
  ['hundred', 'Have 100 buildings', () => city.stats.buildings >= 100],
  ['joy90', 'Get happiness to 90% with 1,000 people', () => city.stats.happiness >= 90 && city.stats.pop >= 1000, 'festival'],
  ['market', 'Open the Covered Market beside a park', () => near(is('market'), is('park', 'gardens', 'grove'), 3.5), 'festival'],
  ['fivek', 'Reach 5,000 people', () => city.stats.pop >= 5000, 'fireworks'],
  ['culture', 'Build a museum and a library', () => has('museum') && has('library'), 'festival'],
  ['wheel', 'Put up the Big Wheel', () => has('ferris'), 'fireworks'],
  ['learn', 'Found the University', () => has('university'), 'festival'],
  ['twentyk', 'Reach 20,000 people', () => city.stats.pop >= 20000, 'fireworks'],
  ['fivehundred', 'Have 500 buildings', () => city.stats.buildings >= 500],
  ['lvl25', 'Have 25 buildings at level 3', () => city.items.filter((it) => (it.lvl || 1) >= 3).length >= 25, 'fireworks'],
  ['opera', 'Open the Opera House', () => has('opera'), 'festival'],
  ['archive', 'Complete the Long Archive', () => has('archive'), 'fireworks'],
  ['fiftyk', 'Reach 50,000 people', () => city.stats.pop >= 50000, 'fireworks'],
  ['elevator', 'Raise the Space Elevator', () => has('elevator'), 'fireworks'],
  ['hundredk', 'Reach 100,000 people', () => city.stats.pop >= 100000, 'fireworks'],
  ['last', 'Light The Last Token', () => has('beacon'), 'fireworks'],
];
function checkGoals() {
  save.goals = save.goals || [];
  for (const [id, name, test, reward] of GOALS) if (!save.goals.includes(id) && test()) {
    save.goals.push(id); persist(); sfx.goal();
    toast(`Goal complete: <b>${name}</b>${reward ? ` · ${REWARDS[reward]}!` : ''}`, 6000);
    if (reward) giveReward(reward);
  }
}
const HALL = new THREE.Vector3(0, 0, 0);
function giveReward(r) {
  if (r === 'fireworks') { life.fireworks(6, HALL, () => sfx.firework()); if (world.night < 0.6) save.fireworksPending = true; }
  if (r === 'festival') { save.festivalUntil = Date.now() + 864e5; applyFestival(); }
  if (r === 'ducks') { save.ducks = true; life.setDucks(true); }
  persist();
}
// Bunting over the straight streets near City Hall while a festival is on.
function applyFestival() {
  const tiles = [];
  if ((save.festivalUntil || 0) > Date.now()) for (const it of city.items) {
    if (!BY_ID[it.id].road) continue;
    const ns = city.isRoad(it.i, it.j - 1) && city.isRoad(it.i, it.j + 1) && !city.isRoad(it.i - 1, it.j) && !city.isRoad(it.i + 1, it.j);
    const ew = city.isRoad(it.i - 1, it.j) && city.isRoad(it.i + 1, it.j) && !city.isRoad(it.i, it.j - 1) && !city.isRoad(it.i, it.j + 1);
    const [x, z] = tileToWorld(it.i, it.j);
    if ((ns || ew) && Math.hypot(x, z) < 9 && (it.i + it.j) % 2 === 0) tiles.push([x, z, ns]);
  }
  life.setFestival(tiles);
}
// Claude moments: a big coding day sets off fireworks; every new project gets a free landmark.
const BIG_DAYS = [50000, 200000, 1000000];
function checkMoments() {
  const today = new Date().toISOString().slice(0, 10), n = usage.days?.[today] || 0;
  if (!save.bigDay || save.bigDay.d !== today) save.bigDay = { d: today, lvl: 0 };
  let hit = 0; while (save.bigDay.lvl < BIG_DAYS.length && n >= BIG_DAYS[save.bigDay.lvl]) { save.bigDay.lvl++; hit = BIG_DAYS[save.bigDay.lvl - 1]; }
  if (hit) { life.fireworks(8 + save.bigDay.lvl * 4, HALL, () => sfx.firework()); toast(`Big day! Claude has written <b>${fmt(n)}</b> tokens today. Fireworks over City Hall.`, 7000); persist(); }
  const known = save.knownProjects || (save.knownProjects = []);
  const fresh = (usage.projects || []).filter((p) => !known.includes(p.name));
  if (fresh.length) {
    save.freebies = save.freebies || [];
    for (const p of fresh) { known.push(p.name); save.freebies.push({ label: p.name, t: p.t }); }
    toast(fresh.length === 1 ? `New project: <b>${esc(fresh[0].name)}</b>. A free landmark is waiting in <b>Wonders</b>.` : `<b>${fresh.length}</b> new projects. Free landmarks are waiting in <b>Wonders</b>.`, 7000);
    persist(); refreshItems();
  }
}

// ---------- Photo mode and drift ----------
// Photo mode hides the buttons, lets you pick the time of day and saves a picture.
// Drift slowly circles the city like a screensaver; it starts by itself after 5 quiet minutes.
let photoHour = null, drift = null, lastInput = performance.now();
const fmtHour = (h) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
function enterPhoto() {
  setMode('look'); document.body.classList.add('photo'); $('#photobar').hidden = false;
  const now = new Date(); $('#pTime').value = photoHour ?? now.getHours() + now.getMinutes() / 60; $('#pTimeTxt').textContent = photoHour == null ? 'Now' : fmtHour(photoHour);
  $('#pTilt').classList.toggle('on', tiltOn);
}
function exitPhoto() { stopDrift(); document.body.classList.remove('photo'); $('#photobar').hidden = true; photoHour = null; }
$('#bPhoto').onclick = () => { sfx.click(); enterPhoto(); };
$('#pTime').oninput = (e) => { photoHour = Number(e.target.value); $('#pTimeTxt').textContent = fmtHour(photoHour); };
$('#pNow').onclick = () => { photoHour = null; const n = new Date(); $('#pTime').value = n.getHours() + n.getMinutes() / 60; $('#pTimeTxt').textContent = 'Now'; };
$('#pTilt').onclick = () => { setTilt(!tiltOn); $('#pTilt').classList.toggle('on', tiltOn); };
$('#pDone').onclick = exitPhoto;
$('#pDrift').onclick = () => startDrift(true);
$('#pSave').onclick = () => {
  if (tiltOn) { updateTilt(); composer.render(0); } else renderer.render(scene, camera);
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b);
    a.download = `${($('#cityName').value || 'Contextville').replace(/[^\w -]+/g, '').trim() || 'Contextville'} ${new Date().toISOString().slice(0, 10)}.png`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
  sfx.click();
};
function startDrift(fromPhoto = false) {
  if (drift) return;
  const off = camera.position.clone().sub(controls.target);
  let ext = 4; for (const it of city.items) { const [x, z] = tileToWorld(...centre(it)); ext = Math.max(ext, Math.hypot(x, z)); }
  drift = { ext, a: Math.atan2(off.z, off.x), fromPhoto, wasPhoto: document.body.classList.contains('photo'), t: 0, from: camera.position.clone(), fromT: controls.target.clone() };
  document.body.classList.add('photo', 'drift'); fly = null; $('#info').hidden = true;
}
function stopDrift() {
  if (!drift) return;
  document.body.classList.remove('drift'); if (!drift.wasPhoto) document.body.classList.remove('photo');
  drift = null;
}
function updateDrift(dt) {
  if (!drift) { if (performance.now() - lastInput > 5 * 60e3 && $('#modal').hidden && mode === 'look' && !document.hidden) startDrift(); return; }
  drift.t = Math.min(1, drift.t + dt / 3); drift.a += dt * 0.035;
  const d = Math.min(42, 7 + drift.ext * 1.5), tgt = new THREE.Vector3(0, 0, 0);
  const want = new THREE.Vector3(Math.cos(drift.a) * d, d * 0.62, Math.sin(drift.a) * d);
  const e = drift.t * drift.t * (3 - 2 * drift.t);
  camera.position.lerpVectors(drift.from, want, e); controls.target.lerpVectors(drift.fromT, tgt, e);
}
const wake = (e) => { lastInput = performance.now(); if (drift && !(e.type === 'pointermove' && Math.hypot(e.movementX || 0, e.movementY || 0) < 3)) stopDrift(); };
for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(ev, wake, { capture: true, passive: true });

// ---------- Loop ----------
const timer = new THREE.Timer(); timer.connect(document);
let crowdTimer = 0, lastMarks = null;
const camDir = new THREE.Vector3(), camSide = new THREE.Vector3();
function frame() {
  timer.update();
  const dt = Math.min(0.1, Math.max(0, timer.getDelta()));
  adaptQuality(dt);
  const now = new Date(), h = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  world.setTime(window.__forceHour ?? photoHour ?? h);
  world.update(dt, camera.position, walker.on ? walker.worldPos : controls.target, walker.on ? 8 : camera.position.distanceTo(controls.target));
  updatePops(dt); if (!walker.on) { updateFly(dt); updateDrift(dt); }
  sfx.setRain(world.rainAmount); sfx.setHour(world.hour); sfx.setView(walker.on ? 7 : camera.position.distanceTo(controls.target)); sfx.setGrowth(Math.min(1, (eraIndex(earned()) + Math.log10(city.stats.pop + 1) / 5) / 8));
  if (save.fireworksPending && world.night > 0.7) { save.fireworksPending = false; persist(); life.fireworks(16, HALL, () => sfx.firework()); }
  if (city.marks !== lastMarks) { lastMarks = city.marks; life.setMarks({ ...city.marks, lamp: [...city.marks.lamp, world.pierLamp] }); movers.setMarks(city.marks); }
  movers.update(dt); city.updateGround(world.night);
  if (groundDirty) { groundDirty = false; city.rebuildGround(); world.updateWild(city.R); if (!$('#brush').hidden) drawBrush(); }
  // rain leaves the roads wet and shiny
  if (!city.roadMat.envMap) { const pm = new THREE.PMREMGenerator(renderer); city.roadMat.envMap = pm.fromScene(new RoomEnvironment(), 0.04).texture; pm.dispose(); }
  city.roadMat.roughness = 0.85 - world.rainAmount * 0.65; city.roadMat.envMapIntensity = world.rainAmount * 0.28 * (1 - world.night * 0.7); city.roadMat.color.setScalar(1 - world.rainAmount * 0.42);
  life.update(dt, world.night);
  mats.win.emissiveIntensity = world.night * 1.6;
  sfx.setNight(world.night);
  // keyboard panning
  const pan = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0), side = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
  if (keys.q) orbit(dt * 1.5); if (keys.e) orbit(-dt * 1.5);
  if (Math.abs(turnLeft) > 0.001) { const st = turnLeft * (1 - Math.exp(-9 * dt)); orbit(st); turnLeft -= st; } else turnLeft = 0;
  if (pan || side) {
    camera.getWorldDirection(camDir); camDir.y = 0; camDir.normalize(); camSide.crossVectors(camDir, camera.up).normalize();
    const v = camDir.multiplyScalar(pan).add(camSide.multiplyScalar(side)).multiplyScalar(dt * 14 * Math.max(0.6, camera.position.distanceTo(controls.target) / 25));
    camera.position.add(v); controls.target.add(v);
  }
  { const lim = 30 * world.scale; controls.target.x = Math.max(-lim, Math.min(lim, controls.target.x)); controls.target.z = Math.max(-lim, Math.min(lim, controls.target.z)); }
  if (walker.on) walker.update(dt); else controls.update();
  // people come and go
  crowdTimer -= dt; if (crowdTimer <= 0) { crowdTimer = 2; agents.setCounts(city.stats.pop, world.night); }
  agents.update(dt, world.night);
  // sparks
  for (let k = sparks.length - 1; k >= 0; k--) {
    const s = sparks[k]; s.t += dt / 1.5;
    const t = Math.min(1, s.t), e = t * t;
    const p = new THREE.Vector3().lerpVectors(s.from, s.to, e); p.y += Math.sin(t * Math.PI) * 3;
    s.m.position.copy(p); s.hist.unshift(p.clone()); if (s.hist.length > 30) s.hist.pop();
    s.trail.forEach((tm, i) => { const q = s.hist[Math.min(s.hist.length - 1, (i + 1) * 3)]; if (q) tm.position.copy(q); });
    s.m.rotation.y += dt * 4;
    if (t >= 1) { landSpark(s); sparks.splice(k, 1); }
  }
  updateWonders(dt);
  for (let k = rings.length - 1; k >= 0; k--) { const r = rings[k]; r.t += dt; r.ring.scale.setScalar(1 + r.t * 5); r.ring.material.opacity = Math.max(0, 1 - r.t * 1.2); if (r.t > 1) { scene.remove(r.ring); rings.splice(k, 1); } }
  for (let k = puffs.length - 1; k >= 0; k--) { const p = puffs[k]; p.t += dt; p.m.position.addScaledVector(p.v, dt); p.v.y -= dt * 1.5; p.m.material.opacity = Math.max(0, 0.9 - p.t * 1.5); p.m.scale.setScalar(1 + p.t * 2); if (p.t > 0.6) { scene.remove(p.m); puffs.splice(k, 1); } }
  // counter rolls toward the real balance
  if (Math.abs(shownBalance - shownTarget) > 0.5) { shownBalance += (shownTarget - shownBalance) * Math.min(1, dt * 4); if (Math.abs(shownBalance - shownTarget) < 1) shownBalance = shownTarget; $('#balance').textContent = fmt(shownBalance); updateHud(); }
  // floating labels follow their world point
  const nowMs = performance.now();
  for (let k = labels.length - 1; k >= 0; k--) {
    const l = labels[k]; const v = l.pos.clone().project(camera);
    l.el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; l.el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    if (nowMs - l.born > 2400) { l.el.remove(); labels.splice(k, 1); }
  }
  if (flight.active) { flight.update(dt); renderer.render(flight.scene, flight.camera); return; }
  if (tiltOn && !walker.on) { updateTilt(); composer.render(dt); } else renderer.render(walker.renderScene || scene, camera);
}

// ---------- Is Claude working? ----------
// A small light by the city name. The tab title changes too, and a soft chime plays (if sound is on) when Claude finishes.
const BASE_TITLE = document.title;
let cs = null, csSawWork = false, csOffset = 0;
const span = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
function drawStatus() {
  if (!cs) return;
  const ago = span(Date.now() + csOffset - cs.since), many = cs.count > 1 ? `${cs.count} ` : '';
  const text = cs.state === 'working' ? `${cs.count > 1 ? `${cs.count} working` : 'Working'} · ${ago}` : cs.state === 'waiting' ? `${many ? `${cs.count} need` : 'Needs'} you` : cs.state === 'off' ? 'Not running' : csSawWork ? `Done · ${ago} ago` : 'Idle';
  const box = $('#claudeStatus'), cls = cs.state === 'idle' && csSawWork ? 'done' : cs.state;
  if (box.className !== cls) box.className = cls;
  if ($('#csText').textContent !== text) $('#csText').textContent = text;
  box.title = cs.projects.length ? `Claude: ${cs.projects.join(', ')}` : 'Claude Code status';
  const title = cs.state === 'working' ? `Working · ${BASE_TITLE}` : cs.state === 'waiting' ? `Needs you · ${BASE_TITLE}` : cs.state === 'idle' && csSawWork ? `Done · ${BASE_TITLE}` : BASE_TITLE;
  if (document.title !== title) document.title = title;
}
async function pollStatus() {
  let next; try { const r = await fetch('/api/status'); if (!r.ok) return; next = await r.json(); } catch { return; }
  const was = cs?.state; csOffset = next.now - Date.now(); cs = next;
  if (next.state === 'working' || next.state === 'waiting') csSawWork = true;
  if ((was === 'working' || was === 'waiting') && next.state === 'idle') sfx.goal();
  if (was === 'working' && next.state === 'waiting') sfx.click();
  drawStatus();
}
pollStatus(); setInterval(pollStatus, 1500); setInterval(drawStatus, 1000);

// for automated tests
window.__cc = { flight, openDepartures, canBuyNext, switchIsland, flyToIsland: (k) => flyTo2(k), ISLES, landMax, fillLand, setBrush: (n) => { brush = n; }, checkGuide, guideSee, useThing, makeRoom, hasInside, BY_ID, street, missingOffers, offersFor, balance: () => balance(), walker, sfx, undo, startMove, toggleNeeds, updateWish, get moving() { return moving; }, get pixelRatio() { return pixelRatio; }, get agents() { return agents; }, inspectForTest: (it) => inspect(it), checkErasForTest: () => checkEras(), startDrift, enterPhoto, giveReward, flyTo, setTilt, life, world, scene, renderer, launchRocket, get city() { return city; }, get save() { return save; }, get usage() { return usage; }, sendSpark, setMode, select: (id) => { selected = id; setMode('build'); }, camera, controls, place: (id, i, j, r = 0) => { selected = id; rot = r; tryPlace(i, j, false); }, giveForTest: (n) => { usage.out += n; shownTarget = balance(); updateHud(true); } };
boot();
