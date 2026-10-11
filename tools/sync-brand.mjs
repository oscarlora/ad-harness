#!/usr/bin/env node
// sync-brand.mjs — mirror a brand's context to/from its workspace's R2 bucket, and presign originals.
//
// Usage (path = the brand dir or any path under it):
//   node tools/sync-brand.mjs --brands <workspace>                        list the brands in the bucket (Acme or workspaces/Acme)
//   node tools/sync-brand.mjs --pull <brand dir> [--originals]            download changes (heavy files too with --originals)
//   node tools/sync-brand.mjs --push <brand dir> [--originals] [--force]  upload changes; stops on someone's newer work unless --force
//   node tools/sync-brand.mjs --presign <brand dir> <id|relpath> [--expires 3600]   presigned GET URL for an original
//   node tools/sync-brand.mjs --status <brand dir>                        local vs cloud, one-line report
//
// Bucket keys mirror the brand tree: <Brand>/inputs/..., <Brand>/outputs/...
// Light (default): everything except heavy = media originals (inputs/media/<id>_*) and rendered ads.
// workspaces/<WS>/_custom (private skills/tools) ↔ prefix _custom/<WS>/ (workspaces can share a
// bucket), synced in full with every brand of the workspace; pass the _custom dir to sync only it.
// Files compare by md5 vs etag (multipart etags contain '-' and count as changed). <dir>/.sync-state.json
// records the bucket etags last seen; push refuses to overwrite files changed since. Dotfiles never sync.
// Creds in .env: <WS>_R2_ACCOUNT_ID <WS>_R2_ACCESS_KEY_ID <WS>_R2_SECRET_ACCESS_KEY <WS>_R2_BUCKET
// A public workspace (PUBLIC_BUCKETS in lib/r2.mjs, e.g. Shared) pulls without creds: each push
// writes <Brand>/.manifest.json for that. It never syncs _custom, which would be public.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv, inferWorkspace, inferBrand, brandDirFrom, catalogPaths, mimeOf, parseArgs, isMedia } from './lib/catalog.mjs';
import { r2FromEnv, r2Public, PUBLIC_BUCKETS, MANIFEST } from './lib/r2.mjs';

const CUSTOM = '_custom';

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const fp = join(dir, e.name);
    if (e.isDirectory()) walk(fp, out); else out.push(fp);
  }
  return out;
}

const isCatalog = (rel) => rel.includes('/_catalog/');
const isBrandKit = (rel) => rel.startsWith('inputs/media/brand/');
const isHeavy = (rel) => isMedia(rel) && !isCatalog(rel) && !isBrandKit(rel);
const isSyncable = (rel) => !rel.split('/').some((seg) => seg.startsWith('.'));

function r2ForWorkspace(workspace, readOnly = false) {
  const env = loadEnv();
  const r2 = r2FromEnv(env, workspace) || (readOnly && r2Public(env, workspace));
  if (!r2) {
    const W = workspace.toUpperCase();
    console.error(`\nNo R2 credentials for workspace ${workspace}. Add to .env:`);
    console.error(`  ${W}_R2_ACCOUNT_ID=...\n  ${W}_R2_ACCESS_KEY_ID=...\n  ${W}_R2_SECRET_ACCESS_KEY=...\n  ${W}_R2_BUCKET=...`);
    console.error('(R2 → S3 API token with Object Read & Write on the bucket.)\n');
    process.exit(2);
  }
  return r2;
}

// A scope is one local dir mirrored under one bucket prefix: a brand path gives [brand, _custom].
export function scopesFor(path) {
  const workspace = inferWorkspace(path);
  const name = inferBrand(path);
  if (!workspace || !name || (name.startsWith('_') && name !== CUSTOM)) return null;
  const dir = brandDirFrom(path);
  const isPublic = !!PUBLIC_BUCKETS[workspace];
  if (isPublic && name === CUSTOM) return null;
  const custom = { kind: 'custom', prefix: `${CUSTOM}/${workspace}`, dir: join(dirname(dir), CUSTOM), heavy: () => false, show: (rel) => `${CUSTOM}/${rel}` };
  const brand = { kind: 'brand', prefix: name, dir, heavy: isHeavy, show: (rel) => rel };
  const scopes = name === CUSTOM ? [custom] : isPublic ? [brand] : [brand, custom];
  return { workspace, scopes, isPublic };
}

function requireR2(path, readOnly = false) {
  const found = scopesFor(path);
  if (!found) { console.error('Run on a path under workspaces/<Workspace>/<Brand>/... (or workspaces/<Workspace>/_custom)'); process.exit(1); }
  return { r2: r2ForWorkspace(found.workspace, readOnly), ...found };
}

function workspaceFrom(v) {
  const s = String(v).replace(/\\/g, '/').replace(/\/+$/, '');
  const m = s.match(/(?:^|\/)workspaces\/([^/]+)/);
  return m ? m[1] : s && !s.includes('/') ? s : '';
}

const relOf = (dir, abs) => relative(dir, abs).split('\\').join('/');
const toKey = (scope, abs) => `${scope.prefix}/${relOf(scope.dir, abs)}`;
const toLocal = (scope, key) => join(scope.dir, key.slice(scope.prefix.length + 1));
const keyRel = (scope, key) => key.slice(scope.prefix.length + 1);

const selected = (scope, withOriginals) => walk(scope.dir).filter((f) => {
  const rel = relOf(scope.dir, f);
  return isSyncable(rel) && (withOriginals || !scope.heavy(rel));
});

async function md5File(p) { // streamed: originals can be huge
  const h = createHash('md5');
  for await (const chunk of createReadStream(p, { highWaterMark: 1 << 22 })) h.update(chunk);
  return h.digest('hex');
}
const comparable = (etag) => !!etag && !etag.includes('-');
const sameContent = async (abs, o) => comparable(o.etag) && statSync(abs).size === o.size && (await md5File(abs)) === o.etag;

const statePath = (dir) => join(dir, '.sync-state.json');
function readState(dir) {
  try { return JSON.parse(readFileSync(statePath(dir), 'utf8')).etags || null; } catch { return null; }
}
function writeState(dir, etags) {
  if (existsSync(dir)) writeFileSync(statePath(dir), JSON.stringify({ syncedAt: new Date().toISOString(), etags }, null, 1));
}

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
const report = (scope, line) => console.log(scope.kind === 'brand' ? line : `workspace ${CUSTOM}: ${line}`);
const empty = (scope, remote) => scope.kind === 'custom' && !remote.size && !existsSync(scope.dir);

async function push(path, withOriginals, force) {
  const { r2, scopes, isPublic } = requireR2(path);
  // Plan every scope first so a conflict stops the push before any upload.
  const plans = [];
  for (const scope of scopes) {
    const remote = await remoteByRel(r2, scope);
    if (empty(scope, remote)) continue;
    const seen = readState(scope.dir); // null = never synced → no guard
    const toSend = []; let same = 0;
    for (const f of selected(scope, withOriginals)) {
      const rel = relOf(scope.dir, f);
      const o = remote.get(rel);
      if (o && await sameContent(f, o)) { same++; continue; }
      toSend.push({ f, rel, isNew: !o });
    }
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
    const etags = {};
    for (const [rel, o] of remote) etags[rel] = o.etag;
    for (const t of toSend) etags[t.rel] = await md5File(t.f);
    writeState(scope.dir, etags);
    if (isPublic) {
      const listing = (await r2.listWithMeta(scope.prefix + '/')).filter((o) => isSyncable(keyRel(scope, o.key)));
      await r2.put(`${scope.prefix}/${MANIFEST}`, JSON.stringify(listing), 'application/json');
    }
    report(scope, deltaSummary('pushed', nNew, nUpd, same));
  }
}

async function pull(path, withOriginals) {
  const { r2, scopes } = requireR2(path, true);
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
    const etags = {}; // heavy included: the bucket state this pull saw
    for (const [rel, o] of remote) etags[rel] = o.etag;
    writeState(scope.dir, etags);
    report(scope, deltaSummary('downloaded', nNew, nUpd, same));
  }
}

async function presign(path, ref, expires) {
  const { r2, scopes } = requireR2(path, true);
  const brand = scopes.find((s) => s.kind === 'brand');
  if (!brand) { console.error('--presign takes a brand dir'); process.exit(1); }
  // ref: a 5-digit id, a brand-relative path, or a bare filename under inputs/media/.
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
      // no last-seen state: fall back to timestamps
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
  const { r2, scopes } = requireR2(path, true);
  for (const scope of scopes) {
    const line = await statusLine(r2, scope);
    if (line) report(scope, line);
  }
}

// Top-level prefixes are brands; names starting with _ (like _custom) aren't.
async function listBrands(workspace) {
  const r2 = r2ForWorkspace(workspace);
  const counts = new Map();
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
  if (a.brands) {
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
