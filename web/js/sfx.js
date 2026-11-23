// All sound is made live, with no audio files.
//   Music: an original generative score. Its key and mood follow the time of day, and more
//          instruments join as the city grows. It never plays the same phrase order twice.
//   Sound effects: tuned to the music's current key, so building always sounds in harmony.
//   Ambience: sea, wind, rain, town murmur, birds and crickets, balanced by how far you zoom.
// Sound stays off until you switch it on. Volumes are remembered.

const MOODS = {
  morning: { root: 62, bpm: 74, scale: [0, 2, 4, 7, 9], bright: 2100, prog: [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 16]] },
  day: { root: 65, bpm: 84, scale: [0, 2, 4, 7, 9], bright: 2700, prog: [[0, 4, 7, 14], [-3, 0, 4, 7], [2, 5, 9, 12], [7, 11, 14, 17]] },
  dusk: { root: 60, bpm: 70, scale: [0, 2, 4, 7, 11], bright: 1600, prog: [[5, 9, 12, 16], [4, 7, 11, 14], [-3, 0, 4, 7], [2, 5, 9, 12]] },
  night: { root: 57, bpm: 60, scale: [0, 3, 5, 7, 10], bright: 1050, prog: [[0, 3, 7, 10], [-4, 0, 3, 7], [3, 7, 10, 14], [-2, 2, 5, 9]] },
};
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const stored = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : Number(v); } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

export function makeSfx() {
  let on = false; try { on = localStorage.getItem('cc-sound') === 'on'; } catch { /* private mode */ }
  const vol = { music: stored('cc-vol-music', 0.7), fx: stored('cc-vol-fx', 0.8), amb: stored('cc-vol-amb', 0.6) };
  let ctx = null, out = null, musicBus = null, fxBus = null, ambBus = null, verb = null, keysLP = null, noiseBuf = null, analyser = null;
  let sea = null, wind = null, rainG = null, town = null;
  let rain = 0, night = 0, hour = 12, viewDist = 25, growth = 0, timer = 0, ambT = 0;
  let mood = MOODS.day, moodName = 'day', nextMood = 'day';
  let beat = 0, bar = 0, phrase = 0, nextT = 0, motif = [], notesPlayed = 0, combo = 0, comboT = 0;

  const moodFor = (h) => (h >= 5 && h < 9.5 ? 'morning' : h < 17 ? 'day' : h < 20.5 ? 'dusk' : 'night');
  const r = (a, b) => a + Math.random() * (b - a);

  function impulse(sec, decay) {
    const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n, x = (Math.random() * 2 - 1) * Math.pow(1 - t, decay); lp += (x - lp) * (0.55 - t * 0.4); d[i] = lp; }
    }
    return b;
  }

  function ensure() {
    if (ctx) { if (on && ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5; comp.attack.value = 0.008; comp.release.value = 0.22;
    out = ctx.createGain(); out.gain.value = on ? 0.85 : 0; out.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); fxBus = ctx.createGain(); ambBus = ctx.createGain();
    musicBus.gain.value = vol.music * 1.0; fxBus.gain.value = vol.fx * 1.15; ambBus.gain.value = vol.amb * 0.55;
    for (const b of [musicBus, fxBus, ambBus]) b.connect(out);
    verb = ctx.createConvolver(); verb.buffer = impulse(2.6, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.34; verb.connect(wet); wet.connect(out);
    keysLP = ctx.createBiquadFilter(); keysLP.type = 'lowpass'; keysLP.frequency.value = mood.bright; keysLP.Q.value = 0.3; keysLP.connect(musicBus);
    const n = ctx.sampleRate * 6; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let pink = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; pink = 0.97 * pink + 0.03 * w; d[i] = pink * 3.2 + w * 0.12; }
    const bed = (type, f, q = 0.6) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.loopEnd = 6; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(ambBus); s.start(0, Math.random() * 5); return { g, fl }; };
    sea = bed('lowpass', 520); wind = bed('bandpass', 720, 0.8); rainG = bed('highpass', 2300, 0.4); town = bed('bandpass', 340, 1.2);
    moodName = nextMood = moodFor(hour); mood = MOODS[moodName]; keysLP.frequency.value = mood.bright;
    newMotif(); nextT = ctx.currentTime + 0.25;
    timer = setInterval(tick, 200);
    if (!on) ctx.suspend();
  }

  // ---------- instruments ----------
  function env(g, t, peak, a, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  function voice(type, f, t, peak, a, dur, dest, send = 0, detune = 0) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = f; o.detune.value = detune;
    env(g, t, peak, a, dur); o.connect(g); g.connect(dest);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(verb); }
    o.start(t); o.stop(t + dur + 0.03); notesPlayed++;
    return o;
  }
  const piano = (m, t, v, dur = 1.8) => { const f = hz(m); voice('triangle', f, t, v, 0.006, dur, keysLP, 0.5, r(-3, 3)); voice('sine', f * 2, t, v * 0.26, 0.004, dur * 0.42, keysLP, 0.35); voice('sine', f * 3.01, t, v * 0.06, 0.002, 0.16, keysLP); };
  const kalimba = (m, t, v) => { const f = hz(m); voice('sine', f, t, v, 0.003, 0.7, musicBus, 0.6); voice('sine', f * 5.4, t, v * 0.13, 0.001, 0.07, musicBus, 0.3); };
  const bass = (m, t, v, dur) => { voice('sine', hz(m), t, v, 0.025, dur, musicBus); voice('triangle', hz(m), t, v * 0.22, 0.015, dur * 0.5, keysLP); };
  const pad = (m, t, v, dur) => { for (const dt of [-5, 5]) { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = dt; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.35); g.gain.setValueAtTime(v, t + dur * 0.68); g.gain.linearRampToValueAtTime(0.0001, t + dur * 1.12); o.connect(g); g.connect(padLP()); const s = ctx.createGain(); s.gain.value = 0.5; g.connect(s); s.connect(verb); o.start(t); o.stop(t + dur * 1.15); notesPlayed++; } };
  let padF = null; const padLP = () => { if (!padF) { padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 620; padF.connect(musicBus); } return padF; };
  function hiss(t, dur, f, v, dest = fxBus, type = 'lowpass') {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = ctx.createGain(); env(g, t, v, 0.004, dur);
    s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 5, dur + 0.05);
  }

  // ---------- the composer ----------
  function scaleNote(deg, oct = 0) { const s = mood.scale, k = ((deg % s.length) + s.length) % s.length, o = Math.floor(deg / s.length); return mood.root + 12 + s[k] + 12 * (o + oct); }
  function newMotif() {
    let d = Math.floor(r(2, 6)); motif = [];
    for (let k = 0; k < 8; k++) { if (Math.random() < (k % 2 ? 0.58 : 0.24)) { motif.push(null); continue; } d = clamp(d + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)], 0, 8); motif.push(d); }
    if (motif.every((x) => x == null)) motif[0] = 2;
  }
  function playStep(t, spb) {
    const ch = mood.prog[bar % mood.prog.length], base = mood.root - 12, sec = phrase % 4, sparse = sec === 3, layers = 1 + growth * 3;
    if (beat === 0) {
      pad(base + 12 + ch[0], t, 0.012, spb * 4); pad(base + 12 + ch[2], t, 0.009, spb * 4); pad(base + 24 + ch[1], t, 0.006, spb * 4);
      if (layers >= 1.5 && !sparse) bass(base + ch[0] - (ch[0] > 6 ? 12 : 0), t, 0.1, spb * 3.2);
    }
    if (beat === 5 && layers >= 2.2 && !sparse) bass(base + ch[2] - 12, t, 0.055, spb * 1.2);
    const arp = [0, 2, 1, 3, 2, 1, 3, 2][beat];
    if (!sparse ? beat % 2 === 0 || layers >= 2 : beat === 0 || beat === 4) piano(mood.root + ch[arp], t, (beat === 0 ? 0.075 : 0.044) * r(0.82, 1.1));
    if (!sparse && sec !== 0) {
      const d = motif[(beat + (bar % 2) * 3) % 8];
      if (d != null) { const lift = sec === 2 && bar % 4 >= 2 ? 2 : 0; piano(scaleNote(d + lift), t + r(0, 0.012), 0.082 * r(0.85, 1.08), 2.1); }
    }
    if (layers >= 2.7 && sec === 2 && beat % 4 === 3 && Math.random() < 0.65) kalimba(scaleNote(Math.floor(r(4, 10)), 1), t, 0.035);
    if (layers >= 3.1 && !sparse) { if (beat % 2 === 1) hiss(t, 0.05, 6500, 0.012, musicBus, 'highpass'); if (beat === 4) hiss(t, 0.1, 1500, 0.018, musicBus, 'bandpass'); }
  }
  function tick() {
    if (!ctx || !on || ctx.state !== 'running') return;
    // keep far enough ahead that a throttled background tab still plays smoothly
    const ahead = document.hidden ? 1.6 : 0.5;
    if (nextT < ctx.currentTime - 0.3) nextT = ctx.currentTime + 0.05;
    while (nextT < ctx.currentTime + ahead) {
      const spb = 60 / mood.bpm, step = spb / 2, swing = beat % 2 ? step * 0.16 : -step * 0.04;
      playStep(nextT + swing + step * 0.04, spb);
      nextT += step; beat++;
      if (beat >= 8) {
        beat = 0; bar++;
        if (bar % 8 === 0) {
          phrase++;
          if (phrase % 2 === 0) newMotif();
          nextMood = moodFor(hour);
          if (nextMood !== moodName) { moodName = nextMood; mood = MOODS[moodName]; keysLP.frequency.setTargetAtTime(mood.bright, nextT, 2); }
        }
      }
    }
    ambience();
  }

  // ---------- ambience ----------
  function ambience() {
    const t = ctx.currentTime, zoom = clamp((viewDist - 7) / 40, 0, 1), swell = 0.55 + 0.45 * Math.sin(t * 0.55) * Math.sin(t * 0.21 + 1);
    sea.g.gain.setTargetAtTime((0.05 + zoom * 0.12) * swell, t, 0.8);
    wind.g.gain.setTargetAtTime(0.008 + zoom * 0.045 + rain * 0.02, t, 1.4); wind.fl.frequency.setTargetAtTime(560 + Math.sin(t * 0.13) * 190, t, 2);
    rainG.g.gain.setTargetAtTime(rain * 0.045, t, 1.5);
    town.g.gain.setTargetAtTime((1 - zoom) * (0.008 + growth * 0.035) * (1 - night * 0.65), t, 2);
    if (t < ambT) return;
    ambT = t + r(1.4, 4.6);
    if (rain > 0.4) return;
    if (night < 0.45) bird(t + r(0, 0.5));
    else for (let k = 0, n = 3 + Math.floor(r(0, 4)); k < n; k++) voice('sine', 4300, t + k * 0.075, 0.006, 0.004, 0.038, ambBus, 0.3);
    if (zoom > 0.45 && night < 0.5 && Math.random() < 0.18) { const o = voice('triangle', 1250, t + 0.4, 0.012, 0.05, 0.45, ambBus, 0.8); o.frequency.setValueAtTime(1250, t + 0.4); o.frequency.exponentialRampToValueAtTime(820, t + 0.82); }
  }
  function bird(t) {
    const f = r(2300, 3900), kind = Math.floor(r(0, 3)), n = 2 + Math.floor(r(0, 3));
    for (let k = 0; k < n; k++) { const at = t + k * (kind === 1 ? 0.2 : 0.11), o = voice('sine', f, at, 0.013, 0.008, 0.1, ambBus, 0.7); o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * (kind === 2 ? 0.76 : 1.28), at + 0.075); }
  }

  // ---------- sound effects ----------
  const ready = () => ctx && on && ctx.state === 'running';
  const fx = (type, f, when, v, dur, send = 0.2, slide = 0) => { if (!ready()) return; const t = ctx.currentTime + when, o = voice(type, f, t, v, 0.005, dur, fxBus, send); if (slide) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * slide, t + dur); } };
  const tuned = (deg, oct = 0) => hz(scaleNote(deg, oct));
  const thunk = (f, v) => { if (!ready()) return; const t = ctx.currentTime; fx('sine', f, 0, v, 0.13, 0.08, 0.5); hiss(t, 0.07, 1300, v * 0.5); };
  const CATSOUND = {
    homes: () => { thunk(155, 0.17); fx('triangle', tuned(2), 0.06, 0.045, 0.34, 0.4); fx('triangle', tuned(4), 0.13, 0.04, 0.42, 0.4); },
    shops: () => { thunk(180, 0.14); fx('sine', tuned(5), 0.05, 0.05, 0.5, 0.6); fx('sine', tuned(7), 0.12, 0.04, 0.7, 0.6); },
    civic: () => { thunk(105, 0.22); [0, 2, 4].forEach((d, k) => fx('triangle', tuned(d), 0.07 + k * 0.03, 0.04, 0.85, 0.7)); },
    nature: () => { if (!ready()) return; hiss(ctx.currentTime, 0.14, 2400, 0.04, fxBus, 'bandpass'); fx('sine', tuned(6, 1), 0.03, 0.026, 0.24, 0.6); fx('sine', tuned(8, 1), 0.09, 0.02, 0.28, 0.6); },
    wonders: () => { thunk(72, 0.28); [0, 2, 4, 5, 7].forEach((d, k) => fx('triangle', tuned(d), 0.08 + k * 0.07, 0.05, 1.5, 0.9)); },
  };

  return {
    ensure,
    get enabled() { return on; },
    set enabled(v) {
      on = v; try { localStorage.setItem('cc-sound', v ? 'on' : 'off'); } catch { /* private mode */ }
      if (!ctx) return;
      out.gain.setTargetAtTime(v ? 0.85 : 0, ctx.currentTime, 0.04);
      if (v) { ctx.resume(); nextT = ctx.currentTime + 0.2; } else setTimeout(() => { if (!on) ctx.suspend(); }, 220);
    },
    get volumes() { return { ...vol }; },
    setVolume(k, v) { vol[k] = clamp(v, 0, 1); keep(`cc-vol-${k}`, vol[k]); if (ctx) ({ music: musicBus, fx: fxBus, amb: ambBus })[k].gain.setTargetAtTime(vol[k] * ({ music: 1.0, fx: 1.15, amb: 0.55 })[k], ctx.currentTime, 0.04); },
    setRain(v) { rain = v; },
    setNight(n) { night = n; },
    setHour(h) { hour = h; },
    setView(d) { viewDist = d; },
    setGrowth(g) { growth = clamp(g, 0, 1); },
    step(kind = 'grass', v = 1) { if (!ready()) return; const [f, g, type] = { stone: [2100, 0.034, 'bandpass'], grass: [720, 0.04, 'lowpass'], sand: [1050, 0.03, 'lowpass'], wood: [520, 0.06, 'bandpass'] }[kind] || [800, 0.03, 'lowpass']; hiss(ctx.currentTime, kind === 'wood' ? 0.07 : 0.05, f * r(0.86, 1.16), g * v * r(0.8, 1.1), fxBus, type); if (kind === 'wood') fx('sine', r(135, 165), 0, 0.035 * v, 0.07, 0.1); },
    door() { thunk(120, 0.1); fx('triangle', 240, 0.03, 0.018, 0.16, 0.3, 0.72); },
    // jet engines: a rising roar on take-off, a steady cruise, then settling down to land
    plane(dur) {
      if (!ready()) return null;
      const t = ctx.currentTime, src = ctx.createBufferSource(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), o = ctx.createOscillator(), og = ctx.createGain(); src.buffer = noiseBuf; src.loop = true; src.loopEnd = 6; lp.type = 'lowpass';
      lp.frequency.setValueAtTime(240, t); lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.24); lp.frequency.linearRampToValueAtTime(620, t + dur * 0.5); lp.frequency.linearRampToValueAtTime(380, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.2, t + dur * 0.22); g.gain.linearRampToValueAtTime(0.085, t + dur * 0.5); g.gain.linearRampToValueAtTime(0.11, t + dur * 0.88); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
      o.type = 'sawtooth'; o.frequency.setValueAtTime(62, t); o.frequency.linearRampToValueAtTime(128, t + dur * 0.25); o.frequency.linearRampToValueAtTime(92, t + dur); og.gain.setValueAtTime(0.0001, t); og.gain.linearRampToValueAtTime(0.012, t + dur * 0.25); og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
      src.connect(lp); lp.connect(g); g.connect(fxBus); o.connect(og); og.connect(lp); src.start(t); o.start(t); src.stop(t + dur + 0.3); o.stop(t + dur + 0.3);
      return () => { try { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0.0001, n, 0.08); og.gain.cancelScheduledValues(n); og.gain.setTargetAtTime(0.0001, n, 0.08); src.stop(n + 0.4); o.stop(n + 0.4); } catch { /* already finished */ } };
    },
    coin() { fx('sine', tuned(7, 1), 0, 0.05, 0.16, 0.35); fx('sine', tuned(9, 1), 0.07, 0.045, 0.3, 0.5); },
    eat() { if (!ready()) return; const t = ctx.currentTime; for (let k = 0; k < 3; k++) hiss(t + k * 0.16, 0.07, r(1500, 2600), 0.06, fxBus, 'bandpass'); },
    drink() { for (let k = 0; k < 3; k++) fx('sine', 300 + k * 70, k * 0.17, 0.035, 0.11, 0.15, 1.55); },
    pop() { fx('sine', tuned(4, 1), 0, 0.04, 0.12, 0.3, 1.25); },
    place(cat = 'homes') { (CATSOUND[cat] || CATSOUND.homes)(); },
    // dragging a road climbs the scale, then wraps round
    road() { if (!ready()) return; const now = performance.now(); combo = now - comboT < 650 ? combo + 1 : 0; comboT = now; hiss(ctx.currentTime, 0.045, 850, 0.08); fx('triangle', tuned(combo % 10), 0, 0.034, 0.17, 0.25); },
    sell() { fx('triangle', tuned(4), 0, 0.06, 0.15, 0.3); fx('triangle', tuned(2), 0.08, 0.055, 0.2, 0.3); fx('triangle', tuned(0), 0.17, 0.05, 0.32, 0.4); },
    deny() { fx('triangle', 196, 0, 0.055, 0.11, 0.05); fx('triangle', 165, 0.09, 0.05, 0.16, 0.05); },
    click() { fx('sine', 1180, 0, 0.022, 0.035, 0.05); },
    hover() { fx('sine', 1650, 0, 0.006, 0.025); },
    token(size = 1) { const d = Math.floor(r(4, 9)), v = 0.04 + clamp(size, 0, 3) * 0.012; fx('sine', tuned(d, 1), 0, v, 0.5, 0.75); fx('sine', tuned(d + 2, 1), 0.07, v * 0.7, 0.62, 0.75); if (size > 1.5) fx('sine', tuned(d + 4, 1), 0.14, v * 0.55, 0.8, 0.8); },
    upgrade() { [0, 2, 4, 7].forEach((d, k) => fx('triangle', tuned(d), k * 0.075, 0.055, 0.7, 0.65)); },
    goal() { [2, 4, 7].forEach((d, k) => fx('sine', tuned(d, 1), k * 0.09, 0.05, 0.75, 0.8)); },
    milestone() { [0, 2, 4, 5, 7, 10].forEach((d, k) => fx('triangle', tuned(d), k * 0.095, 0.062, 1.05, 0.8)); },
    era() { thunk(66, 0.3); [0, 4, 7, 9, 12, 14].forEach((d, k) => { fx('triangle', tuned(d), 0.1 + k * 0.13, 0.066, 2.1, 0.9); fx('sine', tuned(d, 1), 0.1 + k * 0.13, 0.025, 1.4, 0.9); }); },
    land() { thunk(92, 0.2); [0, 2, 4].forEach((d, k) => fx('sine', tuned(d), 0.05 + k * 0.1, 0.06, 0.7, 0.6)); },
    firework() { if (!ready()) return; const t = ctx.currentTime; fx('sine', r(900, 1500), 0, 0.012, 0.75, 0.2, 2.1); hiss(t + 0.78, 0.5, 420, 0.22); hiss(t + 0.82, 0.8, 5200, 0.018, fxBus, 'highpass'); },
    rocket() { if (!ready()) return; hiss(ctx.currentTime, 4.5, 260, 0.26); fx('sawtooth', 54, 0, 0.035, 4, 0.5, 2.2); },
    // for automated checks
    debug() {
      if (ctx && !analyser) { analyser = ctx.createAnalyser(); analyser.fftSize = 2048; out.connect(analyser); }
      let peak = 0; if (analyser) { const a = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(a); for (const x of a) peak = Math.max(peak, Math.abs(x)); }
      return { state: ctx?.state, mood: moodName, bar, phrase, notesPlayed, peak, growth };
    },
  };
}
