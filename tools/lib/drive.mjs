// drive.mjs — shared Google Drive helpers: auth, API calls, folder listing, downloads, uploads,
// tracked folders, and brand/group folder resolution.
//
// Creds in .env (from connect-drive.mjs): <WS>_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _FOLDER
// Folder resolution never creates silently (brandFolders, resolveGroupFolder); group folders match by
// exact name.
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { loadEnv, die, sleep, mimeOf, inferWorkspace, readUploads } from './catalog.mjs';

const API = 'https://www.googleapis.com/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ALL_DRIVES = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

const auth = (token) => ({ Authorization: `Bearer ${token}` });
export async function driveApi(url, token, { method = 'GET', headers = {}, body } = {}) {
  const r = await fetch(url, { method, headers: { ...auth(token), ...headers }, body });
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { /* non-JSON body */ }
  if (!r.ok) throw new Error(`Drive ${method} ${url.split('?')[0]} -> HTTP ${r.status}: ${j.error?.message || text.slice(0, 200)}`);
  return j;
}
const credKeys = (W) => ['CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'].map((k) => `${W.toUpperCase()}_DRIVE_${k}`);
export const hasDriveCreds = (workspace) => { const env = loadEnv(); return credKeys(workspace).every((k) => env[k]); };

// Exits with setup help when creds are missing or revoked. needFolder: also require <WS>_DRIVE_FOLDER.
export async function driveToken(workspace, { needFolder = false } = {}) {
  const W = workspace.toUpperCase();
  const env = loadEnv();
  const [id, secret, refresh] = credKeys(W);
  const keys = { id, secret, refresh, folder: `${W}_DRIVE_FOLDER` };
  const missing = [keys.id, keys.secret, keys.refresh, ...(needFolder ? [keys.folder] : [])].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`\nMissing Google Drive credentials for workspace ${W}: ${missing.join(', ')}`);
    console.error(`First-time setup (one-time consent): download the workspace's OAuth client (Desktop) JSON, then run:`);
    console.error(`   node tools/connect-drive.mjs ${W}`);
    console.error(`That opens a browser consent link and writes the creds into .env.${needFolder ? ` Then set ${keys.folder}=<destination folder id>.` : ''}\n`);
    process.exit(1);
  }
  const tk = await (await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env[keys.id], client_secret: env[keys.secret], refresh_token: env[keys.refresh], grant_type: 'refresh_token' }),
  })).json();
  if (!tk.access_token) {
    console.error('Drive token refresh failed:', tk.error || '(no error code)', tk.error_description || '');
    if (tk.error === 'invalid_grant') console.error(`Refresh token revoked/expired. Re-run: node tools/connect-drive.mjs ${W}`);
    process.exit(1);
  }
  return { token: tk.access_token, folder: env[keys.folder] };
}

export async function listChildren(folderId, token, { foldersOnly = false } = {}) {
  const out = [];
  let pageToken;
  do {
    const q = `'${folderId}' in parents and trashed=false` + (foldersOnly ? ` and mimeType='${FOLDER_MIME}'` : '');
    const r = await driveApi(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)&pageSize=200&orderBy=name&${ALL_DRIVES}${pageToken ? `&pageToken=${pageToken}` : ''}`, token);
    out.push(...(r.files || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

// ---------- tracked folders ----------
// Without creds a link-shared folder is read through Drive's public embedded view: ids + names only
// (no modifiedTime/size), Google-native docs show as non-files.
const NATIVE = 'application/vnd.google-apps.native';
const unescape = (s) => s.replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
async function publicFolder(folderId) {
  const r = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`);
  const html = r.ok ? await r.text() : '';
  if (!html.includes('flip-entries')) throw new Error(`Drive folder ${folderId} isn't readable without creds (HTTP ${r.status}). Share it as "anyone with the link", or connect Drive: node tools/connect-drive.mjs <WS>`);
  const name = unescape((html.match(/<title>([^<]*)/) || [])[1] || '');
  const files = [...html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([\s\S]*?)<\/div>/g)]
    .map(([, id, href, title]) => ({ id, name: unescape(title), mimeType: href.includes('/drive/folders/') ? FOLDER_MIME : href.includes('/file/d/') ? null : NATIVE, modifiedTime: null, size: null }));
  return { name, files };
}

// `token` null → public view. Returns { name, files: [{ id, name, mimeType, modifiedTime, size, native }] }.
export async function listTree(folderId, token) {
  const name = token ? (await driveApi(`${API}/files/${folderId}?fields=name&supportsAllDrives=true`, token)).name : null;
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

// Up to 3 tries. A web page in place of the file (not shared, quota, virus-scan wall) counts as failure.
// Returns { bytes, filename } (filename from Content-Disposition).
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
export const downloadDriveFile = (fileId, dest, token) => downloadFile(
  token ? `${API}/files/${fileId}?alt=media&supportsAllDrives=true` : `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
  dest, token ? auth(token) : {});

// Replaces a same-named file in `parent`, else creates it. Drive keeps the mime we send, so it comes
// from the extension. Returns { id, name, updated }.
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

// _catalog/drive-sources.json: { <folderId>: { folderId, sourceType, sourceName, lastCheckedAt,
//   files: { <driveFileId>: { name, modifiedTime, size, ingestedAt, catalogId } } } }.
// A listed file is downloaded again only when Drive reports a newer modifiedTime.
export const readDriveSources = (paths) => (existsSync(paths.driveSources) ? JSON.parse(readFileSync(paths.driveSources, 'utf8')) : {});
export const writeDriveSources = (paths, data) => { mkdirSync(paths.catalog, { recursive: true }); writeFileSync(paths.driveSources, JSON.stringify(data, null, 2) + '\n'); };

export async function findChild(parent, name, token, { foldersOnly = false } = {}) {
  const q = `'${parent}' in parents and name='${name.replace(/'/g, "\\'")}' and trashed=false` + (foldersOnly ? ` and mimeType='${FOLDER_MIME}'` : '');
  return ((await driveApi(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&${ALL_DRIVES}`, token)).files || [])[0];
}

export async function createFolder(parent, name, token) {
  const created = await driveApi(`${API}/files?supportsAllDrives=true&fields=id,name`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parents: [parent], mimeType: FOLDER_MIME }),
  });
  console.log('created folder:', name);
  return created;
}

// The brand folder matches spec.brand by exact name, else by a single case-insensitive contains-match
// ("Acme" → "Acme Ads"); `exact` (a name pinned in inputs/uploads.json) allows only the exact name.
export async function brandFolders(parent, brand, token, { exact = false } = {}) {
  const all = await listChildren(parent, token, { foldersOnly: true });
  const contains = all.filter((f) => f.name.toLowerCase().includes(brand.toLowerCase()));
  return { all, contains, match: all.find((f) => f.name === brand) || (!exact && contains.length === 1 ? contains[0] : null) };
}

// A spec under workspaces/<WS>/<Brand>/: the spec, its workspace's Drive token and parent folder, and the
// brand folder to look for (inputs/uploads.json drive.folder, else spec.brand).
export async function driveForSpec(specPath) {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const workspace = inferWorkspace(specPath).toUpperCase();
  if (!workspace) die('Run on a spec under workspaces/<Workspace>/<Brand>/... so the workspace can be inferred.');
  const pinned = readUploads(specPath).drive?.folder;
  const { token, folder: parent } = await driveToken(workspace, { needFolder: true });
  return { spec, workspace, token, parent, brand: pinned || spec.brand, exact: !!pinned };
}

// Missing folders exit listing what exists, or are created when `create` is set; with `plan` as well,
// they come back as { name, id: null } instead.
export async function resolveGroupFolder({ parent, brand, exact = false, group, token, create = false, plan = false, hint = '' }) {
  const { all, contains, match } = await brandFolders(parent, brand, token, { exact });
  let brandFolder = match;
  if (brandFolder && brandFolder.name !== brand) console.log(`using existing brand folder "${brandFolder.name}" (matched "${brand}")`);
  if (!brandFolder) {
    if (contains.length > 1 && !exact) die(`Multiple brand folders contain "${brand}": ${contains.map((f) => `"${f.name}"`).join(', ')}. Pin the right one in the brand's inputs/uploads.json ({ "drive": { "folder": "<name>" } }).`);
    if (!create) die(`No brand folder under the parent ${exact ? `is named "${brand}" (pinned in inputs/uploads.json)` : `contains "${brand}"`}. Existing: ${all.map((f) => `"${f.name}"`).join(', ') || '(none)'}.${hint ? ' ' + hint : ''}`);
    brandFolder = plan ? { name: brand, id: null } : await createFolder(parent, brand, token);
  }
  let groupFolder = brandFolder.id && await findChild(brandFolder.id, group, token, { foldersOnly: true });
  if (!groupFolder) {
    if (!create) {
      const kids = await listChildren(brandFolder.id, token, { foldersOnly: true });
      die(`Group folder "${group}" not found in brand "${brandFolder.name}". Existing groups: ${kids.map((f) => `"${f.name}"`).join(', ') || '(none)'}.${hint ? ' ' + hint : ''}`);
    }
    groupFolder = plan ? { name: group, id: null } : await createFolder(brandFolder.id, group, token);
  }
  return { brandFolder, groupFolder };
}
