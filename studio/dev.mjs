// Studio launcher. Runs a BUILT app by default and only rebuilds when the source has
// actually changed, so starting it twice in a row is nearly instant.
//
// Why not `next dev` for everyone: dev mode rebuilds its route manifest continuously, and
// that manifest drifts. The symptom is brutal to diagnose from the outside, because the
// page still loads and most things work: only some API routes quietly answer 404. A
// production build bakes the route table once, so a route that exists on disk is a route
// that answers. Pass --dev when you are editing the app and want hot reload back.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const requestedPort = process.env.PORT || '4179';
const next = join(here, 'node_modules', 'next', 'dist', 'bin', 'next');
const devMode = process.argv.includes('--dev');
// Loopback only by default: the studio can open files and edit records, so it is not for the LAN.
// Set STUDIO_HOST (e.g. 0.0.0.0) only to deliberately expose it; writes still refuse non-local hosts.
const host = process.env.STUDIO_HOST || '127.0.0.1';
const shownHost = host === '127.0.0.1' ? 'localhost' : host;

// Two people (or a person and a Claude session) starting the studio at the same time would
// otherwise both grab port 4179 and fight over the same `next start` process — the second
// launch doesn't fail cleanly, it can knock the first one's server down. So: probe the
// requested port, and if it's taken, walk upward until an actually-free one turns up.
function isPortFree(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    // Probe the exact address Next will bind, so a port read as free is one Next can grab.
    srv.listen(p, host);
  });
}
async function findFreePort(start, tries = 20) {
  for (let p = start; p < start + tries; p++) if (await isPortFree(p)) return p;
  throw new Error(`No free port found in ${start}-${start + tries - 1}. Set PORT to something else.`);
}
const port = String(await findFreePort(Number(requestedPort)));
if (port !== requestedPort) {
  console.log(`Port ${requestedPort} is busy — someone else already has the studio open on this machine.`);
  console.log(`Starting a separate instance on port ${port} instead.\n`);
}

const env = { ...process.env };
// Next allows one dev server per build dir. Whichever port we actually land on (manually
// set, or auto-picked because the default was busy) gets its own dist dir so parallel
// sessions never fight over the same .next lock; the untouched default (4179) keeps .next
// and its warm cache for the common single-user case.
if (port !== '4179') env.NEXT_DIST_DIR = `.next-dev-${port}`;

// Those per-port dirs pile up. Drop each one whose port nothing answers on (and that has not
// changed in 10 minutes, so an instance still building before it listens keeps its dir).
const answers = (p) => new Promise((res) => {
  const s = net.connect(Number(p), host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host);
  s.once('connect', () => { s.destroy(); res(true); }).once('error', () => res(false));
});
for (const name of readdirSync(here).filter((n) => /^\.next-dev-\d+$/.test(n) && n !== `.next-dev-${port}`)) {
  const dir = join(here, name);
  try { if (statSync(dir).mtimeMs > Date.now() - 600_000 || await answers(name.slice(10))) continue; } catch { continue; }
  rmSync(dir, { recursive: true, force: true });
}

// Trust the OS certificate store. Corporate networks that intercept TLS install their root
// there; without this, the build's one fetch (next/font/google downloading Poppins) dies with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE. Child processes inherit NODE_OPTIONS too. The flag exists from
// Node 22.15 / 23.8; an older Node refuses to start with it, so only pass it where it exists.
const [major, minor] = process.versions.node.split('.').map(Number);
const hasSystemCa = major > 23 || (major === 23 && minor >= 8) || (major === 22 && minor >= 15);
if (hasSystemCa && !/--use-system-ca/.test(env.NODE_OPTIONS || '')) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} --use-system-ca`.trim();

const distDir = env.NEXT_DIST_DIR || '.next';
const stampFile = join(here, distDir, '.source-stamp');

// A cheap fingerprint of everything a build depends on: the newest mtime and the file count
// across the app's own source. Cheaper than hashing contents and enough to notice an edit.
function sourceStamp() {
  let newest = 0;
  let files = 0;
  // Dot-entries (.next, .next-dev-*, .git, and the dist dir's .source-stamp) never count.
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|jsx|ts|tsx|css|json|mjs)$/.test(e.name)) continue;
      try { const s = statSync(p); newest = Math.max(newest, s.mtimeMs); files++; } catch { /* vanished mid-walk */ }
    }
  };
  walk(here);
  return `${files}:${Math.round(newest)}`;
}

const run = (args, label) => {
  const r = spawnSync(process.execPath, [next, ...args], { stdio: 'inherit', cwd: here, env });
  if (r.status !== 0) {
    console.error(`\nStudio could not ${label}. The error is above.`);
    process.exit(r.status ?? 1);
  }
};

if (devMode) {
  console.log(`Studio starting in dev mode on http://${shownHost}:${port} (hot reload on).`);
  console.log('If an API route ever answers 404 while the page still loads, restart: dev rebuilds its route table and it can drift.');
  spawn(process.execPath, [next, 'dev', '-H', host, '-p', port], { stdio: 'inherit', cwd: here, env })
    .on('exit', (code) => process.exit(code ?? 0));
} else {
  const stamp = sourceStamp();
  let prior = null;
  try { prior = readFileSync(stampFile, 'utf8').trim(); } catch { /* no build yet */ }
  const built = existsSync(join(here, distDir, 'BUILD_ID'));

  if (!built || prior !== stamp) {
    console.log(built ? 'Studio: the app changed, rebuilding once.' : 'Studio: first run, building the app once.');
    console.log('This takes a minute. Every start after this is immediate until the app changes again.\n');
    run(['build'], 'build');
    try { mkdirSync(join(here, distDir), { recursive: true }); writeFileSync(stampFile, stamp); } catch { /* stamp is an optimisation, not a requirement */ }
  }

  console.log(`\nStudio on http://${shownHost}:${port}\n`);
  spawn(process.execPath, [next, 'start', '-H', host, '-p', port], { stdio: 'inherit', cwd: here, env })
    .on('exit', (code) => process.exit(code ?? 0));
}
