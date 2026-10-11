#!/usr/bin/env node
// pull-media.mjs — fetch media into a local cache for catalog-media. Sources: a local folder/file, a
// Google Drive link or id (workspace creds, else the public link), an Air.inc board share link, or a
// URL (yt-dlp if present, else a direct fetch). Dropbox / OneDrive are reported as not wired yet.
//
// Usage:
//   node tools/pull-media.mjs --source "<link|path>" --out <cache dir> [--workspace <WS>] [--brand <dir>] [--dry-run]
// The workspace comes from --out, --brand, or --workspace. --brand makes a Drive folder pull
// incremental (drive-sources.json); --dry-run lists what a Drive pull would download.
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inferWorkspace, parseArgs, isMedia, findBin, have, catalogPaths } from './lib/catalog.mjs';
import { driveToken, driveGet, hasDriveCreds, listTree, downloadFile, downloadDriveFile, readDriveSources, FOLDER_MIME } from './lib/drive.mjs';

function uniqueName(dir, name) {
  let n = name, i = 1; while (existsSync(join(dir, n))) { const dot = name.lastIndexOf('.'); n = dot > 0 ? `${name.slice(0, dot)}_${i}${name.slice(dot)}` : `${name}_${i}`; i++; } return n;
}

function pullLocal(src, out) {
  let n = 0;
  const walk = (p) => {
    if (statSync(p).isDirectory()) { for (const e of readdirSync(p)) if (!e.startsWith('.') && e !== '_catalog') walk(join(p, e)); }
    else if (isMedia(p)) { copyFileSync(p, join(out, uniqueName(out, basename(p)))); n++; }
  };
  walk(resolve(src));
  return n;
}

function driveId(source) {
  const m = source.match(/\/folders\/([\w-]+)/) || source.match(/\/file\/d\/([\w-]+)/) || source.match(/[?&]id=([\w-]+)/);
  return m ? m[1] : (/^[\w-]{20,}$/.test(source) ? source : null);
}
// Writes <out>/.drive-pull.json (listed, downloaded, skipped, failed) for catalog-media to record.
async function pullDrive(source, out, W, { brand, dryRun } = {}) {
  const id = driveId(source);
  if (!id) { console.error('Could not parse a Drive folder/file id from the source.'); process.exit(1); }
  const token = W && hasDriveCreds(W) ? (await driveToken(W)).token : null;
  const meta = token ? await driveGet(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType&supportsAllDrives=true`, token).catch(() => null) : null;
  if (token && !meta?.mimeType) { console.error(`Drive can't see ${id} with ${W}'s creds — share it with that account.`); process.exit(1); }
  const isFolder = meta ? meta.mimeType === FOLDER_MIME : !/\/file\/d\//.test(source);
  console.log(`Drive ${isFolder ? 'folder' : 'file'} ${id} via ${token ? 'API' : 'public link (no Drive creds)'}`);

  if (!isFolder) {
    if (dryRun) { console.log(`would download ${meta?.name || id}`); return 0; }
    const tmp = join(out, `.dl-${id}`);
    const { filename } = await downloadDriveFile(id, tmp, token);
    const name = meta?.name || filename || `${id}.bin`;
    if (!isMedia(name)) { rmSync(tmp); console.error(`skip ${name}: not a media file`); return 0; }
    renameSync(tmp, join(out, uniqueName(out, name)));
    return 1;
  }

  let tree;
  try { tree = await listTree(id, token); } catch (e) { console.error(e.message); process.exit(1); }
  const seen = (brand && readDriveSources(catalogPaths(brand))[id]?.files) || {};
  const media = tree.files.filter((f) => !f.native && isMedia(f.name));
  const notMedia = tree.files.filter((f) => !media.includes(f)).map((f) => f.name);
  const stale = (f) => f.modifiedTime && seen[f.id]?.modifiedTime && f.modifiedTime > seen[f.id].modifiedTime;
  const todo = media.filter((f) => !seen[f.id] || stale(f));
  const mb = (n) => (n == null ? '' : ` (${(n / 1e6).toFixed(1)} MB)`);
  console.log(`"${tree.name}": ${tree.files.length} files · ${todo.length} new · ${media.length - todo.length} already seen · ${notMedia.length} not media`);
  if (dryRun) { for (const f of todo) console.log(`  would download ${f.name}${mb(f.size)}${stale(f) ? ' [changed]' : ''}`); return 0; }

  const downloaded = [], failed = [];
  for (const f of todo) {
    const file = uniqueName(out, f.name);
    try {
      const { bytes } = await downloadDriveFile(f.id, join(out, file), token);
      downloaded.push({ ...f, size: f.size ?? bytes, file });
      console.log(`  ↓ ${f.name}${mb(bytes)}`);
    } catch (e) { failed.push({ id: f.id, name: f.name, error: e.message }); console.error(`  ✗ ${f.name}: ${e.message}`); }
  }
  writeFileSync(join(out, '.drive-pull.json'), JSON.stringify({ folderId: id, folderName: tree.name, via: token ? 'api' : 'link', listed: media, downloaded, failed, seen: media.length - todo.length, notMedia }, null, 2));
  return downloaded.length;
}

// Air's public share API (no key): fetch each clip's original, not the transcode. Sub-boards aren't walked.
async function pullAir(source, out, { dryRun } = {}) {
  const m = source.match(/air\.inc\/a\/([\w-]+)\/b\/([\w-]+)/);
  if (!m) { console.error('Air: pass a board share link (app.air.inc/a/<id>/b/<board id>).'); process.exit(1); }
  const [, short, boardId] = m;
  const clips = [];
  for (let cursor = null; ;) {
    const r = await fetch(`https://api.air.inc/shorturl/${short}/clips/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 100, boardId, ...(cursor && { cursor }) }) });
    if (!r.ok) { console.error(`Air: board listing -> HTTP ${r.status} (is the board shared by link?)`); process.exit(1); }
    const j = await r.json();
    clips.push(...j.data.clips);
    if (!j.pagination?.hasMore) break;
    cursor = j.pagination.cursor;
  }
  console.log(`Air board ${boardId}: ${clips.length} assets`);
  let n = 0;
  for (const c of clips) {
    const name = `${(c.importedName || c.title || c.id).trim()}.${(c.ext || 'bin').toLowerCase()}`;
    if (!isMedia(name) || !c.assets?.original) { console.error(`  skip ${name}: not media`); continue; }
    if (dryRun) { console.log(`  would download ${name} (${(c.size / 1e6).toFixed(1)} MB)`); continue; }
    const file = uniqueName(out, name);
    try { await downloadFile(c.assets.original, join(out, file)); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); continue; }
    console.log(`  ↓ ${file}`); n++;
  }
  return n;
}

async function pullUrl(source, out) {
  const social = /(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|facebook\.com)/i.test(source);
  if (social || !/\.\w{2,4}($|\?)/.test(source)) {
    if (!have('yt-dlp')) { console.error('This looks like a page/social link — install yt-dlp to pull it (macOS: brew install yt-dlp · Windows: winget install yt-dlp.yt-dlp).'); process.exit(3); }
    const r = spawnSync(findBin('yt-dlp'), ['-o', join(out, '%(title).80s.%(ext)s'), source], { stdio: 'inherit' });
    return r.status === 0 ? 1 : 0;
  }
  try { await downloadFile(source, join(out, uniqueName(out, basename(new URL(source).pathname) || 'download'))); }
  catch (e) { console.error(`fetch ${source} -> ${e.message}`); process.exit(1); }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const source = a.source || a._[0];
  const out = a.out;
  if (!source || !out) { console.error('Usage: node tools/pull-media.mjs --source "<link|path>" --out <cache dir> [--workspace <WS>] [--brand <dir>] [--dry-run]'); process.exit(1); }
  mkdirSync(resolve(out), { recursive: true });
  const W = (a.workspace || inferWorkspace(out) || inferWorkspace(source) || (a.brand && inferWorkspace(a.brand)) || '').toUpperCase();
  let n = 0;
  if (existsSync(source)) n = pullLocal(source, resolve(out));
  else if (/drive\.google\.com/.test(source) || driveId(source)) n = await pullDrive(source, resolve(out), W, { brand: a.brand && resolve(a.brand), dryRun: !!a['dry-run'] });
  else if (/air\.inc\//i.test(source)) n = await pullAir(source, resolve(out), { dryRun: !!a['dry-run'] });
  else if (/dropbox\.com|1drv\.ms|onedrive|sharepoint/i.test(source)) { console.error('Dropbox / OneDrive connectors are not wired yet. Download the folder and pass it as a local path, or use Drive.'); process.exit(3); }
  else if (/^https?:\/\//.test(source)) n = await pullUrl(source, resolve(out));
  else { console.error('Unrecognized source. Use a local path, a Drive link/id, or a URL.'); process.exit(1); }
  if (!a['dry-run']) console.log(`pulled ${n} file${n === 1 ? '' : 's'} → ${resolve(out)}`);
}
