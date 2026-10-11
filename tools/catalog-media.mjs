#!/usr/bin/env node
// catalog-media.mjs — media to searchable library in one command: pull → probe → analyze → embed →
// index → push to R2. Idempotent: duplicates are skipped with their reason. Without --source it
// finishes what is pending and pushes. A Drive folder is tracked in drive-sources.json, so re-runs
// download only new files and remember its --source-type / --source-name. --dry-run lists what would
// be downloaded and stops. --jobs = videos probed at once.
//
// Usage:
//   node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> [--source "<folder|Drive link|URL>"] \
//        [--source-type brand|generated|external] [--source-name "Sept shoot"] [--jobs 2] [--no-push] [--dry-run]
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { catalogPaths, parseArgs, inferWorkspace, loadEnv } from './lib/catalog.mjs';
import { planAndProbe } from './lib/media-probe.mjs';
import { analyzeMany } from './analyze-media.mjs';
import { embedAll } from './embed-media.mjs';
import { buildIndex } from './record-media.mjs';
import { r2FromEnv } from './lib/r2.mjs';
import { requireKey } from './lib/gateway.mjs';
import { readDriveSources, writeDriveSources } from './lib/drive.mjs';

const TOOLS = fileURLToPath(new URL('.', import.meta.url));
const node = (script, args) => spawnSync(process.execPath, [join(TOOLS, script), ...args], { stdio: 'inherit' });

const a = parseArgs(process.argv.slice(2));
if (!a.brand) { console.error('Usage: node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> [--source "<folder|Drive link|URL>"] [--source-type ..] [--source-name ..] [--jobs 2] [--no-push] [--dry-run]'); process.exit(1); }
if (a.jobs) process.env.MEDIA_JOBS = String(a.jobs);
const brand = resolve(a.brand);
const paths = catalogPaths(brand);
const media = paths.media;
if (!a['dry-run']) requireKey(media); // fail before any work

// 1. Pull — local folders are probed in place; links go through pull-media into a temp cache.
let dir = null, cache = null, drive = null;
if (a.source && !existsSync(a.source)) {
  cache = mkdtempSync(join(tmpdir(), 'catalog-'));
  const ok = node('pull-media.mjs', ['--source', a.source, '--out', cache, '--workspace', inferWorkspace(brand), '--brand', brand, ...(a['dry-run'] ? ['--dry-run'] : [])]).status === 0;
  if (!ok || a['dry-run']) { rmSync(cache, { recursive: true, force: true }); process.exit(ok ? 0 : 1); }
  try { drive = JSON.parse(readFileSync(join(cache, '.drive-pull.json'), 'utf8')); } catch {}
  dir = cache;
} else if (a['dry-run']) { console.error('--dry-run needs a Drive folder --source.'); process.exit(1); }
else if (a.source) {
  if (statSync(a.source).isFile()) { console.error('Pass a folder (put single files in a folder).'); process.exit(1); }
  dir = a.source;
}

// A tracked Drive folder keeps its source type/name across runs unless overridden.
const sources = drive ? readDriveSources(paths) : null;
const tracked = drive && (sources[drive.folderId] ||= { folderId: drive.folderId, files: {} });
const sourceType = a['source-type'] || tracked?.sourceType || 'brand';
const sourceName = a['source-name'] || tracked?.sourceName || (drive ? `Drive ${drive.folderName}` : '');

let fresh = 0, newIds = [];
try {
  // 2. Probe + place originals.
  if (dir) {
    const manifest = await planAndProbe({ dir, media, sourceType, sourceName });
    fresh = manifest.filter((m) => !m.existing).length;
    newIds = manifest.filter((m) => !m.existing).map((m) => m.id);
    for (const w of new Set(manifest.flatMap((m) => m.warnings || []))) console.error('WARN: ' + w);
    for (const m of manifest.filter((x) => x.existing && /^same bytes/.test(x.reason))) console.log(`skip ${basename(m.src)} — ${m.reason}`);
    console.log(`${manifest.length} files · ${fresh} new · ${manifest.length - fresh} already cataloged`);

    // Record Drive files now that they have catalog ids.
    if (drive) {
      const idOf = new Map(manifest.map((m) => [basename(m.src), m.id]));
      const now = new Date().toISOString();
      Object.assign(tracked, { sourceType, sourceName, lastCheckedAt: now });
      for (const f of drive.downloaded) tracked.files[f.id] = { name: f.name, modifiedTime: f.modifiedTime, size: f.size, ingestedAt: now, catalogId: idOf.get(f.file) ?? null };
      for (const f of drive.listed) { const t = tracked.files[f.id]; if (t && !t.modifiedTime && f.modifiedTime) Object.assign(t, { modifiedTime: f.modifiedTime, size: f.size }); }
      writeDriveSources(paths, sources);
    }
  }

  // 3. Analyze new files plus any left unanalyzed.
  const res = await analyzeMany({ media, all: true });

  // 4. Vectors + index.
  await embedAll({ media });
  const n = buildIndex(catalogPaths(media));
  console.log(`catalog: ${n} assets · analysis $${res.usd.toFixed(4)}${res.failed.length ? ` · ${res.failed.length} failed analysis (re-run to retry)` : ''}`);

  // 5. Push to R2 when the workspace has creds — originals only when some were added or renamed.
  if (!a['no-push']) {
    if (r2FromEnv(loadEnv(), inferWorkspace(brand))) node('sync-brand.mjs', ['--push', brand, ...(fresh || res.done.length ? ['--originals'] : [])]);
    else console.log('No R2 creds for this workspace — library kept local only.');
  }

  if (drive) {
    console.log(`\nDrive "${drive.folderName}" (${drive.folderId}, via ${drive.via}): ${drive.downloaded.length} new · ${drive.seen} already seen · ${drive.notMedia.length} not media · ${drive.failed.length} failed`);
    console.log(`new catalog ids: ${newIds.join(', ') || 'none'}`);
    for (const f of drive.failed) console.log(`failed: ${f.name} (${f.id}): ${f.error} — retried next run`);
  }
} finally {
  if (cache) rmSync(cache, { recursive: true, force: true });
}
