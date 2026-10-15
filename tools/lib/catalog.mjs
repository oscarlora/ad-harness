// catalog.mjs — shared helpers: .env, arg parsing, binaries, workspace inference, and the media
// catalog (hashing, 5-digit ids, paths, records, the record skeleton).
//
// Layout:
//   workspaces/<WS>/<Brand>/inputs/media/
//     brand/                      reserved — brand kit, skipped by the catalog
//     _catalog/                   reserved — generated catalog (json, thumbs, sprites, proxies, keyframes, peaks)
//     <id>_<descriptor>.<ext>     the media, flat
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdirSync, createReadStream, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve, basename, extname, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RESERVED = new Set(['brand', '_catalog']);
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function die(message, code = 1) { console.error(`ERROR: ${message}`); process.exit(code); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- external binaries ----------
// Extend PATH once so spawned tools find binaries in ~/.local/bin and brew dirs too.
process.env.PATH = [process.env.PATH || '', join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'].join(delimiter);

// Scans PATH ourselves (Windows has no /bin/sh) and tries <name>.exe there, since spawn() won't
// append it without a shell.
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
// run() without blocking the event loop: { status, stdout, stderr }.
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
// The command that writes a JPEG (PNG when `out` ends in .png) of an image fit within px on its
// longest edge, never upscaled: [bin, args] for run()/runAsync(). sips on macOS, ffmpeg elsewhere
// (even dims for its encoder).
export function imageFitCmd(file, px, out) {
  if (have('sips')) return ['sips', ['-s', 'format', extOf(out) === 'png' ? 'png' : 'jpeg', '-Z', String(px), file, '--out', out]];
  const fit = `scale=w='min(iw,${px})':h='min(ih,${px})':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  return ['ffmpeg', ['-y', '-v', 'error', '-i', file, '-frames:v', '1', '-vf', fit, '-q:v', '3', out]];
}
// Note on an ad's record (outputs/json/<id>.json, beside the upload spec) where it was uploaded: sentTo[dest] = url.
// The id is the leading number of the spec's name (the ad folder), else of its _upload_<id>.json file name.
export function markSent(specPath, spec, dest, url) {
  const id = String(spec.name || '').match(/^(\d+)/)?.[1] || basename(specPath).match(/_upload_(\d+)/)?.[1];
  const file = id && join(dirname(specPath), 'json', `${id}.json`);
  if (!file || !existsSync(file)) return;
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  rec.sentTo = { ...rec.sentTo, [dest]: url };
  writeFileSync(file, `${JSON.stringify(rec, null, 2)}\n`);
}
export function ffprobeJson(file) {
  const r = run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file], { allowFail: true });
  try { return JSON.parse(r.stdout || '{}'); } catch { return {}; }
}
// A file's audio as mono 16-bit samples at `rate` Hz, or null.
export function pcm(file, rate) {
  const r = run('ffmpeg', ['-v', 'quiet', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'], { allowFail: true, binary: true });
  return r.stdout?.length ? new Int16Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 2)) : null;
}
export const round = (n, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

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
  json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', md: 'text/markdown', pdf: 'application/pdf', html: 'text/html', vtt: 'text/vtt', txt: 'text/plain',
};

// Takes a Content-Type header as is; first extension wins (jpg, tif); undefined if unknown.
const EXT_FOR_MIME = {
  ...Object.fromEntries(Object.entries(MIME).reverse().map(([e, m]) => [m, e])),
  'image/jpg': 'jpg', 'audio/mp3': 'mp3', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
};
export const extForMime = (ct) => EXT_FOR_MIME[String(ct || '').split(';')[0].trim().toLowerCase()];

const extOf = (p) => extname(p).slice(1).toLowerCase();
export const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';
export function typeOf(p) {
  const e = extOf(p);
  for (const t of ['image', 'video', 'audio']) if (EXT[t].includes(e)) return t;
  return null;
}
export const isMedia = (p) => typeOf(p) !== null && !basename(p).startsWith('.');

// ---------- .env ----------
// The repo-root .env (found from this file, so any cwd works), else one in `root`.
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

// ---------- editing lock ----------
// <ad folder>/.editing.json { session, at }: the ad is being edited and not pushed yet. sync-brand's pull leaves the
// folder alone, push releases it (and leaves out a folder another session holds), and its review notes go to that
// session. Studio's own edits mark it "studio", which any session may take.
export const EDITING = '.editing.json';
export const sessionId = () => process.env.CLAUDE_CODE_SESSION_ID || process.env.ADPK_SESSION || hostname();
export function readEditing(adDir) {
  try { return JSON.parse(readFileSync(join(adDir, EDITING), 'utf8')); } catch { return null; }
}
// Marks the ad as edited by `session` (null: Studio) and returns who holds it: the first session keeps it unless take.
export function markEditing(adDir, session = sessionId(), take = false) {
  const cur = readEditing(adDir)?.session;
  const holder = take || !cur || cur === 'studio' ? session || cur || 'studio' : cur;
  writeFileSync(join(adDir, EDITING), JSON.stringify({ session: holder, at: new Date().toISOString() }) + '\n');
  return holder;
}

export function inferWorkspace(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/([^/]+)\//);
  return m ? m[1] : '';
}

export function inferBrand(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/workspaces\/[^/]+\/([^/]+)(\/|$)/);
  return m ? m[1] : '';
}

export function brandDirFrom(p) {
  const m = resolve(p).replace(/\\/g, '/').match(/^(.*\/workspaces\/[^/]+\/[^/]+)(\/.*)?$/);
  return m ? m[1] : resolve(p);
}

// A brand folder by its name in another system ("Acme Skincare" → workspaces/<WS>/Acme), matched
// loosely; null when none.
export function findBrandDir(workspace, name) {
  const wsDir = join(REPO_ROOT, 'workspaces', workspace);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name || '');
  if (!target || !existsSync(wsDir)) return null;
  const dirs = readdirSync(wsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const hit = dirs.find((d) => norm(d) === target) || dirs.find((d) => norm(d).includes(target) || target.includes(norm(d)));
  return hit ? join(wsDir, hit) : null;
}

// inputs/uploads.json pins where a brand's ads upload: { drive: { folder }, notion: { board | boardId } }.
// `p` is any path inside the brand; {} when the file is missing.
export function readUploads(p) {
  const f = join(brandDirFrom(p), 'inputs', 'uploads.json');
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch (e) { die(`${f}: ${e.message}`); }
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
// What a media dir's brand knows: inputs/products.json ([{ name, aliases, look }] or { products,
// vocabulary }) and _catalog/people.json ([{ name, description }]).
export function readRoster(mediaDir) {
  const d = readJson(join(dirname(mediaDir), 'products.json'));
  const people = readJson(catalogPaths(mediaDir).people);
  return {
    products: Array.isArray(d) ? d : d?.products || [],
    vocabulary: Array.isArray(d?.vocabulary) ? d.vocabulary : [],
    people: Array.isArray(people) ? people : [],
  };
}

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
    driveSources: join(catalog, 'drive-sources.json'),
  };
}
export function ensureDirs(paths) {
  for (const k of ['json', 'thumbs', 'sprites', 'proxies', 'keyframes', 'peaks']) mkdirSync(paths[k], { recursive: true });
}

// ---------- hashing + ids ----------
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
export async function hashFile(p, algo = 'sha256') { // streamed: videos can be huge
  const h = createHash(algo);
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
export const padId = (n) => String(n).padStart(5, '0');
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';

// ---------- records (one JSON file per item in paths.json; record-media.mjs owns the schema) ----------
export function readRecords(paths) {
  if (!existsSync(paths.json)) return [];
  return readdirSync(paths.json).filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(paths.json, f)))
    .filter(Boolean);
}
const recordFile = (paths, id) => join(paths.json, `${id}.json`);
export function readRecord(paths, id) {
  const p = recordFile(paths, id);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
export function writeRecord(paths, rec) {
  if (!rec.id) throw new Error('record needs an id');
  ensureDirs(paths);
  writeFileSync(recordFile(paths, rec.id), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}
// Shallow merge; file/source/sprites/generation one level deep; a transcript is replaced whole; an
// undefined key is dropped. Stamps status=cataloged once a description or transcript exists.
export function mergeRecord(paths, patch) {
  const id = patch.id;
  if (!id) throw new Error('patch needs an id');
  const cur = readRecord(paths, id) || { id };
  const merged = { ...cur, ...patch };
  for (const k of ['file', 'source', 'sprites', 'generation']) {
    if (cur[k] && patch[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k])) merged[k] = { ...cur[k], ...patch[k] };
  }
  const analyzed = merged.visual_description || merged.audio_description || merged.audio_transcript?.text;
  if (analyzed && merged.status === 'probed') merged.status = 'cataloged';
  return writeRecord(paths, merged);
}

// A generated index.md: title, a "N <noun>s. Generated from <from>" line, and a table of rows.
export function indexMarkdown({ title, noun, from, cols, rows }) {
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [
    `# ${title}`, '',
    `${rows.length} ${noun}${rows.length === 1 ? '' : 's'}. Generated from \`${from}\` — do not edit by hand.`, '',
    `| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`), '',
  ].join('\n');
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

// analyze-media fills visual_description / products / people / tags.
export function recordSkeleton({ id, sha256: hash, name, type, mime, bytes, width, height, duration, sourceType = 'brand', sourceName = '' }) {
  const rec = {
    id, sha256: hash,
    file: { name, type, mime, bytes },
    source: { type: sourceType, name: sourceName },
    products: [], people: [], unknown_people: [], tags: [],
    visual_description: '',
    status: 'probed',
  };
  if (width) rec.file.width = width;
  if (height) rec.file.height = height;
  if (width && height) { rec.file.orientation = orientationOf(width, height); rec.file.aspect = snapAspect(width, height); }
  if (duration != null) rec.file.duration = duration;
  return rec;
}

// --key value, repeated keys → arrays, bare --flag → true. `flags` never take a value, so the next
// word stays a positional (in `_`). `help`: the tool's usage text, printed on --help or -h (exit 0).
export function parseArgs(argv, { repeat = [], flags = [], help } = {}) {
  const out = {}; const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (help && (a === '--help' || a === '-h')) { console.log(help); process.exit(0); }
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const key = a.slice(2); const next = argv[i + 1];
    if (flags.includes(key) || next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    if (repeat.includes(key)) { (out[key] ||= []).push(next); } else out[key] = next;
    i++;
  }
  out._ = positionals;
  return out;
}
// Bad usage: the usage text on stderr, exit 1.
export function usage(help) { console.error(help); process.exit(1); }
