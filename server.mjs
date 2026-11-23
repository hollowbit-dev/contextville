// Contextville local server.
// Serves the game and reads your Claude Code session logs (~/.claude/projects/**.jsonl) on this
// computer to see how many tokens Claude has written. Only usage after you first start the game
// counts, so every city starts from zero. Nothing leaves this machine.
//
//   node server.mjs        then open http://localhost:8800
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT || 8800);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const HOME = process.env.CONTEXTVILLE_HOME || path.join(os.homedir(), '.contextville'); // survives plugin updates
const LOGS = process.env.CLAUDE_LOGS || path.join(CLAUDE_DIR, 'projects');
const SESSIONS = process.env.CLAUDE_SESSIONS || path.join(CLAUDE_DIR, 'sessions');
const SAVE = process.env.SAVE_FILE || path.join(HOME, 'save.json');
const SETTINGS = path.join(HOME, 'config.json');
fs.mkdirSync(path.dirname(SAVE), { recursive: true });
// a city from before the save moved keeps working: it's copied across once, and the original stays put
if (!process.env.SAVE_FILE && !fs.existsSync(SAVE) && fs.existsSync(path.join(ROOT, 'data', 'save.json'))) fs.copyFileSync(path.join(ROOT, 'data', 'save.json'), SAVE);

// ---------- Reading the logs, incrementally ----------
// Logs only ever grow, so for each file we remember how far we've read and parse only new lines.
const files = new Map(); // path -> { offset, rest }
const seen = new Set();  // message ids (one API reply can be split over several lines)
const events = [];       // { t, out, inp, model, tools, session }
const titles = new Map(); // session -> { title, t }
const projects = new Map(); // project folder name -> first time Claude replied there

function walk(dir, depth, out) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth > 0) walk(p, depth - 1, out);
    else if (d.isFile() && d.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function ingestLine(line) {
  if (!line || line.length < 20) return;
  if (!line.includes('"assistant"') && !line.includes('"ai-title"')) return; // skip most lines cheaply
  let d; try { d = JSON.parse(line); } catch { return; }
  if (d.type === 'ai-title') {
    const title = d.title || d.aiTitle; const sid = d.sessionId || d.session_id;
    if (title && sid) titles.set(sid, { title, t: Date.parse(d.timestamp || '') || Date.now() });
    return;
  }
  if (d.type !== 'assistant') return;
  const m = d.message || {}; const id = m.id || d.requestId || d.uuid;
  const tools = (m.content || []).filter((c) => c && c.type === 'tool_use').map((c) => c.name);
  if (seen.has(id)) { // a later line of the same reply: count its tool calls only
    if (tools.length) { const e = events.findLast?.((x) => x.id === id); if (e) e.tools.push(...tools); }
    return;
  }
  seen.add(id);
  const u = m.usage || {};
  const t = Date.parse(d.timestamp || '') || Date.now();
  if (d.cwd) { const name = path.basename(d.cwd); if (name && (!projects.has(name) || projects.get(name) > t)) projects.set(name, t); }
  events.push({
    id, t: Date.parse(d.timestamp || '') || Date.now(),
    out: u.output_tokens || 0,
    inp: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    model: m.model || '', tools, session: d.sessionId || d.session_id || '',
  });
}

function scan() {
  for (const f of walk(LOGS, 3, [])) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    let rec = files.get(f);
    if (!rec) { rec = { offset: 0, rest: '' }; files.set(f, rec); }
    if (st.size < rec.offset) { rec.offset = 0; rec.rest = ''; } // file replaced
    if (st.size === rec.offset) continue;
    const fd = fs.openSync(f, 'r');
    try {
      const len = st.size - rec.offset, buf = Buffer.alloc(Math.min(len, 64 * 1024 * 1024));
      fs.readSync(fd, buf, 0, buf.length, rec.offset);
      rec.offset += buf.length;
      const text = rec.rest + buf.toString('utf8');
      const lines = text.split('\n');
      rec.rest = lines.pop();
      for (const line of lines) ingestLine(line);
    } finally { fs.closeSync(fd); }
  }
  events.sort((a, b) => a.t - b.t);
}

// ---------- Save file (the city itself) ----------
function loadSave() { try { return JSON.parse(fs.readFileSync(SAVE, 'utf8')); } catch { return null; } }
function writeSave(obj) { backup(); const tmp = `${SAVE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, SAVE); }
// One backup of the city per day in data/backups, the last 14 kept.
const BACKUPS = path.join(path.dirname(SAVE), 'backups');
function backup() {
  try {
    if (!fs.existsSync(SAVE)) return;
    const name = `save-${new Date().toISOString().slice(0, 10)}.json`, dest = path.join(BACKUPS, name);
    if (fs.existsSync(dest)) return;
    fs.mkdirSync(BACKUPS, { recursive: true }); fs.copyFileSync(SAVE, dest);
    const old = fs.readdirSync(BACKUPS).filter((f) => /^save-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 14))) fs.rmSync(path.join(BACKUPS, f));
  } catch (e) { console.warn('backup failed:', e.message); }
}

// Usage since the city was founded.
function usage(since, after) {
  const from = Math.max(since || 0, 0);
  let out = 0, inp = 0, replies = 0;
  const tools = {}, days = {}, models = {}, sessions = new Set();
  const recent = [];
  for (const e of events) {
    if (e.t < from) continue;
    out += e.out; inp += e.inp; replies++;
    sessions.add(e.session);
    for (const tl of e.tools) tools[tl] = (tools[tl] || 0) + 1;
    const day = new Date(e.t).toISOString().slice(0, 10);
    days[day] = (days[day] || 0) + e.out;
    if (e.model) models[e.model] = (models[e.model] || 0) + 1;
    if (after && e.t > after) recent.push({ t: e.t, out: e.out, tools: e.tools.length });
  }
  const headlines = [...titles.entries()].filter(([, v]) => v.t >= from).sort((a, b) => b[1].t - a[1].t).slice(0, 12).map(([, v]) => v);
  const newProjects = [...projects.entries()].filter(([, t]) => t >= from).sort((a, b) => a[1] - b[1]).map(([name, t]) => ({ name, t }));
  return { since: from, out, inp, replies, sessions: sessions.size, tools, days, models, recent: recent.slice(-200), headlines, projects: newProjects, now: Date.now() };
}

// ---------- Is Claude working right now? ----------
// Claude Code keeps a small status file for each open session. Files left by closed sessions are ignored.
function claudeStatus() {
  const live = [];
  let names = []; try { names = fs.readdirSync(SESSIONS); } catch { /* no sessions yet */ }
  for (const n of names) {
    if (!/^\d+\.json$/.test(n)) continue;
    let d; try { d = JSON.parse(fs.readFileSync(path.join(SESSIONS, n), 'utf8')); } catch { continue; }
    try { process.kill(d.pid, 0); } catch (e) { if (e.code !== 'EPERM') continue; }
    const raw = String(d.status || 'idle'), state = raw === 'busy' || raw === 'running' ? 'working' : /wait|block|input|permission/i.test(raw) ? 'waiting' : 'idle';
    live.push({ state, since: d.statusUpdatedAt || d.updatedAt || Date.now(), project: path.basename(d.cwd || '') });
  }
  const of = (k) => live.filter((x) => x.state === k);
  const state = !live.length ? 'off' : of('waiting').length ? 'waiting' : of('working').length ? 'working' : 'idle';
  const group = state === 'off' ? [] : of(state);
  return { state, count: group.length, open: live.length, since: group.length ? (state === 'idle' ? Math.max(...group.map((x) => x.since)) : Math.min(...group.map((x) => x.since))) : 0, projects: [...new Set(group.map((x) => x.project).filter(Boolean))], now: Date.now() };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function serveStatic(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

let lastScan = 0, lastTab = 0;
const readSettings = () => { try { return { autoOpen: true, ...JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) }; } catch { return { autoOpen: true }; } };
const inside = (base, rel) => { const f = path.resolve(base, `.${rel}`); return f === base || f.startsWith(base + path.sep) ? f : null; };
const deny = (res, code = 403) => { res.writeHead(code, { 'Content-Type': 'text/plain' }); res.end(code === 403 ? 'Forbidden' : 'Bad request'); };
function readJson(req, res, then) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return deny(res, 415);
  let body = '', size = 0;
  req.on('data', (c) => { size += c.length; if (size > 20e6) { deny(res, 413); req.destroy(); return; } body += c; });
  req.on('end', () => { try { const obj = JSON.parse(body || '{}'); if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object'); then(obj); } catch (e) { json(res, { ok: false, error: e.message }, 400); } });
}
const server = http.createServer((req, res) => {
  // Only this computer's own page may talk to the server: other websites and rebound domains are refused.
  const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  if (!hosts.includes(req.headers.host)) return deny(res);
  const origin = req.headers.origin;
  if (origin && !hosts.some((h) => origin === `http://${h}`)) return deny(res);
  let url; try { url = new URL(req.url, `http://localhost:${PORT}`); } catch { return deny(res, 400); }
  if (url.pathname.startsWith('/api/')) {
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') return deny(res);
    if (url.pathname === '/api/hello') return json(res, { app: 'contextville', version: VERSION, tabOpen: Date.now() - lastTab < 75000 });
    if (url.pathname === '/api/usage') {
      if (Date.now() - lastScan > 1500) { scan(); lastScan = Date.now(); }
      const sv = loadSave();
      return json(res, usage(sv && sv.founded, Number(url.searchParams.get('after') || 0)));
    }
    if (url.pathname === '/api/status') { lastTab = Date.now(); return json(res, claudeStatus()); }
    if (url.pathname === '/api/save' && req.method === 'GET') return json(res, loadSave() || {});
    if (url.pathname === '/api/save' && req.method === 'POST') return readJson(req, res, (obj) => { if (!Array.isArray(obj.items)) throw new Error('not a city'); writeSave(obj); json(res, { ok: true }); });
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, readSettings());
    if (url.pathname === '/api/settings' && req.method === 'POST') return readJson(req, res, (obj) => { const next = { ...readSettings(), autoOpen: obj.autoOpen !== false }; fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(next)); json(res, next); });
    if (url.pathname === '/api/reset' && req.method === 'POST') return readJson(req, res, () => { try { if (fs.existsSync(SAVE)) { fs.mkdirSync(BACKUPS, { recursive: true }); fs.copyFileSync(SAVE, path.join(BACKUPS, `before-reset-${Date.now()}.json`)); } fs.rmSync(SAVE, { force: true }); } catch { /* fine */ } json(res, { ok: true }); });
    if (url.pathname === '/api/shutdown' && req.method === 'POST') { if (req.headers['x-contextville'] !== '1') return deny(res); return readJson(req, res, () => { json(res, { ok: true }); setTimeout(() => process.exit(0), 60); }); }
    return deny(res, 400);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 400);
  // static files, strictly from the game's own folders
  let p; try { p = decodeURIComponent(url.pathname); } catch { return deny(res, 400); }
  if (p.includes('\0')) return deny(res, 400);
  if (p === '/') p = '/web/index.html';
  if (p === '/favicon.ico') p = '/web/favicon.svg';
  const file = p.startsWith('/three/') ? inside(path.join(ROOT, 'vendor', 'three'), p.slice(6)) : p.startsWith('/web/') ? inside(path.join(ROOT, 'web'), p.slice(4)) : null;
  if (!file) return deny(res);
  serveStatic(res, file);
});

const t0 = Date.now(); scan(); backup();
console.log(`Read ${events.length} Claude replies from ${files.size} log files in ${Date.now() - t0} ms.`);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Contextville → http://localhost:${PORT}`);
  if (process.argv.includes('--open')) import('node:child_process').then(({ exec }) => exec(`${process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open'} http://localhost:${PORT}`, () => {}));
});
