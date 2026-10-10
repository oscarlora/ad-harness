#!/usr/bin/env node
// sync-brand.mjs — mirror a brand's working context to/from Cloudflare R2 for portability, and
// presign media originals for use as generation references. Zero deps (lib/r2.mjs + node:crypto).
//
// R2 is the portable master for ALL brand context; the local workspaces/ tree is a cheap working
// copy (the harness repo carries no brand files). The bucket mirrors the brand tree 1:1 under
//   <Brand>/inputs/...   and   <Brand>/outputs/...
// Two weights:
//   LIGHT (default)    — text + records + the searchable media catalog + brand kit: a few MB,
//                        pulled to start. inputs/*.{md,json,csv} · inputs/media/_catalog/** ·
//                        inputs/media/brand/** · outputs/json/*.json · outputs/index.md
//   HEAVY (--originals) — the big binaries: media originals (inputs/media/<id>_*) and rendered
//                        final ads (outputs/*.{png,mp4,...}). Fetched on demand / pulled explicitly.
//
// Workspace extensions: workspaces/<WS>/_harness/ holds the workspace's private skills
// (skills/<name>/SKILL.md), tools and notes — never in the public repo. It mirrors the bucket prefix
// _harness/ and rides along with every brand: --pull, --push and --status on any brand of the
// workspace also sync it (all files, always — it is small text and code). Pass the _harness dir
// itself to sync only it.
//
// Transfers are deltas: files are compared by content (local md5 vs the object's etag — equal for
// the single-part PUTs this tool makes; multipart etags contain '-', can't be md5-compared, and
// are treated as changed), so both directions skip what's already up to date. Pull and push also
// record the bucket state last seen in <dir>/.sync-state.json (a dotfile, never synced; one per
// brand and one for _harness); push checks it and stops — before uploading anything — if it would
// overwrite work someone else pushed since, unless --force. No state file (never pulled / legacy)
// → no guard. Pull always overwrites local differences: it means "get the team's latest".
// Dotfiles are never synced. Per-workspace creds in .env:
//   <WS>_R2_ACCOUNT_ID  <WS>_R2_ACCESS_KEY_ID  <WS>_R2_SECRET_ACCESS_KEY  <WS>_R2_BUCKET
//
// Usage (path = the brand dir, or any path under it — e.g. .../inputs/media works too):
//   node tools/sync-brand.mjs --brands <workspace>                        list the brands in a workspace's bucket (a name like Acme, or workspaces/Acme)
//   node tools/sync-brand.mjs --pull <brand dir> [--originals]            download changes (skips up-to-date files; heavy too with --originals)
//   node tools/sync-brand.mjs --push <brand dir> [--originals] [--force]  upload changes; stops if it would overwrite someone's newer work (--force proceeds)
//   node tools/sync-brand.mjs --presign <brand dir> <id|relpath> [--expires 3600]   presigned GET URL for an original
//   node tools/sync-brand.mjs --status <brand dir>                        compare local vs cloud by content, one-line report
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, inferWorkspace, inferBrand, brandDirFrom, catalogPaths, mimeOf, parseArgs, isMedia } from './lib/catalog.mjs';
import { r2FromEnv } from './lib/r2.mjs';

const HARNESS = '_harness'; // workspaces/<WS>/_harness ↔ bucket prefix _harness/

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const fp = join(dir, e.name);
    if (e.isDirectory()) walk(fp, out); else out.push(fp);
  }
  return out;
}

// Classify a brand-relative posix path (e.g. "inputs/media/00012_x.png").
const isCatalog = (rel) => rel.includes('/_catalog/');
const isBrandKit = (rel) => rel.startsWith('inputs/media/brand/');
// HEAVY = the big binaries: media originals (flat under inputs/media) + rendered ads under outputs/.
const isHeavy = (rel) => isMedia(rel) && !isCatalog(rel) && !isBrandKit(rel);
// What we mirror at all — skip dotfiles / OS noise (.DS_Store, .sync-state.json, etc.) in any segment.
const isSyncable = (rel) => !rel.split('/').some((seg) => seg.startsWith('.'));

function r2ForWorkspace(workspace) {
  const r2 = r2FromEnv(loadEnv(), workspace);
  if (!r2) {
    const W = workspace.toUpperCase();
    console.error(`\nNo R2 credentials for workspace ${workspace}. Add to .env:`);
    console.error(`  ${W}_R2_ACCOUNT_ID=...\n  ${W}_R2_ACCESS_KEY_ID=...\n  ${W}_R2_SECRET_ACCESS_KEY=...\n  ${W}_R2_BUCKET=...`);
    console.error('(R2 → S3 API token with Object Read & Write on the bucket.)\n');
    process.exit(2);
  }
  return r2;
}

// What a path syncs: a scope is one local dir mirrored under one bucket prefix. A brand path gives
// the brand + its workspace's _harness; the _harness dir alone gives just that. Pure (no network).
//   { kind: 'brand' | 'harness', prefix, dir, heavy(rel), show(rel) }
export function scopesFor(path) {
  const workspace = inferWorkspace(path);
  const name = inferBrand(path);
  if (!workspace || !name || (name.startsWith('_') && name !== HARNESS)) return null;
  const dir = brandDirFrom(path);
  const harness = { kind: 'harness', prefix: HARNESS, dir: join(dirname(dir), HARNESS), heavy: () => false, show: (rel) => `${HARNESS}/${rel}` };
  const scopes = name === HARNESS ? [harness] : [{ kind: 'brand', prefix: name, dir, heavy: isHeavy, show: (rel) => rel }, harness];
  return { workspace, scopes };
}

function requireR2(path) {
  const found = scopesFor(path);
  if (!found) { console.error('Run on a path under workspaces/<Workspace>/<Brand>/... (or workspaces/<Workspace>/_harness)'); process.exit(1); }
  return { r2: r2ForWorkspace(found.workspace), ...found };
}

// Workspace name from --brands' value: a bare name ("Acme") or any path containing workspaces/<WS>.
function workspaceFrom(v) {
  const s = String(v).replace(/\\/g, '/').replace(/\/+$/, '');
  const m = s.match(/(?:^|\/)workspaces\/([^/]+)/);
  return m ? m[1] : s && !s.includes('/') ? s : '';
}

const relOf = (dir, abs) => relative(dir, abs).split('\\').join('/');
const toKey = (scope, abs) => `${scope.prefix}/${relOf(scope.dir, abs)}`;
const toLocal = (scope, key) => join(scope.dir, key.slice(scope.prefix.length + 1));
const keyRel = (scope, key) => key.slice(scope.prefix.length + 1); // scope-relative path from a full key

const selected = (scope, withOriginals) => walk(scope.dir).filter((f) => {
  const rel = relOf(scope.dir, f);
  return isSyncable(rel) && (withOriginals || !scope.heavy(rel));
});

// ---------- content comparison + last-seen bucket state ----------
async function md5File(p) { // streamed, like catalog.sha256File: a big original never sits in memory
  const h = createHash('md5');
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
const comparable = (etag) => !!etag && !etag.includes('-'); // multipart etags aren't md5s → treat as changed
const sameContent = async (abs, o) => comparable(o.etag) && statSync(abs).size === o.size && (await md5File(abs)) === o.etag;

// .sync-state.json — key → etag of the bucket as last seen (written on pull and push). Dotfile → never synced.
const statePath = (dir) => join(dir, '.sync-state.json');
function readState(dir) {
  try { return JSON.parse(readFileSync(statePath(dir), 'utf8')).etags || null; } catch { return null; }
}
function writeState(dir, etags) {
  if (existsSync(dir)) writeFileSync(statePath(dir), JSON.stringify({ syncedAt: new Date().toISOString(), etags }, null, 1));
}

// All syncable remote objects of a scope, keyed by scope-relative path.
async function remoteByRel(r2, scope) {
  const map = new Map();
  for (const o of await r2.listWithMeta(scope.prefix + '/')) {
    const rel = keyRel(scope, o.key);
    if (isSyncable(rel)) map.set(rel, o);
  }
  return map;
}

const nfiles = (n) => `${n} file${n === 1 ? '' : 's'}`;
function deltaSummary(verb, nNew, nUpd, nSame) {
  if (!nNew && !nUpd) return `already up to date — nothing to ${verb === 'pushed' ? 'send' : 'download'} (${nfiles(nSame)})`;
  const parts = [];
  if (nNew) parts.push(`${nNew} new`);
  if (nUpd) parts.push(`${nUpd} updated`);
  return `${verb} ${parts.join(', ')}${nSame ? ` · ${nSame} already up to date` : ''}`;
}
// The brand's line prints as is; the workspace's _harness line is labelled, and skipped when it has no files anywhere.
const report = (scope, line) => console.log(scope.kind === 'brand' ? line : `workspace ${HARNESS}: ${line}`);
const empty = (scope, remote) => scope.kind === 'harness' && !remote.size && !existsSync(scope.dir);

async function push(path, withOriginals, force) {
  const { r2, scopes } = requireR2(path);
  // Plan every scope first, so a conflict anywhere stops the push before anything is uploaded.
  const plans = [];
  for (const scope of scopes) {
    const remote = await remoteByRel(r2, scope);
    if (empty(scope, remote)) continue;
    const seen = readState(scope.dir); // bucket state at last pull/push; null = never synced → no guard
    const toSend = []; let same = 0;
    for (const f of selected(scope, withOriginals)) {
      const rel = relOf(scope.dir, f);
      const o = remote.get(rel);
      if (o && await sameContent(f, o)) { same++; continue; }
      toSend.push({ f, rel, isNew: !o });
    }
    // Overwrite guard: a file we're about to replace changed in the cloud after we last synced.
    const conflicts = seen && !force ? toSend.filter(({ rel, isNew }) => !isNew && remote.get(rel).etag !== seen[rel]).map(({ rel }) => scope.show(rel)) : [];
    plans.push({ scope, remote, toSend, same, conflicts });
  }
  const conflicts = plans.flatMap((p) => p.conflicts);
  if (conflicts.length) {
    console.error(`Someone else saved newer work for this brand after you last downloaded it (${nfiles(conflicts.length)}). Pull the brand first to get their changes, or run again with --force to replace their version with yours.`);
    for (const c of conflicts.slice(0, 10)) console.error(`  ${c}`);
    if (conflicts.length > 10) console.error(`  …and ${conflicts.length - 10} more`);
    process.exit(1);
  }
  for (const { scope, remote, toSend, same } of plans) {
    let nNew = 0, nUpd = 0;
    for (const t of toSend) {
      await r2.putFile(toKey(scope, t.f), t.f, mimeOf(t.f));
      t.isNew ? nNew++ : nUpd++;
      if ((nNew + nUpd) % 25 === 0) console.error(`  …${nNew + nUpd}`);
    }
    const etags = {}; // record the bucket as it stands after this push, so push→push stays quiet
    for (const [rel, o] of remote) etags[rel] = o.etag;
    for (const t of toSend) etags[t.rel] = await md5File(t.f);
    writeState(scope.dir, etags);
    report(scope, deltaSummary('pushed', nNew, nUpd, same));
  }
}

async function pull(path, withOriginals) {
  const { r2, scopes } = requireR2(path);
  for (const scope of scopes) {
    const remote = await remoteByRel(r2, scope);
    if (empty(scope, remote)) continue;
    let nNew = 0, nUpd = 0, same = 0;
    for (const [rel, o] of remote) {
      if (!withOriginals && scope.heavy(rel)) continue;
      const dest = toLocal(scope, o.key);
      if (existsSync(dest) && await sameContent(dest, o)) { same++; continue; }
      const buf = await r2.get(o.key);
      if (!buf) continue; // deleted since listing
      const isNew = !existsSync(dest);
      mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, buf);
      isNew ? nNew++ : nUpd++;
      if ((nNew + nUpd) % 25 === 0) console.error(`  …${nNew + nUpd}`);
    }
    const etags = {}; // record everything listed (heavy included) — the bucket state this pull saw
    for (const [rel, o] of remote) etags[rel] = o.etag;
    writeState(scope.dir, etags);
    report(scope, deltaSummary('downloaded', nNew, nUpd, same));
  }
}

async function presign(path, ref, expires) {
  const { r2, scopes } = requireR2(path);
  const brand = scopes.find((s) => s.kind === 'brand');
  if (!brand) { console.error('--presign takes a brand dir'); process.exit(1); }
  // ref may be a 5-digit id (resolve to the original via its record), a brand-relative path
  // (inputs/... or outputs/...), or a bare media filename (assumed under inputs/media/).
  let rel = ref;
  if (/^\d{5}$/.test(ref)) {
    const recPath = join(catalogPaths(brand.dir).json, `${ref}.json`);
    if (!existsSync(recPath)) { console.error(`no record ${ref}`); process.exit(1); }
    rel = `inputs/media/${JSON.parse(readFileSync(recPath, 'utf8')).file?.name || ref}`;
  } else if (!/^(inputs|outputs)\//.test(ref)) {
    rel = `inputs/media/${ref}`;
  }
  console.log(r2.presignGet(`${brand.prefix}/${rel}`, expires));
}

// One scope's local-vs-cloud comparison as a one-line report.
async function statusLine(r2, scope) {
  const remote = await remoteByRel(r2, scope);
  if (empty(scope, remote)) return null;
  const seen = readState(scope.dir) || {};
  let match = 0, newerHere = 0, newerCloud = 0, bothChanged = 0, onlyHereLight = 0, onlyHereHeavy = 0, cloudLight = 0, cloudHeavy = 0;
  for (const f of walk(scope.dir)) {
    const rel = relOf(scope.dir, f);
    if (!isSyncable(rel)) continue;
    const o = remote.get(rel);
    if (!o) { scope.heavy(rel) ? onlyHereHeavy++ : onlyHereLight++; continue; }
    remote.delete(rel);
    if (await sameContent(f, o)) { match++; continue; }
    const before = seen[rel];
    if (before && comparable(o.etag)) {
      if (o.etag === before) newerHere++;                  // cloud unchanged since last sync → the edit is ours
      else if ((await md5File(f)) === before) newerCloud++; // we're unchanged since last sync → the edit is theirs
      else bothChanged++;
    } else {
      // no last-seen state to compare against — fall back to timestamps
      statSync(f).mtimeMs > Date.parse(o.lastModified || 0) ? newerHere++ : newerCloud++;
    }
  }
  for (const rel of remote.keys()) scope.heavy(rel) ? cloudHeavy++ : cloudLight++;
  const seg = [];
  if (newerHere) seg.push(`${newerHere} newer here`);
  if (newerCloud) seg.push(`${newerCloud} newer in the cloud`);
  if (bothChanged) seg.push(`${bothChanged} changed in both places`);
  if (onlyHereLight) seg.push(`${onlyHereLight} only here (push to send them)`);
  if (onlyHereHeavy) seg.push(`${onlyHereHeavy} only here (push with --originals to send them)`);
  if (cloudLight) seg.push(`${cloudLight} only in the cloud (pull to get them)`);
  if (cloudHeavy) seg.push(`${cloudHeavy} only in the cloud (heavy files not downloaded)`);
  const drift = newerHere + newerCloud + bothChanged + onlyHereLight + onlyHereHeavy + cloudLight;
  if (!drift) return `up to date — ${nfiles(match)} match${seg.length ? ' · ' + seg.join(' · ') : ''}`;
  seg.push(`${match} match`);
  seg[0] = seg[0].replace(/^\d+/, (n) => `${n} file${n === '1' ? '' : 's'}`);
  return seg.join(' · ');
}

async function status(path) {
  const { r2, scopes } = requireR2(path);
  for (const scope of scopes) {
    const line = await statusLine(r2, scope);
    if (line) report(scope, line);
  }
}

// List a workspace bucket's top-level prefixes — each is one brand (names starting with _ , like
// _harness, aren't brands) — with a per-brand file count.
async function listBrands(workspace) {
  const r2 = r2ForWorkspace(workspace);
  const counts = new Map(); // brand -> number of files in the bucket
  for (const o of await r2.listWithMeta()) {
    const i = o.key.indexOf('/');
    if (i <= 0 || !isSyncable(o.key)) continue;
    const brand = o.key.slice(0, i);
    if (brand.startsWith('_')) continue;
    counts.set(brand, (counts.get(brand) || 0) + 1);
  }
  if (!counts.size) { console.log(`No brands in the ${workspace} workspace yet — its bucket is empty.`); return; }
  const names = [...counts.keys()].sort((x, y) => x.localeCompare(y));
  const fmt = (n) => n.toLocaleString('en-US');
  const wName = Math.max(...names.map((n) => n.length));
  const wCount = Math.max(...names.map((n) => fmt(counts.get(n)).length));
  console.log(`Brands in the ${workspace} workspace (${names.length}):`);
  for (const n of names) console.log(`  ${n.padEnd(wName)}  ${fmt(counts.get(n)).padStart(wCount)} ${counts.get(n) === 1 ? 'file' : 'files'}`);
  console.log(`Pull one with: node tools/sync-brand.mjs --pull "workspaces/${workspace}/<Brand>"`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  if (a.brands) { // takes a workspace, not a brand dir — handled before the brand-dir commands
    const ws = workspaceFrom(a.brands === true ? a._[0] || '' : a.brands);
    if (!ws) { console.error('Usage: --brands <workspace>   (a name like Acme, or a path like workspaces/Acme)'); process.exit(1); }
    await listBrands(ws);
    process.exit(0);
  }
  const dir = a.push || a.pull || a.presign || a.status;
  const path = dir && dir !== true ? dir : a._[0] || null;
  if (!path) { console.error('Usage: --pull|--push|--presign|--status <brand dir> [--originals] [--force] [<id|relpath>] [--expires N] | --brands <workspace>'); process.exit(1); }
  if (a.pull) await pull(path, !!a.originals);
  else if (a.push) await push(path, !!a.originals, !!a.force);
  else if (a.presign) await presign(path, a._[0] || (a.presign !== true ? a.presign : null), a.expires ? +a.expires : 3600);
  else if (a.status) await status(path);
  else { console.error('Pick one: --pull | --push | --presign | --status | --brands'); process.exit(1); }
}
