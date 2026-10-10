// sync-to-notion.mjs — sync ONE local ad/idea to a brand's Notion Ads Board.
// Declarative upsert (matched by Name). Auto-sequences the board ID for new pages.
//
// Usage:
//   node tools/sync-to-notion.mjs <spec.json>             PLAN (dry-run): resolve board + map properties, write nothing
//   node tools/sync-to-notion.mjs --confirm <spec.json>   execute the sync (only after the plan is confirmed)
//   node tools/sync-to-notion.mjs --list <spec.json>      list boards whose title contains the brand, with their schema
//   node tools/sync-to-notion.mjs next-id <Workspace> "<brand>"   print the next free board ID
//
// No silent writes: a plain run prints the plan and stops. Boards are matched by *contains* on the
// brand name (case-insensitive), and properties are mapped to each board's actual schema (names and
// types vary per board) — so confirm the plan before adding --confirm. Map oddly-named properties with
// spec.propertyMap, e.g. { "primaryText": "Body", "adCode": "Link" }.
// The workspace selects the Notion token (<WORKSPACE>_NOTION_TOKEN in .env). Notion is per-workspace and optional.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { inferWorkspace, parseArgs } from './lib/catalog.mjs';
import { notionClient, resolveBoard as findBoard, titleOf } from './lib/notion.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['list', 'confirm'] });
const LIST = !!args.list;
const CONFIRM = !!args.confirm;
const positional = args._;

if (!positional.length) { console.error('Usage: node tools/sync-to-notion.mjs [--list|--confirm] <spec.json>  |  next-id <Workspace> "<brand>"'); process.exit(1); }
const isNextId = positional[0] === 'next-id';
const { headers: H, api } = notionClient(isNextId ? positional[1] : positional[0] && inferWorkspace(positional[0]));
const rt = (s) => [{ type: 'text', text: { content: String(s) } }];
const resolveBoard = (q) => findBoard(api, q);

const getSchema = async (dbId) => (await api(`/databases/${dbId}`)).properties || {};
const titlePropName = (schema) => Object.entries(schema).find(([, d]) => d.type === 'title')?.[0];
const findByType = (schema, name, type) => Object.entries(schema).find(([n, d]) => n.toLowerCase() === name && (!type || d.type === type))?.[0];

// logical fields → candidate board-property names (exact, case-insensitive) and how to read the value
const FIELDS = [
  { key: 'status',      aliases: ['status', 'stage'],                                               val: (s) => s.status },
  { key: 'media',       aliases: ['media', 'asset type', 'type'],                                   val: (s) => s.media },
  { key: 'product',     aliases: ['product', 'sku'],                                                val: (s) => s.product },
  { key: 'ratio',       aliases: ['ratio', 'aspect ratio', 'aspect', 'size'],                       val: (s) => s.ratio },
  { key: 'variations',  aliases: ['variations', 'variation count'],                                 val: (s) => s.variations },
  { key: 'headline',    aliases: ['headline', 'hook'],                                              val: (s) => s.headline },
  { key: 'primaryText', aliases: ['primary text', 'primary copy', 'body', 'caption', 'copy'],       val: (s) => s.primaryText },
  { key: 'adCode',      aliases: ['ad link/code', 'ad link', 'ad code', 'link', 'url', 'code'],     val: (s) => s.adCode },
];

// match a logical field to a real board property: spec.propertyMap override wins, else exact-ci alias
function matchProp(schema, field, propertyMap) {
  const override = propertyMap?.[field.key];
  if (override) return schema[override] ? override : '__MISSING__:' + override;
  const names = Object.keys(schema);
  for (const a of field.aliases) { const hit = names.find((n) => n.toLowerCase() === a); if (hit) return hit; }
  return null;
}
// build a Notion property value matching the board property's actual type
function buildValue(type, value) {
  switch (type) {
    case 'title': return { title: rt(value) };
    case 'rich_text': return { rich_text: rt(value) };
    case 'select': return { select: { name: String(Array.isArray(value) ? value[0] : value) } };
    case 'status': return { status: { name: String(value) } };
    case 'multi_select': return { multi_select: (Array.isArray(value) ? value : [value]).map((v) => ({ name: String(v) })) };
    case 'number': return { number: Number(value) };
    case 'url': return { url: String(value) };
    case 'date': return { date: { start: String(value) } };
    default: return null; // unsupported type (people, relation, etc.) — skip with a note
  }
}
const preview = (v) => { const s = Array.isArray(v) ? v.join(', ') : String(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };

// every ID number already used on the board (paginated), reading the resolved ID property
async function usedIds(dbId, idProp) {
  const used = new Set();
  let cursor;
  do {
    const q = await api(`/databases/${dbId}/query`, 'POST', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const p of q.results || []) { const n = p.properties?.[idProp]?.number; if (typeof n === 'number') used.add(n); }
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);
  return used;
}
const maxOf = (set) => (set.size ? Math.max(...set) : 0);

// --- next-id mode ---
if (isNextId) {
  const name = positional.slice(2).join(' ');
  if (!name) { console.error('Usage: node tools/sync-to-notion.mjs next-id <Workspace> "<brand>"'); process.exit(1); }
  const b = await resolveBoard({ brand: name });
  if (!b.id) { console.error(`Could not uniquely match a board for "${name}". Candidates: ${b.candidates.map(titleOf).join(', ') || '(none)'}`); process.exit(1); }
  const schema = await getSchema(b.id);
  const idProp = findByType(schema, 'id', 'number') || 'ID';
  console.log(maxOf(await usedIds(b.id, idProp)) + 1);
  process.exit(0);
}

const specPath = positional[0];
if (!specPath) { console.error('Usage: node tools/sync-to-notion.mjs [--list|--confirm] <spec.json>'); process.exit(1); }
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const board = await resolveBoard(spec);

// --- list mode: show candidate boards + their schema, write nothing ---
if (LIST) {
  console.log(`brand query "${spec.board || spec.brand}" — boards whose title contains it:\n`);
  if (!board.candidates.length) { console.log('  (none)'); process.exit(0); }
  for (const d of board.candidates) {
    const mark = d.id === board.id ? '* ' : '  ';
    console.log(`${mark}${titleOf(d)}  (${d.id})`);
    const schema = d.properties || (await api(`/databases/${d.id}`)).properties || {};
    for (const [n, def] of Object.entries(schema)) console.log(`      - ${n} (${def.type})`);
  }
  if (board.id) console.log(`\n* = the one a sync would resolve to.`);
  else console.log(`\nNo single board resolved — set "board" or "boardId" in the spec.`);
  process.exit(0);
}

// --- build the plan (used by both plan and confirm) ---
if (!board.id) {
  console.error(`Could not uniquely match a board for "${spec.board || spec.brand}".`);
  console.error(`Candidates: ${board.candidates.map(titleOf).join(', ') || '(none)'}`);
  console.error('Set "board" (full title) or "boardId" in the spec, or run --list to inspect.');
  process.exit(1);
}
const schema = await getSchema(board.id);
const titleProp = titlePropName(schema);
const idProp = findByType(schema, 'id', 'number');
const pmap = spec.propertyMap || {};

const planned = [];  // { prop, type, key, value }
const skipped = [];  // { key, value, reason }
if (titleProp) planned.push({ prop: titleProp, type: 'title', key: 'name', value: spec.name });
else skipped.push({ key: 'name', value: spec.name, reason: 'board has no title property' });

for (const f of FIELDS) {
  const value = f.val(spec);
  if (value == null) continue;
  const prop = matchProp(schema, f, pmap);
  if (!prop) { skipped.push({ key: f.key, value, reason: 'no matching board property (use propertyMap)' }); continue; }
  if (prop.startsWith('__MISSING__:')) { skipped.push({ key: f.key, value, reason: `propertyMap → "${prop.slice(12)}" not on board` }); continue; }
  const built = buildValue(schema[prop].type, value);
  if (!built) { skipped.push({ key: f.key, value, reason: `unsupported property type "${schema[prop].type}"` }); continue; }
  planned.push({ prop, type: schema[prop].type, key: f.key, value });
}

function printPlan() {
  console.log(`BOARD: ${board.title} (${board.id})`);
  if (board.candidates.length > 1) console.log(`  other candidates: ${board.candidates.filter((c) => c.id !== board.id).map(titleOf).join(', ')}`);
  console.log(`\nPROPERTIES TO SET:`);
  for (const p of planned) console.log(`  ${p.prop} (${p.type})  ← ${p.key} = ${preview(p.value)}`);
  if (idProp) console.log(`  ${idProp} (number)  ← id = ${spec.id === 'auto' || spec.id == null ? 'auto (next in sequence)' : spec.id}`);
  else if (spec.id != null) skipped.push({ key: 'id', value: spec.id, reason: 'no ID number property on board' });
  if (skipped.length) { console.log(`\nSKIPPED (not synced):`); for (const s of skipped) console.log(`  ${s.key} = ${preview(s.value)}  — ${s.reason}`); }
  console.log(`\nBODY: ${(spec.images || []).length} image block(s): ${(spec.images || []).map((i) => basename(i)).join(', ') || '(none)'}`);
}

if (!CONFIRM) {
  printPlan();
  console.log(`\nPLAN ONLY — nothing written. Re-run with --confirm to sync.`);
  process.exit(0);
}

// --- confirm mode: execute the sync ---
console.log('Syncing per plan:');
printPlan();
console.log('');

async function upload(path) {
  const fname = basename(path);
  const cu = await api('/file_uploads', 'POST', { filename: fname, content_type: 'image/png' });
  if (!cu.id) throw new Error('upload create: ' + JSON.stringify(cu));
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(path)], { type: 'image/png' }), fname);
  const sr = await (await fetch(cu.upload_url || `https://api.notion.com/v1/file_uploads/${cu.id}/send`, { method: 'POST', headers: H, body: fd })).json();
  if (sr.status !== 'uploaded') throw new Error('upload send: ' + JSON.stringify(sr));
  console.log('uploaded', fname);
  return { id: cu.id, fname };
}
const ups = [];
for (const f of spec.images || []) ups.push(await upload(f));

const children = [];
for (const u of ups) {
  children.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: rt(u.fname.replace(/\.png$/, '')) } });
  children.push({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: u.id } } });
}

const props = {};
for (const p of planned) props[p.prop] = buildValue(p.type, p.value);

// upsert by the title property
const q = await api(`/databases/${board.id}/query`, 'POST', { filter: { property: titleProp, title: { equals: spec.name } }, page_size: 1 });
const existing = (q.results || [])[0];

// ID: keep existing on update; auto-sequence on create (refuse duplicates)
if (idProp) {
  const used = await usedIds(board.id, idProp);
  if (existing) {
    if (typeof spec.id === 'number') props[idProp] = { number: spec.id };
  } else {
    let id;
    if (spec.id == null || spec.id === 'auto') id = maxOf(used) + 1;
    else if (typeof spec.id === 'number') {
      if (used.has(spec.id)) { console.error(`ID ${spec.id} is already used on the board. Use "auto" or a free ID (next is ${maxOf(used) + 1}).`); process.exit(1); }
      id = spec.id;
    }
    props[idProp] = { number: id };
    console.log(`assigned ID ${id} (board max was ${maxOf(used)})`);
  }
}

let page;
if (existing) {
  await api(`/pages/${existing.id}`, 'PATCH', { properties: props, cover: null });
  const before = await api(`/blocks/${existing.id}/children?page_size=100`);
  const oldIds = (before.results || []).map((b) => b.id);
  if (children.length) await api(`/blocks/${existing.id}/children`, 'PATCH', { children });
  for (const bid of oldIds) await fetch(`https://api.notion.com/v1/blocks/${bid}`, { method: 'DELETE', headers: H });
  page = await api(`/pages/${existing.id}`);
  console.log('UPDATED existing page');
} else {
  page = await api('/pages', 'POST', { parent: { database_id: board.id }, properties: props, children });
  if (page.object === 'error') { console.error('CREATE ERROR', page.message); process.exit(1); }
  console.log('CREATED page');
}
console.log('url:', page.url, '\nName:', spec.name, '| images:', ups.length);
