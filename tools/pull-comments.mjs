// pull-comments.mjs — pull the client's review comments on a batch, from Drive or the Notion Ads Board.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs, findBrandDir, die, usage } from './lib/catalog.mjs';
import { driveApi, driveForSpec, listChildren, resolveGroupFolder, FOLDER_MIME } from './lib/drive.mjs';
import { notionClient, resolveBoard, boardQuery, titleOf, plain, allPages, getSchema, findProp } from './lib/notion.mjs';

const HELP = `pull-comments.mjs — the client's review comments on a batch, from Drive or the Notion Ads Board

  node tools/pull-comments.mjs drive [--folder <id>] [--out <path>] <spec.json>
    Comments (replies, resolved status, marked region) on the files in the spec's group folder,
    resolved as in upload-to-drive, or in --folder. Writes <spec dir>/comments.json.
  node tools/pull-comments.mjs notion <Workspace> "<brand>" [--status "<name>"]... [--board <id>] [--out <path>]
    Threaded comments on the board's pages; --status repeats (any match), omit it for every page.
    Board = --board, else the brand's inputs/uploads.json pin, else a title search. Needs the
    integration's "Read comments" capability. Writes <Brand>/outputs/notion-comments.json.

Each harvest lists per file/page its leading ad ID and comments; a summary prints too.`;
const a = parseArgs(process.argv.slice(2), { repeat: ['status'], help: HELP });
const [source, ...rest] = a._;
const str = (v) => (typeof v === 'string' ? v : null);
const oneLine = (s) => s.replace(/\n/g, ' ');

function save(harvest, outPath, summary) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(harvest, null, 2) + '\n');
  console.log(summary);
}

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

async function pullDrive() {
  const specPath = rest[0];
  if (!specPath) usage(HELP);
  const { spec, workspace, token, parent, brand, exact } = await driveForSpec(specPath);

  let folderId = str(a.folder);
  let brandName = brand;
  const groupName = spec.driveSubfolder || spec.name;
  if (!folderId) {
    if (!brand) die('Spec needs "brand" (or pass --folder <id>).');
    if (!groupName) die('Spec needs "driveSubfolder" or "name" (or pass --folder <id>).');
    const { brandFolder, groupFolder } = await resolveGroupFolder({ parent, brand, exact, group: groupName, token, hint: 'Or pass --folder <id>.' });
    brandName = brandFolder.name;
    folderId = groupFolder.id;
  }

  async function listComments(fileId) {
    const out = [];
    let pageToken;
    const fields = 'nextPageToken,comments(content,resolved,createdTime,modifiedTime,anchor,author/displayName,quotedFileContent/value,replies(content,createdTime,author/displayName))';
    do {
      const u = `https://www.googleapis.com/drive/v3/files/${fileId}/comments?fields=${encodeURIComponent(fields)}&pageSize=100&includeDeleted=false${pageToken ? `&pageToken=${pageToken}` : ''}`;
      let r;
      try { r = await driveApi(u, token); } catch (e) { console.error(`  ! comments for ${fileId}: ${e.message}`); break; }
      out.push(...(r.comments || []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  const files = (await listChildren(folderId, token)).filter((f) => f.mimeType !== FOLDER_MIME);
  const idOf = (name) => (name.match(/^(\d+(?:\.\d+)?)/) || [])[1] || null;
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

  const outPath = str(a.out) || join(dirname(specPath), 'comments.json');
  const lines = [`${brandName} / ${groupName} — ${ads.length} file(s) with comments, ${ads.reduce((n, x) => n + x.comments.length, 0)} comment(s) total`];
  for (const x of ads.sort((p, q) => parseFloat(p.id) - parseFloat(q.id))) {
    lines.push(`\n[${x.id ?? '?'}] ${x.file}  (${x.open} open, ${x.resolved} resolved)`);
    for (const c of x.comments) {
      const where = c.region ? ` [marked: ${c.region.summary}]` : '';
      lines.push(`  - ${c.author}${c.resolved ? ' (resolved)' : ''}${where}: ${oneLine(c.content)}`);
      for (const r of c.replies) lines.push(`      ↳ ${r.author}: ${oneLine(r.content)}`);
    }
  }
  if (noComments.length) lines.push(`\nNo comments: ${noComments.length} file(s).`);
  lines.push(`\nharvest → ${outPath}`);
  save({
    workspace, brand: brandName, group: groupName,
    folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    pulledAt: new Date().toISOString(),
    ads, filesWithNoComments: noComments,
  }, outPath, lines.join('\n'));
}

async function pullNotion() {
  const statuses = a.status || [];
  const boardArg = str(a.board);
  const [workspace, ...words] = rest;
  const brand = words.join(' ');
  if (!workspace || (!brand && !boardArg)) usage(HELP);
  const brandDir = findBrandDir(workspace, brand);
  const outPath = str(a.out) || (brandDir ? join(brandDir, 'outputs', 'notion-comments.json')
    : die(`No brand folder under workspaces/${workspace} matches "${brand}". Pass --out <path>.`));

  const W = workspace.toUpperCase();
  const { api } = notionClient(W);
  const board = await resolveBoard(api, boardQuery({ boardId: boardArg, brand }, brandDir));
  if (!board.id) {
    die(board.candidates.length
      ? `Multiple boards match "${brand}": ${board.candidates.map(titleOf).join(', ')}. Pass --board <id>, or pin it in inputs/uploads.json.`
      : `No board title contains "${brand}". Pass --board <id>.`);
  }
  const schema = await getSchema(api, board.id);
  const statusProp = findProp(schema, 'status') || findProp(schema, null, 'status');
  const idProp = findProp(schema, 'id', 'number');
  const titleProp = findProp(schema, null, 'title');
  // the property may be a `status` or a `select`
  const statusVal = (p) => { const v = p.properties?.[statusProp]; return v?.status?.name || v?.select?.name || null; };

  let filter;
  if (statuses.length) {
    if (!statusProp) die('Board has no Status property to filter on; drop --status.');
    const t = schema[statusProp].type; // 'status' | 'select'
    filter = { or: statuses.map((name) => ({ property: statusProp, [t]: { equals: name } })) };
  }

  const pages = await allPages(api, `/databases/${board.id}/query`, filter ? { filter } : {}).catch((e) => die(`Query failed: ${e.message}`));

  let capabilityError = false;
  async function listComments(pageId) {
    try { return await allPages(api, `/comments?block_id=${pageId}`); }
    catch (e) {
      if (e.code === 'restricted_resource') capabilityError = true;
      else console.error(`  ! comments for ${pageId}: ${e.message}`);
      return [];
    }
  }

  // needs "read user information"; falls back to a short id
  const userCache = new Map();
  async function userName(id) {
    if (!id) return '(unknown)';
    if (!userCache.has(id)) {
      const u = await api(`/users/${id}`);
      userCache.set(id, (u.object !== 'error' && u.name) || `user ${id.slice(0, 8)}`);
    }
    return userCache.get(id);
  }

  const ads = [];
  const noComments = [];
  for (const p of pages) {
    const comments = await listComments(p.id);
    if (capabilityError) break;
    const name = plain(p.properties?.[titleProp]?.title);
    const id = idProp ? p.properties?.[idProp]?.number : null;
    if (!comments.length) { noComments.push({ id, name, status: statusVal(p) }); continue; }
    const byThread = new Map();
    for (const c of comments) {
      const k = c.discussion_id || c.id;
      if (!byThread.has(k)) byThread.set(k, []);
      byThread.get(k).push(c);
    }
    const threads = [];
    for (const [discussion_id, cs] of byThread) {
      const messages = [];
      for (const c of cs) messages.push({ author: await userName(c.created_by?.id), createdTime: c.created_time, content: plain(c.rich_text) });
      threads.push({ discussion_id, messages });
    }
    ads.push({ id, name, status: statusVal(p), pageId: p.id, url: p.url, comments: comments.length, threads });
  }

  if (capabilityError) {
    console.error('\nNotion returned "restricted_resource" — the integration cannot read comments.');
    console.error('Fix: open the integration in Notion (Settings → Connections, or notion.so/my-integrations),');
    console.error('     Capabilities → enable "Read comments", then re-run. No code change needed.\n');
    process.exit(1);
  }

  const lines = [`${board.title} — ${ads.length} page(s) with comments, ${ads.reduce((n, x) => n + x.comments, 0)} comment(s) total${statuses.length ? ` [status: ${statuses.join(', ')}]` : ''}`];
  for (const x of ads.sort((p, q) => (p.id ?? 0) - (q.id ?? 0))) {
    lines.push(`\n[${x.id ?? '?'}] ${x.name}  — ${x.status ?? '(no status)'}  (${x.comments} comment(s))`, `  ${x.url}`);
    for (const t of x.threads) for (const [i, m] of t.messages.entries()) lines.push(`${i === 0 ? '  - ' : '      ↳ '}${m.author}: ${oneLine(m.content)}`);
  }
  if (noComments.length) lines.push(`\nNo comments: ${noComments.length} page(s).`);
  lines.push(`\nharvest → ${outPath}`);
  save({
    workspace: W, brand, board: board.title, boardId: board.id,
    statuses: statuses.length ? statuses : 'all',
    pulledAt: new Date().toISOString(),
    ads, pagesWithNoComments: noComments,
  }, outPath, lines.join('\n'));
}

if (source === 'drive') await pullDrive();
else if (source === 'notion') await pullNotion();
else usage(HELP);
