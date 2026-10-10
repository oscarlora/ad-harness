// pull-drive-comments.mjs — pull the client's Google Drive comments on a group's ad files.
// The end client reviews ads in the Drive folder and comments on them directly; this harvests
// those comments (with replies + resolved status) so an agent can build a per-ad revision plan.
// (For comments left on the Notion Ads Board instead, use pull-notion-comments.mjs.)
//
// Usage:
//   node tools/pull-drive-comments.mjs <spec.json>              pull comments for the spec's group folder
//   node tools/pull-drive-comments.mjs --folder <id> <spec.json> pull for an explicit Drive folder id
//   node tools/pull-drive-comments.mjs --out <path> <spec.json>  write the harvest somewhere other than the default
//
// Resolution mirrors sync-to-drive: the workspace is inferred from the spec path, creds come from
// .env (<WORKSPACE>_DRIVE_*), the brand folder is matched under the parent by contains, and the group
// folder (driveSubfolder, else spec.name) by exact name. Pass --folder to skip resolution entirely.
//
// Output: a JSON harvest (default <spec dir>/comments.json) — per file: leading ad ID, every comment
// with author/time/resolved/replies, keyed so a plan can map each back to outputs/json/<id>.json.
// A summary prints to stdout so you can read it without opening the file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inferWorkspace, parseArgs } from './lib/catalog.mjs';
import { driveToken, driveGet, listChildren, resolveGroupFolder, FOLDER_MIME } from './lib/drive.mjs';

const a = parseArgs(process.argv.slice(2));
const folderArg = typeof a.folder === 'string' ? a.folder : null;
const outArg = typeof a.out === 'string' ? a.out : null;
const specPath = a._[0];
if (!specPath) { console.error('Usage: node tools/pull-drive-comments.mjs [--folder <id>] [--out <path>] <spec.json>'); process.exit(1); }

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const WORKSPACE = inferWorkspace(specPath).toUpperCase();
if (!WORKSPACE) { console.error('Run on a spec under workspaces/<Workspace>/<Brand>/... so the workspace can be inferred.'); process.exit(1); }
const { token, folder: PARENT } = await driveToken(WORKSPACE, { needFolder: true });

// All comments on one file (paginated). Replies and resolved status included.
async function listComments(fileId) {
  const out = [];
  let pageToken;
  const fields = 'nextPageToken,comments(content,resolved,createdTime,modifiedTime,anchor,author/displayName,quotedFileContent/value,replies(content,createdTime,author/displayName))';
  do {
    const u = `https://www.googleapis.com/drive/v3/files/${fileId}/comments?fields=${encodeURIComponent(fields)}&pageSize=100&includeDeleted=false${pageToken ? `&pageToken=${pageToken}` : ''}`;
    let r;
    try { r = await driveGet(u, token); } catch (e) { console.error(`  ! comments for ${fileId}: ${e.message}`); break; }
    out.push(...(r.comments || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out;
}

// Resolve the group folder: --folder wins; else brand (contains) → group (exact) under the parent.
let folderId = folderArg;
let brandName = spec.brand;
const groupName = spec.driveSubfolder || spec.name;
if (!folderId) {
  if (!spec.brand) { console.error('Spec needs "brand" (or pass --folder <id>).'); process.exit(1); }
  if (!groupName) { console.error('Spec needs "driveSubfolder" or "name" (or pass --folder <id>).'); process.exit(1); }
  const { brandFolder, groupFolder } = await resolveGroupFolder({ parent: PARENT, brand: spec.brand, group: groupName, token, hint: 'Or pass --folder <id>.' });
  brandName = brandFolder.name;
  folderId = groupFolder.id;
}

const files = (await listChildren(folderId, token)).filter((f) => f.mimeType !== FOLDER_MIME);
const idOf = (name) => (name.match(/^(\d+(?:\.\d+)?)/) || [])[1] || null;

// Decode a Drive image-comment anchor — `[null,[0,[x1,y1,x2,y2]]]`, coords as fractions of the
// image's width/height — into the marked box + a coarse position label. null = whole-file comment.
function regionFromAnchor(anchor) {
  if (!anchor) return null;
  let box;
  try { box = JSON.parse(anchor)?.[1]?.[1]; } catch { return null; }
  if (!Array.isArray(box) || box.length < 4) return null;
  const [x1, y1, x2, y2] = box;
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, w = x2 - x1, h = y2 - y1;
  const col = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'center';
  const row = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
  const label = w > 0.8 && h > 0.8 ? 'most of the image' : `${row}-${col}`;
  const pct = (n) => Math.round(n * 100);
  return { box: { x1, y1, x2, y2 }, label, summary: `${label} (x ${pct(x1)}–${pct(x2)}%, y ${pct(y1)}–${pct(y2)}%)` };
}

const ads = [];
const noComments = [];
for (const f of files) {
  const comments = await listComments(f.id);
  if (!comments.length) { noComments.push(f.name); continue; }
  ads.push({
    file: f.name,
    id: idOf(f.name),
    fileId: f.id,
    url: `https://drive.google.com/file/d/${f.id}/view`,
    open: comments.filter((c) => !c.resolved).length,
    resolved: comments.filter((c) => c.resolved).length,
    comments: comments.map((c) => ({
      author: c.author?.displayName || '(unknown)',
      createdTime: c.createdTime,
      resolved: !!c.resolved,
      region: regionFromAnchor(c.anchor),
      content: c.content,
      replies: (c.replies || []).map((r) => ({ author: r.author?.displayName || '(unknown)', content: r.content })),
    })),
  });
}

const harvest = {
  workspace: WORKSPACE, brand: brandName, group: groupName,
  folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
  pulledAt: new Date().toISOString(),
  ads, filesWithNoComments: noComments,
};
const outPath = outArg || join(dirname(specPath), 'comments.json');
writeFileSync(outPath, JSON.stringify(harvest, null, 2) + '\n');

// Summary to stdout.
const totalC = ads.reduce((n, a) => n + a.comments.length, 0);
console.log(`${brandName} / ${groupName} — ${ads.length} file(s) with comments, ${totalC} comment(s) total`);
for (const a of ads.sort((x, y) => parseFloat(x.id) - parseFloat(y.id))) {
  console.log(`\n[${a.id ?? '?'}] ${a.file}  (${a.open} open, ${a.resolved} resolved)`);
  for (const c of a.comments) {
    const where = c.region ? ` [marked: ${c.region.summary}]` : '';
    console.log(`  - ${c.author}${c.resolved ? ' (resolved)' : ''}${where}: ${c.content.replace(/\n/g, ' ')}`);
    for (const r of c.replies) console.log(`      ↳ ${r.author}: ${r.content.replace(/\n/g, ' ')}`);
  }
}
if (noComments.length) console.log(`\nNo comments: ${noComments.length} file(s).`);
console.log(`\nharvest → ${outPath}`);
