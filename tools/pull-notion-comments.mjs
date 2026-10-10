// pull-notion-comments.mjs — pull the client's comments on a brand's Notion Ads Board.
// The client reviews ads on the board and comments on the ad pages directly; this harvests those
// page comments (threaded, with author + time) so an agent can build a per-ad revision plan.
//
// Usage:
//   node tools/pull-notion-comments.mjs <Workspace> "<brand>"                 pull comments for every page
//   node tools/pull-notion-comments.mjs <Workspace> "<brand>" --status "Revision Needed" --status "Pending Client Review"
//   node tools/pull-notion-comments.mjs <Workspace> "<brand>" --board <id>    skip board resolution
//   node tools/pull-notion-comments.mjs <Workspace> "<brand>" --out <path>    write the harvest elsewhere
//
// Board resolution mirrors sync-to-notion: contains-match on the brand (case-insensitive), preferring
// an "Ads Board". --status filters by the board's Status property (repeatable; a page matching any
// of them is pulled); omit to pull every page. The workspace selects the Notion token (<WORKSPACE>_NOTION_TOKEN in .env).
//
// Needs the integration's "Read comments" capability (Notion → integration settings → Capabilities).
// Without it the comments endpoint returns `restricted_resource` and this prints how to fix it.
//
// Output: a JSON harvest (default workspaces/<Workspace>/<Brand>/outputs/notion-comments.json) — per
// page: ad ID, name, status, url, and every comment grouped into threads, keyed so a plan can map each
// back to outputs/json/<id>.json. A summary prints to stdout so you can read it without opening the file.
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs, REPO_ROOT } from './lib/catalog.mjs';
import { notionClient, resolveBoard, titleOf, plain } from './lib/notion.mjs';

const a = parseArgs(process.argv.slice(2), { repeat: ['status'] });
const statuses = a.status || [];
const boardArg = typeof a.board === 'string' ? a.board : null;
const outArg = typeof a.out === 'string' ? a.out : null;
const workspace = a._[0];
const brand = a._.slice(1).join(' ');
if (!workspace || (!brand && !boardArg)) {
  console.error('Usage: node tools/pull-notion-comments.mjs <Workspace> "<brand>" [--status "<name>"]... [--board <id>] [--out <path>]');
  process.exit(1);
}

const W = workspace.toUpperCase();
const { api } = notionClient(W);

const board = await resolveBoard(api, { boardId: boardArg, brand });
if (!board.id) {
  console.error(board.candidates.length
    ? `Multiple boards match "${brand}": ${board.candidates.map(titleOf).join(', ')}. Pass --board <id>.`
    : `No board title contains "${brand}". Pass --board <id>.`);
  process.exit(1);
}
const schema = (await api(`/databases/${board.id}`)).properties || {};
const propByName = (name) => Object.keys(schema).find((n) => n.toLowerCase() === name);
const statusProp = propByName('status') || Object.keys(schema).find((n) => schema[n].type === 'status');
const idProp = Object.keys(schema).find((n) => n.toLowerCase() === 'id' && schema[n].type === 'number');
const titleProp = Object.keys(schema).find((n) => schema[n].type === 'title');

// status value reads the same whether the property is a `status` or a `select`
const statusVal = (p) => { const v = p.properties?.[statusProp]; return v?.status?.name || v?.select?.name || null; };

// --status filter, built to the property's actual type
let filter;
if (statuses.length) {
  if (!statusProp) { console.error('Board has no Status property to filter on; drop --status.'); process.exit(1); }
  const t = schema[statusProp].type; // 'status' | 'select'
  filter = { or: statuses.map((name) => ({ property: statusProp, [t]: { equals: name } })) };
}

// all pages (paginated), optionally filtered
async function queryPages() {
  const out = [];
  let cursor;
  do {
    const q = await api(`/databases/${board.id}/query`, 'POST', { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
    if (q.object === 'error') { console.error(`Query failed: ${q.code} — ${q.message}`); process.exit(1); }
    out.push(...(q.results || []));
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);
  return out;
}

// page-level comments (paginated). The API returns open comments the integration can see.
let capabilityError = false;
async function listComments(pageId) {
  const out = [];
  let cursor;
  do {
    const c = await api(`/comments?block_id=${pageId}&page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    if (c.object === 'error') {
      if (c.code === 'restricted_resource') capabilityError = true;
      else console.error(`  ! comments for ${pageId}: ${c.message}`);
      break;
    }
    out.push(...(c.results || []));
    cursor = c.has_more ? c.next_cursor : undefined;
  } while (cursor);
  return out;
}

// resolve commenter names once (best-effort; needs "read user information" — falls back to a short id)
const userCache = new Map();
async function userName(id) {
  if (!id) return '(unknown)';
  if (userCache.has(id)) return userCache.get(id);
  const u = await api(`/users/${id}`);
  const name = u.object === 'error' ? `user ${id.slice(0, 8)}` : (u.name || `user ${id.slice(0, 8)}`);
  userCache.set(id, name);
  return name;
}

const pages = await queryPages();
const ads = [];
const noComments = [];
for (const p of pages) {
  const comments = await listComments(p.id);
  if (capabilityError) break;
  const name = plain(p.properties?.[titleProp]?.title);
  const id = idProp ? p.properties?.[idProp]?.number : null;
  if (!comments.length) { noComments.push({ id, name, status: statusVal(p) }); continue; }
  // group comments into threads by discussion_id, in created order
  const byThread = new Map();
  for (const c of comments) {
    const k = c.discussion_id || c.id;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(c);
  }
  const threads = [];
  for (const [discussion_id, cs] of byThread) {
    const msgs = [];
    for (const c of cs) msgs.push({ author: await userName(c.created_by?.id), createdTime: c.created_time, content: plain(c.rich_text) });
    threads.push({ discussion_id, messages: msgs });
  }
  ads.push({
    id, name, status: statusVal(p),
    pageId: p.id, url: p.url,
    comments: comments.length, threads,
  });
}

if (capabilityError) {
  console.error('\nNotion returned "restricted_resource" — the integration cannot read comments.');
  console.error('Fix: open the integration in Notion (Settings → Connections, or notion.so/my-integrations),');
  console.error('     Capabilities → enable "Read comments", then re-run. No code change needed.\n');
  process.exit(1);
}

const harvest = {
  workspace: W, brand, board: board.title, boardId: board.id,
  statuses: statuses.length ? statuses : 'all',
  pulledAt: new Date().toISOString(),
  ads, pagesWithNoComments: noComments,
};
// The Notion board's brand name ("Acme Skincare") rarely matches the local folder ("Acme"), so resolve the
// brand folder under the workspace by a punctuation-insensitive match before writing into its outputs/.
function brandDir() {
  const wsDir = join(REPO_ROOT, 'workspaces', workspace);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(brand);
  const dirs = existsSync(wsDir) ? readdirSync(wsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const hit = dirs.find((d) => norm(d) === target) || dirs.find((d) => norm(d).includes(target) || target.includes(norm(d)));
  if (!hit) { console.error(`No brand folder under ${wsDir} matches "${brand}" (have: ${dirs.join(', ') || 'none'}). Pass --out <path>.`); process.exit(1); }
  return join(wsDir, hit);
}
const outPath = outArg || join(brandDir(), 'outputs', 'notion-comments.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(harvest, null, 2) + '\n');

// Summary to stdout.
const totalC = ads.reduce((n, a) => n + a.comments, 0);
console.log(`${board.title} — ${ads.length} page(s) with comments, ${totalC} comment(s) total${statuses.length ? ` [status: ${statuses.join(', ')}]` : ''}`);
for (const a of ads.sort((x, y) => (x.id ?? 0) - (y.id ?? 0))) {
  console.log(`\n[${a.id ?? '?'}] ${a.name}  — ${a.status ?? '(no status)'}  (${a.comments} comment(s))`);
  console.log(`  ${a.url}`);
  for (const t of a.threads) {
    for (const [i, m] of t.messages.entries()) {
      const lead = i === 0 ? '  - ' : '      ↳ ';
      console.log(`${lead}${m.author}: ${m.content.replace(/\n/g, ' ')}`);
    }
  }
}
if (noComments.length) console.log(`\nNo comments: ${noComments.length} page(s).`);
console.log(`\nharvest → ${outPath}`);
