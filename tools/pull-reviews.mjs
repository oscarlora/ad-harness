#!/usr/bin/env node
// pull-reviews.mjs — detect a store's review platform and pull its public reviews to CSV, from the
// same public feed the on-page widget uses (no API key).
// Okendo, Stamped, Judge.me and Loox work; Yotpo / Reviews.io are detect-only (exit 2).
//
// ADDING AN ADAPTER (listed platforms only, never one-off stores). Stop as soon as one request
// returns the reviews:
//   1. Search the platform's docs for the public widget endpoint and the id it needs.
//   2. Load a product page and copy the review widget's own network request (URL, params, paging).
//   3. Verify with one curl; tune page size and pagination until a full pull works.
//   4. No public feed? Scrape the rendered widget, or write the CSV by hand without an adapter.
// Then: confirm its SIGNATURES entry, add an id-extractor (like extractOkendoSubscriber) and a
// pull<Platform> mapping to the shared CSV columns, dispatch it in main, and check the total against
// the on-page count.

import { writeFile } from 'node:fs/promises';
import { die, parseArgs, usage } from './lib/catalog.mjs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MAX_PAGES = 100;
const OKENDO_API = 'https://api.okendo.io/v1';
const STAMPED_API = 'https://stamped.io/api';   // public widget feed: getappkey + /widget (per page)
const JUDGEME_API = 'https://api.judge.me';     // v3 widget JSON feed: reviews/reviews_for_widget

const HELP = `pull-reviews.mjs — detect a store's review platform and pull reviews to CSV

  node tools/pull-reviews.mjs --store <url> [--out reviews.csv] [--limit n]

Required:
  --store <url>            Store base URL (e.g. https://www.acme.global)

Common:
  --out <path>             CSV output path (default: reviews.csv)
  --detect-only            Print detected platform + IDs, write nothing
  --limit <n>              Cap output at n reviews (default: all)
  --product-id <id>        Scope to one product (platform-native id, e.g. shopify-6634095935560)

Overrides (skip auto-detection):
  --platform <name>        okendo | judgeme | loox | yotpo | stamped | reviewsio
  --subscriber <uuid>      Okendo subscriber id (if HTML detection misses it)
  --shop-domain <domain>   Judge.me: the store's .myshopify.com domain (if detection misses it)
  --loox-store <id>        Loox store id, from the loox.io/widget/<id>/loox.js URL (if detection misses it)

Other platforms are detected and reported, then the script exits 2.`;

const log = (...a) => console.error(...a);

// ---------- platform signatures (substring -> platform) ----------
const SIGNATURES = {
  okendo:   [/okendo/i, /data-oke-/i],
  judgeme:  [/judge\.me/i, /judgeme/i, /jdgm-/i],
  loox:     [/\bloox\b/i],
  yotpo:    [/yotpo/i],
  stamped:  [/\bstamped\b/i],
  reviewsio: [/reviews\.io/i],
};

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return '';
  return res.text();
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// Scan the homepage plus (if Shopify) one product page — where widget scripts and store ids live.
async function collectHtml(store) {
  let html = await getText(store);
  let shopify = false, sampleHandle = null;
  try {
    const pj = await getJson(`${store}/products.json?limit=1`);
    if (Array.isArray(pj?.products)) {
      shopify = true;
      sampleHandle = pj.products[0]?.handle || null;
    }
  } catch { /* not Shopify */ }
  if (sampleHandle) html += '\n' + await getText(`${store}/products/${sampleHandle}`);
  return { html, shopify };
}

function detectPlatform(html) {
  const scores = {};
  for (const [name, pats] of Object.entries(SIGNATURES)) {
    scores[name] = pats.reduce((n, re) => n + ((html.match(new RegExp(re, 'gi')) || []).length), 0);
  }
  const ranked = Object.entries(scores).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return { platform: ranked[0]?.[0] || null, scores };
}

function extractOkendoSubscriber(html) {
  const m = html.match(/subscriberId"\s*:\s*"([0-9a-f-]{36})"/i)
        || html.match(/okendo[^"]{0,80}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : null;
}

// Stamped keys its public feed to the store's .myshopify.com domain (not the public domain).
function extractMyshopifyDomain(html) {
  const m = html.match(/([a-z0-9][a-z0-9-]*\.myshopify\.com)/i);
  return m ? m[1].toLowerCase() : null;
}

// ---------- CSV (a column a row lacks is written empty) ----------
const CSV_COLS = ['review_number', 'date', 'product', 'rating', 'reviewer', 'verified',
  'recommended', 'incentivized', 'title', 'body', 'helpful_count', 'language', 'review_id', 'product_url'];

function csvField(v) {
  const s = v == null ? '' : String(v).replace(/\r\n/g, '\n');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(arr) { return arr.map(csvField).join(','); }

// ---------- Okendo adapter ----------
async function pullOkendo({ subscriber, productId, limit }) {
  let url = productId
    ? `${OKENDO_API}/stores/${subscriber}/products/${productId}/reviews?limit=100`
    : `${OKENDO_API}/stores/${subscriber}/reviews?limit=100`;
  const reviews = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data = await getJson(url);
    const batch = data.reviews || [];
    reviews.push(...batch);
    log(`  page ${page}: +${batch.length} (total ${reviews.length})`);
    if (limit && reviews.length >= limit) { reviews.length = limit; break; }
    url = data.nextUrl ? OKENDO_API + data.nextUrl : null;
  }
  return reviews.map((r) => {
    const rv = r.reviewer || {};
    return {
      date: (r.dateCreated || '').slice(0, 10),
      product: r.productName || '',
      rating: r.rating ?? '',
      reviewer: rv.displayName,
      verified: rv.isVerified,
      recommended: r.isRecommended,
      incentivized: r.isIncentivized,
      title: (r.title || '').trim(),
      body: (r.body || '').trim(),
      helpful_count: r.helpfulCount,
      language: r.languageCode,
      review_id: r.reviewId,
      product_url: (r.productUrl || '').replace(/^\/\//, 'https://'),
    };
  });
}

// ---------- Stamped adapter ----------
// No JSON feed: get the public key from getappkey, then parse /widget's rendered HTML per page.
const htmlText = (s) => (s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&#8217;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

function parseStampedWidget(html) {
  const out = [];
  const blocks = html.split(/(?=<div class="stamped-review" )/).slice(1);
  for (const b of blocks) {
    const ratingSpan = (b.match(/stamped-review-header-starratings[\s\S]*?<\/span>/) || [''])[0];
    const mdy = (b.match(/created">([^<]+)</) || [])[1] || '';      // MM/DD/YYYY
    const [mm, dd, yy] = mdy.split('/');
    out.push({
      review_id: (b.match(/id="stamped-review-(\d+)"/) || [])[1] || '',
      date: yy ? `${yy}-${mm}-${dd}` : '',
      product: htmlText((b.match(/stamped-review-product"[^>]*>([\s\S]*?)<\/div>/) || ['', ''])[1]),
      rating: (ratingSpan.match(/stamped-fa-star '/g) || []).length,
      reviewer: htmlText((b.match(/class="author">([\s\S]*?)<\/strong>/) || ['', ''])[1]),
      verified: /data-verified="buyer"/.test(b),
      recommended: (b.match(/data-is-recommend="(true|1)"/) || [])[1] ? true : '',
      title: htmlText((b.match(/stamped-review-header-title">([\s\S]*?)<\/h3>/) || ['', ''])[1]),
      body: htmlText((b.match(/stamped-review-content-body">([\s\S]*?)<\/p>/) || ['', ''])[1]),
    });
  }
  return out;
}

async function pullStamped({ apiKey, sId, storeUrl, limit }) {
  const reviews = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${STAMPED_API}/widget?apiKey=${encodeURIComponent(apiKey)}&sId=${sId}`
      + `&storeUrl=${encodeURIComponent(storeUrl)}&take=100&page=${page}&sortReviews=newest`;
    const data = await getJson(url);
    const batch = parseStampedWidget(data.widget || '');
    if (!batch.length) break;
    reviews.push(...batch);
    const total = data.count || 0;
    log(`  page ${page}: +${batch.length} (total ${reviews.length}${total ? ` / ${total}` : ''})`);
    if (limit && reviews.length >= limit) { reviews.length = limit; break; }
    if (total && reviews.length >= total) break;
  }
  return reviews;
}

// ---------- Loox adapter ----------
// No JSON feed: server-rendered HTML from loox.io/widget/<storeId>/reviews, 20 per page. Product
// reviews by default, store reviews with &currentTab=store; the first page embeds each tab's total.
function extractLooxStoreId(html) {
  const m = html.match(/loox\.io\\?\/widget\\?\/([A-Za-z0-9_-]+)\\?\/loox/i);
  return m ? m[1] : null;
}

function parseLooxWidget(html, tab) {
  const out = [];
  const blocks = html.split(/(?=<div [^>]*data-id="[^"]+"[^>]*class="grid-item-wrap)/).slice(1);
  for (const b of blocks) {
    const id = (b.match(/data-id="([^"]+)"/) || [])[1] || '';
    const ms = Number((b.match(/data-time='(\d+)'/) || [])[1]);
    out.push({
      review_id: id,
      date: ms ? new Date(ms).toISOString().slice(0, 10) : '',
      product: tab === 'store' ? 'Store review'
        : htmlText((b.match(/class="name(?: name-with-img)?">([\s\S]*?)<\/div>/) || ['', ''])[1]),
      rating: (b.match(/Rating icons:\s*(\d)\s*\/\s*5/) || [])[1] || '',
      reviewer: htmlText((b.match(/-title" class="block title">([^<]*)/) || ['', ''])[1]),
      verified: /loox-verified-badge/.test(b),
      body: htmlText((b.match(/class="pre-wrap main-text">([\s\S]*?)<\/div>/) || ['', ''])[1]),
    });
  }
  return out;
}

async function pullLoox({ storeId, limit }) {
  const base = `https://loox.io/widget/${storeId}/reviews?limit=20&language=en`;
  const seen = new Map();
  for (const tab of ['product', 'store']) {
    let total = 0;
    for (let page = 1; page <= 500; page++) {   // 20/page, so this tool's usual MAX_PAGES is too low
      const html = await getText(`${base}&page=${page}${tab === 'store' ? '&currentTab=store' : ''}`);
      if (page === 1) {
        const m = html.match(/currentTab === 'store'\) \? '(\d+)' : '(\d+)'/);
        total = m ? Number(tab === 'store' ? m[1] : m[2]) : 0;
      }
      const batch = parseLooxWidget(html, tab);
      if (!batch.length) break;
      let added = 0;
      for (const r of batch) if (!seen.has(r.review_id)) { seen.set(r.review_id, r); added++; }
      if (!added) break;                           // server repeating the last page
      if (page % 10 === 0) log(`  ${tab} page ${page}: ${seen.size} unique${total ? ` (tab total ${total})` : ''}`);
      if (limit && seen.size >= limit) break;
    }
    log(`  ${tab} reviews done: ${seen.size} unique so far (tab total ${total || '?'})`);
    if (limit && seen.size >= limit) break;
  }
  const rows = [...seen.values()];
  return limit ? rows.slice(0, limit) : rows;
}

// ---------- Judge.me adapter ----------
// JSON feed at api.judge.me/reviews/reviews_for_widget, keyed by the .myshopify.com domain. It
// serves at most ~1000 rows per ordering (deeper pages silently repeat the last window), so we
// partition per product x rating (the histogram gives targets), crawl newest- and oldest-first,
// then a verified_only pass and a ladder of words common in any product review (`search`);
// shortfalls are reported.
// Sister products share reviews, so every product in /products.json is crawled, covered groups
// skipped, and rows deduped by uuid. No public incentivized flag: invitation-email reviews get
// 'store_invitation' in that column.
const JM_PER_PAGE = 25;          // 40 pages x 25 = 1000, the full window
const JM_WINDOW_PAGES = 40;
const JM_SEARCH_LADDER = ['love', 'great', 'good', 'best', 'recommend', 'amazing', 'quality', 'use',
  'easy', 'feel', 'nice', 'perfect', 'happy', 'well', 'really', 'works', 'product', 'price', 'buy',
  'again', 'time', 'day', 'first', 'definitely', 'beautiful', 'gift', 'fast', 'shipping', 'order',
  'size', 'friend', 'family', 'worth', 'little', 'bit', 'just'];

async function listShopifyProducts(store) {
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const d = await getJson(`${store}/products.json?limit=250&page=${page}`);
    const batch = d.products || [];
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

function jmUrl(shopDomain, productId, { page = 1, dir = 'desc', rating, verified, search } = {}) {
  let u = `${JUDGEME_API}/reviews/reviews_for_widget?shop_domain=${encodeURIComponent(shopDomain)}`
    + `&platform=shopify&product_id=${productId}&per_page=${JM_PER_PAGE}&page=${page}`
    + `&sort_by=created_at&sort_dir=${dir}`;
  if (rating) u += `&filter_rating=${rating}`;
  if (verified) u += '&verified_only=true';
  if (search) u += `&search=${encodeURIComponent(search)}`;
  return u;
}

function jmMapReview(r, fallbackTitle) {
  return {
    date: (r.created_at || '').slice(0, 10),
    product: htmlText(r.product_title || fallbackTitle || ''),
    rating: r.rating ?? '',
    reviewer: r.reviewer_name,
    verified: r.verified_buyer,
    incentivized: (r.transparency_badges || []).includes('review_collected_via_store_invitation')
      ? 'store_invitation' : '',
    title: htmlText(r.title || ''),
    body: htmlText(r.body_html || ''),
    helpful_count: r.thumb_up,
    language: r.language,
    review_id: r.uuid,
    product_url: r.product_url,
  };
}

async function pullJudgeme({ shopDomain, store, productId, limit }) {
  const products = productId
    ? [{ id: productId, title: '' }]
    : (await listShopifyProducts(store)).map((p) => ({ id: p.id, title: p.title }));
  log(`  crawling ${products.length} product(s), deduping grouped reviews by uuid`);
  const seen = new Map();          // uuid -> row (global dedupe)
  const doneGroups = new Set();    // "<n>|<first uuid>" of fully-crawled review groups
  let requests = 0;

  // One paginated ordering. Stops at the window edge (repeat page), empty page, or when
  // stop() says the target is reached. Returns the first response (for count/histogram).
  async function crawlOrdering(pid, opts, collect, stop) {
    let firstResp = null, prevFirstUuid = null;
    for (let page = 1; page <= JM_WINDOW_PAGES; page++) {
      let d;
      try { d = await getJson(jmUrl(shopDomain, pid, { ...opts, page })); requests++; }
      catch (e) { log(`  product ${pid}: ${e.message} (ordering skipped)`); break; }
      firstResp = firstResp || d;
      const batch = d.reviews || [];
      if (!batch.length) break;
      if (batch[0]?.uuid === prevFirstUuid) break;   // window edge: server repeats last page
      prevFirstUuid = batch[0]?.uuid;
      for (const r of batch) collect(r);
      if (stop && stop()) break;
      if (page >= (d.pagination?.total_pages || 1)) break;
    }
    return firstResp;
  }

  for (const p of products) {
    const inBucket = {};   // rating -> Set of uuids seen in this product's review group
    const collect = (r) => {
      (inBucket[r.rating] ||= new Set()).add(r.uuid);
      if (!seen.has(r.uuid)) seen.set(r.uuid, jmMapReview(r, p.title));
    };
    const hitLimit = () => !!(limit && seen.size >= limit);

    // Newest-first baseline; its first response identifies the group and gives targets.
    const first = await crawlOrdering(p.id, {}, collect, hitLimit);
    if (!first) continue;
    const total = first.number_of_reviews || 0;
    const groupKey = `${total}|${first.reviews?.[0]?.uuid || ''}`;
    if (!total) continue;
    if (doneGroups.has(groupKey)) { log(`  product ${p.id} (${p.title}): same review group, already covered`); continue; }
    if (hitLimit()) break;

    // Group bigger than one window: work rating by rating against the histogram.
    if (total > JM_PER_PAGE * JM_WINDOW_PAGES) {
      for (const h of first.histogram || []) {
        const target = h.frequency || 0;
        if (!target) continue;
        const got = () => (inBucket[h.rating]?.size || 0);
        const covered = () => got() >= target || hitLimit();
        if (!covered()) await crawlOrdering(p.id, { rating: h.rating }, collect, covered);
        if (!covered()) await crawlOrdering(p.id, { rating: h.rating, dir: 'asc' }, collect, covered);
        if (!covered()) {
          await crawlOrdering(p.id, { rating: h.rating, verified: true }, collect, covered);
          if (!covered()) await crawlOrdering(p.id, { rating: h.rating, verified: true, dir: 'asc' }, collect, covered);
        }
        for (const term of JM_SEARCH_LADDER) {
          if (covered()) break;
          await crawlOrdering(p.id, { rating: h.rating, search: term }, collect, covered);
          if (!covered()) await crawlOrdering(p.id, { rating: h.rating, search: term, dir: 'asc' }, collect, covered);
        }
        if (got() < target && !hitLimit()) log(`  product ${p.id} rating ${h.rating}: ${got()}/${target} — feed window exhausted, rest unreachable`);
      }
    }

    const gotTotal = Object.values(inBucket).reduce((s, x) => s + x.size, 0);
    doneGroups.add(groupKey);
    log(`  product ${p.id}${p.title ? ` (${p.title})` : ''}: ${gotTotal}/${total} of its group, ${seen.size} unique total`);
    if (hitLimit()) break;
  }
  log(`  ${requests} feed requests`);
  return [...seen.values()];
}

// ---------- main ----------
const args = parseArgs(process.argv.slice(2), { flags: ['detect-only'], help: HELP });
if (!args.store) usage(HELP);
const limit = args.limit ? Number(args.limit) : 0;

const store = String(args.store).replace(/\/+$/, '');
let platform = args.platform || null;
let subscriber = args.subscriber || null;
let stamped = null;   // { apiKey, sId, storeUrl }
let judgemeDomain = args['shop-domain'] || null;   // the store's .myshopify.com domain
let looxStoreId = args['loox-store'] || null;

// Detect (and grab platform ids) unless every id needed was passed on the CLI.
if (!platform || (platform === 'okendo' && !subscriber) || platform === 'stamped'
    || (platform === 'judgeme' && !judgemeDomain) || (platform === 'loox' && !looxStoreId)) {
  log(`Detecting review platform for ${store} ...`);
  const { html, shopify } = await collectHtml(store);
  if (!html) die(`could not fetch any HTML from ${store}`);
  const det = detectPlatform(html);
  platform = platform || det.platform;
  log(`  Shopify: ${shopify ? 'yes' : 'no'}`);
  log(`  signature scores: ${JSON.stringify(det.scores)}`);
  log(`  -> platform: ${platform || 'UNKNOWN'}`);
  if (platform === 'okendo' && !subscriber) {
    subscriber = extractOkendoSubscriber(html);
    log(`  -> okendo subscriber: ${subscriber || 'NOT FOUND'}`);
  }
  if (platform === 'stamped') {
    const domain = extractMyshopifyDomain(html);
    log(`  -> myshopify domain: ${domain || 'NOT FOUND'}`);
    if (domain) {
      try {
        const k = await getJson(`${STAMPED_API}/getappkey?shopShopifyDomain=${encodeURIComponent(domain)}`);
        if (k?.apiKey && k?.sId) stamped = { apiKey: k.apiKey, sId: k.sId, storeUrl: domain };
        log(`  -> stamped pubkey: ${stamped ? `${stamped.apiKey} (sId ${stamped.sId})` : 'NOT FOUND'}`);
      } catch (e) { log(`  -> stamped getappkey failed: ${e.message}`); }
    }
  }
  if (platform === 'judgeme' && !judgemeDomain) {
    judgemeDomain = extractMyshopifyDomain(html);
    log(`  -> myshopify domain: ${judgemeDomain || 'NOT FOUND'}`);
  }
  if (platform === 'loox' && !looxStoreId) {
    looxStoreId = extractLooxStoreId(html);
    log(`  -> loox store id: ${looxStoreId || 'NOT FOUND'}`);
  }
}

if (args['detect-only']) {
  console.log(JSON.stringify({ store, platform, subscriber, stamped, judgemeDomain, looxStoreId }, null, 2));
  process.exit(0);
}

if (!platform) die('could not detect a review platform; pass --platform to override');

if (!['okendo', 'stamped', 'judgeme', 'loox'].includes(platform)) {
  log('');
  log(`Platform "${platform}" is detected but NOT yet implemented in this tool.`);
  log('Use the manual approach in the pull-reviews skill, then implement an adapter here.');
  process.exit(2);
}

let rows;
if (platform === 'stamped') {
  if (!stamped) die('stamped detected but could not resolve its public key (no .myshopify.com domain on page?)');
  log(`Pulling Stamped reviews (sId ${stamped.sId})...`);
  rows = await pullStamped({ ...stamped, limit });
} else if (platform === 'judgeme') {
  if (!judgemeDomain) die('judgeme detected but no .myshopify.com domain found on page; pass --shop-domain');
  log(`Pulling Judge.me reviews (shop ${judgemeDomain})...`);
  rows = await pullJudgeme({ shopDomain: judgemeDomain, store, productId: args['product-id'], limit });
} else if (platform === 'loox') {
  if (!looxStoreId) die('loox detected but no store id found in the loox.js URL; pass --loox-store <id>');
  log(`Pulling Loox reviews (store ${looxStoreId})...`);
  rows = await pullLoox({ storeId: looxStoreId, limit });
} else {
  if (!subscriber) die('okendo detected but no subscriber id found; pass --subscriber <uuid>');
  log(`Pulling Okendo reviews (subscriber ${subscriber})...`);
  rows = await pullOkendo({ subscriber, productId: args['product-id'], limit });
}
if (!rows.length) die('no reviews returned');

// newest first, then number 1..N
rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
rows.forEach((r, i) => { r.review_number = i + 1; });

const out = args.out || 'reviews.csv';
const csv = [csvRow(CSV_COLS), ...rows.map((r) => csvRow(CSV_COLS.map((c) => r[c])))].join('\n') + '\n';
await writeFile(out, csv, 'utf8');

// summary -> stderr
const dist = {};
for (const r of rows) dist[r.rating] = (dist[r.rating] || 0) + 1;
const avg = rows.reduce((s, r) => s + (Number(r.rating) || 0), 0) / rows.length;
const byProduct = {};
for (const r of rows) byProduct[r.product] = (byProduct[r.product] || 0) + 1;
const top = Object.entries(byProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
log('');
log(`Wrote ${rows.length} reviews -> ${out}`);
log(`  avg rating: ${avg.toFixed(2)} | distribution: ${JSON.stringify(dist)}`);
log(`  top products: ${top.map(([p, n]) => `${p} (${n})`).join(', ')}`);
