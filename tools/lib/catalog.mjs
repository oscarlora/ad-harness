// catalog.mjs — shared helpers for every tool: .env loading, arg parsing, binaries (ffmpeg et al.),
// workspace inference, and the media catalog (content hashing, 5-digit ids, path layout, the record
// skeleton). Zero dependencies.
//
// On-disk layout (mirrored 1:1 to R2):
//   workspaces/<WS>/<Brand>/inputs/media/
//     brand/                      reserved — brand kit, skipped by the catalog
//     _catalog/                   reserved — generated catalog (json, thumbs, sprites, proxies, keyframes, peaks)
//     <id>_<descriptor>.<ext>     the media, flat
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, basename, extname, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESERVED = new Set(['brand', '_catalog']);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function die(message, code = 1) { console.error(`ERROR: ${message}`); process.exit(code); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- external binaries (cross-platform) ----------
// ffmpeg/ffprobe/yt-dlp may be on PATH (brew/winget) or in ~/.local/bin; extend PATH once, here,
// so spawned tools find them too. The unix
// dirs are harmless candidates on Windows.
process.env.PATH = [process.env.PATH || '', join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].join(delimiter);

// Resolve a binary to a spawnable full path by scanning PATH ourselves (`where`/`command -v`
// equivalent — no /bin/sh, which Windows lacks). On Windows also tries <name>.exe, since
// spawn() of a plain name doesn't append it without a shell. Returns the path or null.
const BIN_CACHE = {};
export function findBin(name) {
  if (name in BIN_CACHE) return BIN_CACHE[name];
  const candidates = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const c of candidates) {
      const p = join(dir, c);
      if (existsSync(p)) return (BIN_CACHE[name] = p);
    }
  }
  return (BIN_CACHE[name] = null);
}
export const have = (name) => !!findBin(name);

export function run(bin, args, { allowFail = false, binary = false, cwd } = {}) {
  const r = spawnSync(findBin(bin) || bin, args, { encoding: binary ? 'buffer' : 'utf8', maxBuffer: 1 << 30, cwd });
  if (r.status !== 0 && !allowFail) throw new Error(`${bin} ${args.join(' ')} failed: ${r.stderr || r.error}`);
  return r;
}
// run() without blocking the event loop, so several heavy jobs can overlap: { status, stdout, stderr }.
export function runAsync(bin, args, { allowFail = false, cwd } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(findBin(bin) || bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-20000); });
    p.on('error', (e) => (allowFail ? res({ status: -1, stdout, stderr: String(e) }) : rej(e)));
    p.on('close', (status) => (status !== 0 && !allowFail ? rej(new Error(`${bin} ${args.join(' ')} failed: ${stderr}`)) : res({ status, stdout, stderr })));
  });
}
export function ffprobeJson(file) {
  const r = run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { allowFail: true });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
}

const EXT = {
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'avif'],
  video: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'],
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus'],
};
const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp', avif: 'image/avif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus',
  json: 'application/json', md: 'text/markdown', pdf: 'application/pdf', html: 'text/html', vtt: 'text/vtt', txt: 'text/plain',
};

// MIME type -> extension: the inverse of MIME (first extension wins: jpg, tif), plus aliases some
// providers send. Takes a Content-Type header as is (parameters after ';' ignored); undefined if unknown.
const EXT_FOR_MIME = {
  ...Object.fromEntries(Object.entries(MIME).reverse().map(([e, m]) => [m, e])),
  'image/jpg': 'jpg', 'audio/mp3': 'mp3', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
};
export const extForMime = (ct) => EXT_FOR_MIME[String(ct || '').split(';')[0].trim().toLowerCase()];

export const extOf = (p) => extname(p).slice(1).toLowerCase();
export const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';
export function typeOf(p) {
  const e = extOf(p);
  for (const t of ['image', 'video', 'audio']) if (EXT[t].includes(e)) return t;
  return null; // not a media file we catalog
}
export const isMedia = (p) => typeOf(p) !== null && !basename(p).startsWith('.');

// ---------- .env ----------
// The repo-root .env (found from this file, so tools work from any cwd), else one in `root`.
export function loadEnv(root = REPO_ROOT) {
  for (const f of [...new Set([join(root, '.env'), join(REPO_ROOT, '.env'), resolve('.env')])]) {
    if (existsSync(f)) {
      return Object.fromEntries(
        readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#'))
          .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
      );
    }
  }
  return {};
}
// loadEnv() into process.env, never overriding what the shell already set.
export function applyEnv() {
  for (const [k, v] of Object.entries(loadEnv())) if (!(k in process.env)) process.env[k] = v;
}

export function inferWorkspace(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/([^/]+)\//);
  return m ? m[1] : '';
}

// Brand name from any path under workspaces/<WS>/<Brand>/... (or the brand root itself).
export function inferBrand(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/[^/]+\/([^/]+)(\/|$)/);
  return m ? m[1] : '';
}

// The brand root dir (workspaces/<WS>/<Brand>) from any path under it, or the brand root itself.
export function brandDirFrom(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/^(.*\/workspaces\/[^/]+\/[^/]+)(\/.*)?$/);
  return m ? m[1] : resolve(p);
}

// The brand's product fingerprints (inputs/products.json: [{ name, aliases, look }] or { products }).
export function readProducts(mediaDir) {
  try { const d = JSON.parse(readFileSync(join(dirname(mediaDir), 'products.json'), 'utf8')); return Array.isArray(d) ? d : d.products || []; }
  catch { return []; }
}

// Resolve the brand's inputs/media dir from any path under it (or a brand root).
export function mediaDirFrom(p) {
  const norm = resolve(p).replace(/\\/g, '/');
  const m = norm.match(/^(.*\/inputs\/media)(\/.*)?$/);
  if (m) return m[1];
  return join(resolve(p), 'inputs', 'media');
}

export function catalogPaths(p) {
  const media = mediaDirFrom(p);
  const catalog = join(media, '_catalog');
  return {
    media, catalog,
    json: join(catalog, 'json'), thumbs: join(catalog, 'thumbs'), sprites: join(catalog, 'sprites'),
    proxies: join(catalog, 'proxies'), keyframes: join(catalog, 'keyframes'), peaks: join(catalog, 'peaks'),
    index: join(catalog, 'index.md'), people: join(catalog, 'people.json'),
    driveSources: join(catalog, 'drive-sources.json'), // tracked Drive folders (see lib/drive.mjs)
  };
}
export function ensureDirs(paths) {
  for (const k of ['json', 'thumbs', 'sprites', 'proxies', 'keyframes', 'peaks']) mkdirSync(paths[k], { recursive: true });
}

// ---------- hashing + ids ----------
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export async function sha256File(p) { // streamed: a 500 MB video never sits in memory
  const h = createHash('sha256');
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
export const padId = (n) => String(n).padStart(5, '0');
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

export function readRecords(paths) {
  if (!existsSync(paths.json)) return [];
  return readdirSync(paths.json).filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(readFileSync(join(paths.json, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

const orientationOf = (w, h) => (!w || !h ? 'unknown' : w > h ? 'landscape' : w < h ? 'portrait' : 'square');
const ASPECTS = [[1, 1], [4, 5], [5, 4], [2, 3], [3, 2], [3, 4], [4, 3], [9, 16], [16, 9], [9, 19.5], [1.91, 1]];
function snapAspect(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  let best = null, bestD = Infinity;
  for (const [a, b] of ASPECTS) { const d = Math.abs(r - a / b); if (d < bestD) { bestD = d; best = [a, b]; } }
  return bestD / (w / h) < 0.04 ? `${best[0]}:${best[1]}` : `${Math.round(r * 100) / 100}:1`;
}

// A fresh record skeleton from probe output. analyze-media (Gemini) fills visual_description /
// products / people / tags; record-media.mjs persists it.
export function recordSkeleton({ id, sha256: hash, name, type, mime, bytes, width, height, duration, sourceType = 'brand', sourceName = '' }) {
  const rec = {
    id, sha256: hash,
    file: { name, type, mime, bytes },
    source: { type: sourceType, name: sourceName },
    products: [], people: [], unknown_people: [], tags: [],
    visual_description: '', text_in_media: '',
    status: 'probed',
  };
  if (width) rec.file.width = width;
  if (height) rec.file.height = height;
  if (width && height) { rec.file.orientation = orientationOf(width, height); rec.file.aspect = snapAspect(width, height); }
  if (duration != null) rec.file.duration = duration;
  return rec;
}

// Minimal shared arg parser: --key value, repeatable keys collected into arrays, --flag => true.
// `flags` lists keys that never take a value, so the word after them stays a positional (in `_`).
export function parseArgs(argv, { repeat = [], flags = [] } = {}) {
  const out = {}; const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const key = a.slice(2); const next = argv[i + 1];
    if (flags.includes(key) || next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    if (repeat.includes(key)) { (out[key] ||= []).push(next); } else out[key] = next;
    i++;
  }
  out._ = positionals;
  return out;
}
