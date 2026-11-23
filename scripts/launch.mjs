#!/usr/bin/env node
// Runs when Claude Code starts. It hands off to a background worker straight away, so Claude
// never waits for the city. The worker starts the local server if needed and opens one tab.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const HOME = process.env.CONTEXTVILLE_HOME || path.join(os.homedir(), '.contextville');
const BASE_PORT = Number(process.env.CONTEXTVILLE_PORT || 8800), VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2), force = args.includes('--open');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readHookInput() {
  if (process.stdin.isTTY) return Promise.resolve({});
  return new Promise((done) => {
    let text = ''; const finish = () => { try { done(JSON.parse(text)); } catch { done({}); } };
    process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { text += c; }); process.stdin.on('end', finish); setTimeout(finish, 250);
  });
}
const autoOpen = () => { if (process.env.CONTEXTVILLE_AUTO_OPEN === '0') return false; try { return JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8')).autoOpen !== false; } catch { return true; } };
const noBrowserHere = () => !!process.env.CI || (process.env.CLAUDE_CODE_ENTRYPOINT || '').startsWith('sdk') || ((!!process.env.SSH_CONNECTION || process.platform === 'linux') && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && process.platform !== 'darwin' && process.platform !== 'win32');

function hello(port) {
  return new Promise((done) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/hello', timeout: 700, headers: { Host: `localhost:${port}` } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; }); res.on('end', () => { try { const j = JSON.parse(b); done(j.app === 'contextville' ? j : { other: true }); } catch { done({ other: true }); } });
    });
    req.on('timeout', () => { req.destroy(); done({ other: true }); });
    req.on('error', (e) => done(e.code === 'ECONNREFUSED' ? null : { other: true }));
  });
}
const shutdown = (port) => new Promise((done) => {
  const req = http.request({ host: '127.0.0.1', port, path: '/api/shutdown', method: 'POST', timeout: 900, headers: { Host: `localhost:${port}`, 'Content-Type': 'application/json', 'X-Contextville': '1' } }, (res) => { res.resume(); res.on('end', done); });
  req.on('error', done); req.on('timeout', () => { req.destroy(); done(); }); req.end('{}');
});
function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: String(port) } });
  child.unref();
}
function openBrowser(url) {
  const custom = process.env.CONTEXTVILLE_OPEN_CMD;
  const [cmd, list] = custom ? [custom, [url]] : process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try { const c = spawn(cmd, list, { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => {}); c.unref(); } catch { /* no browser available */ }
}
// several Claude sessions starting together should still only open one tab
function claimOpen() {
  const lock = path.join(HOME, 'open.lock');
  fs.mkdirSync(HOME, { recursive: true });
  try { if (Date.now() - fs.statSync(lock).mtimeMs > 25000) fs.rmSync(lock, { force: true }); } catch { /* no lock yet */ }
  try { fs.closeSync(fs.openSync(lock, 'wx')); return true; } catch { return false; }
}

async function worker() {
  let port = null, info = null;
  for (let p = BASE_PORT; p < BASE_PORT + 10; p++) {
    const h = await hello(p);
    if (h?.other) continue;
    port = p; info = h; break;
  }
  if (port == null) return;
  if (info && info.version !== VERSION) { await shutdown(port); for (let k = 0; k < 20 && await hello(port); k++) await sleep(100); info = null; }
  if (!info) { startServer(port); for (let k = 0; k < 120; k++) { await sleep(150); info = await hello(port); if (info && !info.other) break; } }
  if (!info || info.other) return;
  if (force) { openBrowser(`http://localhost:${port}`); return; }
  if (!info.tabOpen && claimOpen()) openBrowser(`http://localhost:${port}`);
}

if (args.includes('--worker')) await worker();
else {
  const input = force ? {} : await readHookInput();
  const wanted = force || (autoOpen() && !noBrowserHere() && (!input.source || input.source === 'startup' || input.source === 'resume'));
  if (wanted) spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', ...(force ? ['--open'] : [])], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  process.exit(0);
}
