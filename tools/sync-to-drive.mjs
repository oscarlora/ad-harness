// sync-to-drive.mjs — sync approved ad files to a workspace's Google Drive folder.
// Structure: <workspace Drive folder> / <brand> / <ad-group name> / files
//
// Usage:
//   node tools/sync-to-drive.mjs <spec.json>            sync (does NOT create folders by default)
//   node tools/sync-to-drive.mjs --list <spec.json>     discovery: show brand folders + their child folders
//   node tools/sync-to-drive.mjs --create <spec.json>   sync, allowed to create missing brand/group folders
//   node tools/sync-to-drive.mjs --archive <spec.json>  move existing same-named files to an "Archived" subfolder, then upload the new versions (for revisions)
//
// Folder resolution (lib/drive.mjs): brand folder by contains-match under the workspace folder,
// group folder (driveSubfolder, else spec.name) by exact name inside it. A missing folder errors
// and lists what exists; --create creates it (following the standard nesting). Always confirm with
// the user before creating.
//
// Spec (same file as sync-to-notion): { brand:"Acme", name:"20_Gentle-Bars_Static_...", images:[...], driveSubfolder? }
// The workspace is inferred from the spec's path. Per-workspace creds in .env:
//   <WORKSPACE>_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _FOLDER
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { inferWorkspace, parseArgs } from './lib/catalog.mjs';
import { driveToken, driveApi, listChildren, findChild, createFolder, brandFolders, resolveGroupFolder, uploadFile } from './lib/drive.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['list', 'create', 'archive'] });
const LIST = !!args.list;
const CREATE = !!args.create;
const ARCHIVE = !!args.archive;
const specPath = args._[0];
if (!specPath) { console.error('Usage: node tools/sync-to-drive.mjs [--list] [--create] [--archive] <spec.json>'); process.exit(1); }

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const WORKSPACE = inferWorkspace(specPath).toUpperCase();
if (!WORKSPACE) { console.error('Run on a spec under workspaces/<Workspace>/<Brand>/... so the workspace can be inferred.'); process.exit(1); }
const { token, folder: PARENT } = await driveToken(WORKSPACE, { needFolder: true });

const moveToFolder = (fileId, fromParent, toParent) => driveApi(
  `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${toParent}&removeParents=${fromParent}&supportsAllDrives=true&fields=id`,
  token, { method: 'PATCH' });

if (!spec.brand) { console.error('Spec needs "brand".'); process.exit(1); }

// --list: discovery only. Show every brand folder, flag the ones matching spec.brand, and list their children.
if (LIST) {
  const { all, contains } = await brandFolders(PARENT, spec.brand, token);
  console.log(`workspace: ${WORKSPACE} | parent ${PARENT} | brand query "${spec.brand}"\n`);
  console.log('Brand folders under parent:');
  for (const f of all) console.log(`  ${contains.includes(f) ? '* ' : '  '}${f.name}  (${f.id})`);
  if (!contains.length) console.log(`\nNo folder contains "${spec.brand}".`);
  for (const m of contains) {
    const kids = await listChildren(m.id, token, { foldersOnly: true });
    console.log(`\nInside "${m.name}" (${m.id}):`);
    if (!kids.length) console.log('  (no subfolders — files would sit directly here)');
    for (const k of kids) console.log(`  [D] ${k.name}  (${k.id})`);
  }
  process.exit(0);
}

const group = spec.driveSubfolder || spec.name;
if (!group) { console.error('Spec needs "name" (ad-group folder) or "driveSubfolder".'); process.exit(1); }
const { brandFolder, groupFolder } = await resolveGroupFolder({
  parent: PARENT, brand: spec.brand, group, token, create: CREATE,
  hint: 'Re-run with --create to create it, or fix spec.brand / set driveSubfolder. (Run --list to inspect.)',
});

console.log(`workspace: ${WORKSPACE} | ${brandFolder.name} / ${group} (${groupFolder.id})`);

// --archive: before replacing, move any existing same-named files into an "Archived" subfolder,
// so the previous versions are preserved (not overwritten) and the new files upload fresh.
if (ARCHIVE) {
  const archived = (await findChild(groupFolder.id, 'Archived', token, { foldersOnly: true })) || (await createFolder(groupFolder.id, 'Archived', token));
  for (const f of spec.images || []) {
    const name = basename(f);
    const existing = await findChild(groupFolder.id, name, token);
    if (existing) { await moveToFolder(existing.id, groupFolder.id, archived.id); console.log('  archived ' + name); }
  }
}

for (const f of spec.images || []) console.log(`  ${(await uploadFile(groupFolder.id, f, token)).updated ? 'updated' : 'created'} ${basename(f)}`);
console.log('done →', `https://drive.google.com/drive/folders/${groupFolder.id}`);
