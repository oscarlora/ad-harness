#!/usr/bin/env node
// search-media.mjs — search the media catalog. Node 22+; keyword-only search needs no npm deps.
// Hard filters narrow. The query is ranked two ways and fused: keywords across the text fields
// (alias-aware via inputs/products.json) and meaning, via the Gemini vectors from embed-media
// (any language; matches each asset's full description and each video scene — a scene hit returns
// its time range). Without vectors or a key it falls back to keywords alone.
//
// Usage:
//   node tools/search-media.mjs --media <media dir> [--query "bowl de pollo visto desde arriba"] \
//        [--like <id>] [--type image|video|audio] [--orientation portrait|landscape|square] \
//        [--product "Bowl de Pollo"] [--person "Kathe"] [--source brand|generated|external] \
//        [--keywords-only] [--limit 20] [--json]
//   --like <id>  rank by similarity to that asset's description (combine with filters)
import { pathToFileURL } from 'node:url';
import { catalogPaths, readRecords, readProducts, parseArgs, mediaDirFrom } from './lib/catalog.mjs';
import { gatewayKey, embed, queryText, unpackVec, cosine } from './lib/gateway.mjs';
import { readVectors } from './embed-media.mjs';

function loadAliases(mediaDir) {
  const map = new Map(); // alias/canonical (lower) -> [canonical names]
  for (const prod of readProducts(mediaDir)) {
    const names = [prod.name, ...(prod.aliases || [])].filter(Boolean);
    for (const n of names) map.set(String(n).toLowerCase(), names);
  }
  return map;
}

const lc = (s) => String(s ?? '').toLowerCase();
const haystacks = (r) => ({
  products: lc((r.products || []).join(' ')),
  people: lc([...(r.people || []), ...(r.unknown_people || []).map((u) => u.description)].join(' ')),
  tags: lc((r.tags || []).join(' ')),
  name: lc(r.file?.name),
  text: lc(r.text_in_media),
  vis: lc(r.visual_description) + ' ' + lc((r.scenes || []).map((s) => s.description).join(' ')),
  audio: lc(r.audio_description) + ' ' + lc(r.audio_transcript?.text),
  source: lc(r.source?.name),
});
const WEIGHT = { products: 5, people: 4, tags: 3, name: 3, text: 2, vis: 1, audio: 1, source: 1 };

function keywordRank(rows, tokens) {
  return rows.map((r) => {
    const h = haystacks(r); let score = 0, hits = 0;
    for (const tok of new Set(tokens)) { let found = false; for (const f of Object.keys(WEIGHT)) if (h[f].includes(tok)) { score += WEIGHT[f]; found = true; } if (found) hits++; }
    return { r, score, hits };
  }).filter((x) => x.hits > 0).sort((a, b) => b.score - a.score).map((x) => x.r);
}

// Best semantic match per record: max over its text and scene vectors.
function semanticRank(rows, store, q, { textOnly = false } = {}) {
  const out = [];
  for (const r of rows) {
    const it = store.items[r.id];
    if (!it) continue;
    let best = -1, scene = null;
    const consider = (s, sc = null) => { if (s > best) { best = s; scene = sc; } };
    if (it.text) consider(cosine(q, unpackVec(it.text)));
    if (!textOnly) (it.scenes || []).forEach((v, i) => v && consider(cosine(q, unpackVec(v)), i));
    out.push({ r, score: best, scene });
  }
  return out.sort((a, b) => b.score - a.score);
}

// Reciprocal-rank fusion: robust to the two rankers' different score scales.
function fuse(lists, k = 60) {
  const acc = new Map();
  for (const list of lists) list.forEach((x, i) => {
    const cur = acc.get(x.r.id) || { r: x.r, score: 0, scene: null };
    cur.score += 1 / (k + i + 1);
    if (x.scene != null && cur.scene == null) cur.scene = x.scene;
    acc.set(x.r.id, cur);
  });
  return [...acc.values()].sort((a, b) => b.score - a.score);
}

export async function search(mediaDir, opts = {}) {
  const recs = readRecords(catalogPaths(mediaDir));
  const aliases = loadAliases(mediaDir);
  const expand = (term) => { const t = lc(term); const set = new Set([t]); if (aliases.has(t)) aliases.get(t).forEach((n) => set.add(lc(n))); return [...set]; };

  let rows = recs.filter((r) => {
    if (opts.type && r.file?.type !== opts.type) return false;
    if (opts.orientation && r.file?.orientation !== opts.orientation) return false;
    if (opts.source && r.source?.type !== opts.source) return false;
    if (opts.product) { const want = expand(opts.product); const have = (r.products || []).map(lc); if (!want.some((w) => have.some((h) => h.includes(w) || w.includes(h)))) return false; }
    if (opts.person) { const w = lc(opts.person); if (!haystacks(r).people.includes(w)) return false; }
    return true;
  });

  const store = opts.keywordsOnly ? null : readVectors(mediaDir);
  const key = store ? gatewayKey(mediaDir) : '';
  let ranked; let mode = 'keywords';

  if (opts.like) {
    const it = store?.items[opts.like];
    if (!it?.text) throw new Error(`no vector for ${opts.like} — run embed-media first`);
    ranked = semanticRank(rows.filter((r) => r.id !== opts.like), store, unpackVec(it.text), { textOnly: true });
    mode = 'similar';
  } else if (opts.query) {
    const kw = keywordRank(rows, opts.query.split(/\s+/).filter(Boolean).flatMap(expand)).map((r) => ({ r }));
    if (store && key) {
      const [q] = await embed(key, [queryText(opts.query)]);
      const sem = semanticRank(rows, store, q).slice(0, 50);
      ranked = fuse([sem, kw]);
      mode = 'hybrid';
    } else ranked = kw;
  } else {
    ranked = rows.sort((a, b) => String(a.id).localeCompare(String(b.id))).map((r) => ({ r }));
  }
  const res = ranked.map((x) => ({ ...x.r, _match: x.scene != null && x.r.scenes?.[x.scene] ? { scene: x.scene + 1, start: x.r.scenes[x.scene].start, end: x.r.scenes[x.scene].end } : undefined }));
  res.mode = mode;
  return opts.limit ? Object.assign(res.slice(0, opts.limit), { mode }) : res;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const mediaArg = a.media || a._[0];
  if (!mediaArg) { console.error('Usage: node tools/search-media.mjs --media <media dir> [--query ..] [--like <id>] [--type ..] [--orientation ..] [--product ..] [--person ..] [--source ..] [--keywords-only] [--limit N] [--json]'); process.exit(1); }
  const mediaDir = mediaDirFrom(mediaArg);
  const opts = { query: a.query === true ? '' : a.query, like: a.like, type: a.type, orientation: a.orientation, product: a.product, person: a.person, source: a.source, keywordsOnly: !!a['keywords-only'], limit: a.limit ? +a.limit : 20 };
  const res = await search(mediaDir, opts);
  if (a.json) {
    console.log(JSON.stringify(res.map((r) => ({ id: r.id, type: r.file?.type, name: r.file?.name, path: `inputs/media/${r.file?.name}`, proxy: r.file?.type === 'image' ? `_catalog/proxies/${r.id}.jpg` : `_catalog/thumbs/${r.id}.jpg`, match: r._match, products: r.products, people: r.people })), null, 2));
  } else {
    console.log(`${res.length} result${res.length === 1 ? '' : 's'}${opts.query ? ` for "${opts.query}"` : opts.like ? ` like ${opts.like}` : ''} [${res.mode}]:`);
    for (const r of res) {
      const snip = (r.visual_description || r.audio_description || r.audio_transcript?.text || '').replace(/\s+/g, ' ').slice(0, 90);
      console.log(`  ${r.id}  [${r.file?.type}/${r.file?.orientation || '?'}]  ${r.file?.name}${r._match ? `  ▸ scene ${r._match.scene} @ ${r._match.start}–${r._match.end}s` : ''}`);
      if (r.products?.length) console.log(`        products: ${r.products.join(', ')}`);
      if (snip) console.log(`        ${snip}…`);
    }
  }
}
