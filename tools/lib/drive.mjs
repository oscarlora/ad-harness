// drive.mjs — the Google Drive plumbing shared by pull-media, ingest-media, lib/media-probe, sync-to-drive
// and pull-drive-comments: token refresh from the workspace's creds, checked API calls (driveApi),
// folder listing (API, or the public embedded view for link-shared folders without creds), streamed
// downloads (any URL), uploads, the brand's tracked-folder record, and the brand → ad-group folder
// resolution. Zero npm deps (plain fetch).
//
// Per-workspace creds in .env (written by connect-drive.mjs, plus the destination folder id):
//   <WORKSPACE>_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _FOLDER
//
// Folder resolution (no silent creation):
//   - The brand folder is matched under the workspace folder by *contains* (case-insensitive), so a
//     brand of "Acme" lands in an existing "Acme Ads" folder. An exact match wins; otherwise a single
//     contains-match is used; multiple matches error and ask you to disambiguate.
//   - The group folder is matched by exact name inside the brand folder.
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadEnv, die, sleep, mimeOf } from './catalog.mjs';

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

export const auth = (token) => ({ Authorization: `Bearer ${token}` });
// One Drive API call → its JSON. Throws with the HTTP status and Drive's own message on failure.
export async function driveApi(url, token, { method = 'GET', headers = {}, body } = {}) {
  const r = await fetch(url, { method, headers: { ...auth(token), ...headers }, body });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (!r.ok) throw new Error(`Drive ${method} ${url.split('?')[0]} -> HTTP ${r.status}: ${j.error?.message || text.slice(0, 200)}`);
  return j;
}
export const driveGet = (url, token) => driveApi(url, token);
const credKeys = (W) => ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'].map((k) => `${W.toUpperCase()}_DRIVE_${k}`);
export const hasDriveCreds = (workspace) => { const env = loadEnv(); return credKeys(workspace).every((k) => env[k]); };

// Refresh the workspace's access token. Exits with setup help when creds are missing or revoked.
// needFolder: also require <WS>_DRIVE_FOLDER (the workspace's destination folder). Returns
// { token, folder }.
export async function driveToken(workspace, { needFolder = false } = {}) {
  const W = workspace.toUpperCase();
  const env = loadEnv();
  const [id, secret, refresh] = credKeys(W);
  const keys = { id, secret, refresh, folder: `${W}_DRIVE_FOLDER` };
  const missing = [keys.id, keys.secret, keys.refresh, ...(needFolder ? [keys.folder] : [])].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`\nMissing Google Drive credentials for workspace ${W}: ${missing.join(', ')}`);
    console.error(`First-time setup (one-time consent): download the workspace's OAuth client (Desktop) JSON, then run:`);
    console.error(`   node tools/connect-drive.mjs <oauth-client.json> ${W}`);
    console.error(`That opens a browser consent link and writes the creds into .env.${needFolder ? ` Then set ${keys.folder}=<destination folder id>.` : ''}\n`);
    process.exit(1);
  }
  const tk = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env[keys.id], client_secret: env[keys.secret], refresh_token: env[keys.refresh], grant_type: 'refresh_token' }),
  })).json();
  if (!tk.access_token) {
    console.error('Drive token refresh failed:', tk.error || '(no error code)', tk.error_description || '');
    if (tk.error === 'invalid_grant') console.error(`Refresh token revoked/expired. Re-run: node tools/connect-drive.mjs <oauth-client.json> ${W}`);
    process.exit(1);
  }
  return { token: tk.access_token, folder: env[keys.folder] };
}

// The children of a folder (paginated, sorted by name): [{ id, name, mimeType, modifiedTime, size }].
export async function listChildren(folderId, token, { foldersOnly = false } = {}) {
  const out = [];
  let pageToken;
  do {
    const q = `'${folderId}' in parents and trashed=false` + (foldersOnly ? ` and mimeType='${FOLDER_MIME}'` : '');
    const r = await driveGet(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)&pageSize=200&orderBy=name&${ALL_DRIVES}${pageToken ? `&pageToken=${pageToken}` : ''}`, token);
    out.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

// ---------- tracked folders: list everything, download only what's new ----------
// Without creds a link-shared ("anyone with the link") folder is read through Drive's public
// embedded view: ids + names only (no modifiedTime/size), Google-native docs show as non-files.
const NATIVE = 'application/vnd.google-apps.native';
const unescape = (s) => s.replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
async function publicFolder(folderId) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`);
  const html = r.ok ? await r.text() : '';
  if (!html.includes('flip-entries')) throw new Error(`Drive folder ${folderId} isn't readable without creds (HTTP ${r.status}). Share it as "anyone with the link", or connect Drive: node tools/connect-drive.mjs <oauth-client.json> <WS>`);
  const name = unescape((html.match(/<title>([^<]*)/) || [])[1] || '');
  const files = [...html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g)]
    .map(([, id, href, title]) => ({ id, name: unescape(title), mimeType: href.includes('/drive/folders/') ? FOLDER_MIME : href.includes('/file/d/') ? null : NATIVE, modifiedTime: null, size: null }));
  return { name, files };
}

// A folder's name and every file under it, recursing into subfolders. `token` null → public view.
// Returns { name, files: [{ id, name, mimeType, modifiedTime, size, native }] }.
export async function listTree(folderId, token) {
  const name = token ? (await driveGet(`${API}/files/${folderId}?fields=name&supportsAllDrives=true`, token)).name : null;
  const files = [], seen = new Set();
  let rootName = name;
  async function walk(id) {
    if (seen.has(id)) return; seen.add(id);
    const kids = token ? await listChildren(id, token) : await publicFolder(id).then((p) => { if (id === folderId) rootName = p.name; return p.files; });
    for (const f of kids) {
      if (f.mimeType === FOLDER_MIME) await walk(f.id);
      else files.push({ ...f, size: f.size != null ? +f.size : null, native: !!f.mimeType && f.mimeType.startsWith('application/vnd.google-apps.') });
    }
  }
  await walk(folderId);
  return { name: rootName, files };
}

// Download a URL to `dest` (streamed, up to 3 tries). A web page in place of the file (not shared,
// quota, virus-scan wall) counts as failure. Returns { bytes, filename } (filename from
// Content-Disposition, for files whose name isn't known).
export async function downloadFile(url, dest, headers = {}) {
  mkdirSync(dirname(dest), { recursive: true });
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (/text\/html/i.test(r.headers.get('content-type') || '')) throw new Error('Drive returned a web page, not the file');
      await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
      const head = Buffer.alloc(64); const fd = openSync(dest, 'r'); readSync(fd, head, 0, 64, 0); closeSync(fd);
      if (/^\s*<(!doctype|html)/i.test(head.toString('latin1'))) throw new Error('Drive returned a web page, not the file');
      const cd = r.headers.get('content-disposition') || '';
      const filename = decodeURIComponent((cd.match(/filename\*=UTF-8''([^;]+)/i) || [])[1] || '') || (cd.match(/filename="([^"]+)"/i) || [])[1] || null;
      return { bytes: statSync(dest).size, filename };
    } catch (e) { last = e; rmSync(dest, { force: true }); if (i < 3) await sleep(2000 * i); }
  }
  throw last;
}
// A Drive file: with a token via the API; without, via the public link.
export const downloadDriveFile = (fileId, dest, token) => downloadFile(
  token ? `${API}/files/${fileId}?alt=media&supportsAllDrives=true` : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
  dest, token ? auth(token) : {});

// Upload a local file into `parent`: replaces the content of a same-named file there, else creates
// it. Drive keeps the mime we send, so it comes from the extension (videos must not land as
// image/png). Returns { id, name, updated }.
export async function uploadFile(parent, path, token) {
  const name = basename(path);
  const buf = readFileSync(path);
  const mime = mimeOf(name);
  const existing = await findChild(parent, name, token);
  if (existing) {
    await driveApi(`https://www.googleapis.com/upload/drive/v3/files/${existing.id}?uploadType=media&supportsAllDrives=true&fields=id,name`, token, { method: 'PATCH', headers: { 'Content-Type': mime }, body: buf });
    return { ...existing, updated: true };
  }
  const b = 'adharnessboundary';
  const meta = JSON.stringify({ name, parents: [parent] });
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--`)]);
  const created = await driveApi('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', token, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  return { ...created, updated: false };
}

// The brand's tracked Drive folders (inputs/media/_catalog/drive-sources.json, synced with the
// catalog): { <folderId>: { folderId, sourceType, sourceName, lastCheckedAt,
//   files: { <driveFileId>: { name, modifiedTime, size, ingestedAt, catalogId } } } }.
// A file listed there is never downloaded again unless the API reports a newer modifiedTime.
export const readDriveSources = (paths) => (existsSync(paths.driveSources) ? JSON.parse(readFileSync(paths.driveSources, 'utf8')) : {});
export const writeDriveSources = (paths, data) => { mkdirSync(paths.catalog, { recursive: true }); writeFileSync(paths.driveSources, JSON.stringify(data, null, 2) + '\n'); };

// The first child named exactly `name` (optionally folders only), or undefined.
export async function findChild(parent, name, token, { foldersOnly = false } = {}) {
  const q = `'${parent}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false` + (foldersOnly ? ` and mimeType='${FOLDER_MIME}'` : '');
  return ((await driveGet(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&${ALL_DRIVES}`, token)).files || [])[0];
}

export async function createFolder(parent, name, token) {
  const created = await driveApi(`${API}/files?supportsAllDrives=true&fields=id,name`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parent], mimeType: FOLDER_MIME }),
  });
  console.log('created folder:', name);
  return created;
}

// The brand folders under the workspace folder: every one, the contains-matches, and the resolved
// match (exact name, else the single contains-match, else null).
export async function brandFolders(parent, brand, token) {
  const all = await listChildren(parent, token, { foldersOnly: true });
  const contains = all.filter((f) => f.name.toLowerCase().includes(brand.toLowerCase()));
  return { all, contains, match: all.find((f) => f.name === brand) || (contains.length === 1 ? contains[0] : null) };
}

// Resolve <workspace folder> / <brand> / <group>. Missing folders exit with what exists, or are
// created when `create` is set. `hint` is appended to the not-found errors (e.g. how to --create).
// Returns { brandFolder, groupFolder }.
export async function resolveGroupFolder({ parent, brand, group, token, create = false, hint = '' }) {
  const { all, contains, match } = await brandFolders(parent, brand, token);
  let brandFolder = match;
  if (brandFolder && brandFolder.name !== brand) console.log(`using existing brand folder "${brandFolder.name}" (matched "${brand}")`);
  if (!brandFolder) {
    if (contains.length > 1) die(`Multiple brand folders contain "${brand}": ${contains.map((f) => `"${f.name}"`).join(', ')}. Set spec.brand to the exact folder name you want.`);
    if (!create) die(`No brand folder under the parent contains "${brand}". Existing: ${all.map((f) => `"${f.name}"`).join(', ') || '(none)'}.${hint ? ' ' + hint : ''}`);
    brandFolder = await createFolder(parent, brand, token);
  }
  let groupFolder = await findChild(brandFolder.id, group, token, { foldersOnly: true });
  if (!groupFolder) {
    if (!create) {
      const kids = await listChildren(brandFolder.id, token, { foldersOnly: true });
      die(`Group folder "${group}" not found in brand "${brandFolder.name}". Existing groups: ${kids.map((f) => `"${f.name}"`).join(', ') || '(none)'}.${hint ? ' ' + hint : ''}`);
    }
    groupFolder = await createFolder(brandFolder.id, group, token);
  }
  return { brandFolder, groupFolder };
}
