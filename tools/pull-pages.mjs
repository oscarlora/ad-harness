#!/usr/bin/env node
// pull-pages.mjs — read a store's product catalog and pages into a brand's inputs/ (research-brand's
// collection phase). Shopify stores give the whole catalog from /products.json; elsewhere product
// pages come from the sitemap and their schema.org Product data. Pages built with JavaScript are
// rendered in a browser when their plain HTML has no text.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandDirFrom, die, parseArgs, slugify, usage } from './lib/catalog.mjs';
import { getText, htmlText, jsonLdProducts, listShopifyProducts, pageMarkdown, renderedHtml } from './lib/web.mjs';

const HELP = `pull-pages.mjs — a store's catalog and pages into the brand's inputs/

  node tools/pull-pages.mjs --store <url> --brand <brand dir> [--url <page> …] [--limit <n>] [--competitor <name>]

  --store <url>    the store's home page; its products (Shopify's catalog, else its sitemap's
                   product pages) are read
  --url <page>     another page to read: about, FAQ, science, a landing page… (repeatable; also
                   works without --store)
  --limit <n>      at most n products (default: all)
  --competitor <name>  a competitor's pages: into inputs/sources/competitors/<name>/, and none of
                   its products join products.json

Writes inputs/sources/pages/<page>.md per page (its product data, then its text) and adds each
product to inputs/products.json (name, link, price, variants, image), keeping what's already there.`;

const args = parseArgs(process.argv.slice(2), { repeat: ['url'], help: HELP });
if (!args.brand || (!args.store && !args.url?.length)) usage(HELP);
const brand = brandDirFrom(String(args.brand));
const competitor = args.competitor ? slugify(String(args.competitor)) : '';
const pagesDir = join(brand, 'inputs', 'sources', ...(competitor ? ['competitors', competitor] : ['pages']));
const limit = Number(args.limit) || Infinity;
const store = args.store ? String(args.store).replace(/\/+$/, '').replace(/^(?!https?:)/, 'https://') : '';

const slug = (url) => (new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || 'home').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
const tag = (t) => !/[:_#]|^[A-Z0-9 -]+$/.test(t); // the store's own tags, not its internal codes
const money = (v) => (v == null || v === '' ? '' : String(v));

// The page's text, rendered in a browser when the plain HTML carries none.
async function readPage(url) {
  let html = await getText(url);
  let text = pageMarkdown(html);
  if (text.length < 200) {
    const rendered = await renderedHtml(url).catch(() => '');
    if (pageMarkdown(rendered).length > text.length) { html = rendered; text = pageMarkdown(rendered); }
  }
  return { html, text };
}

function ldFacts(p) {
  const offers = [p.offers].flat().filter(Boolean);
  const price = offers.map((o) => o.price ?? o.lowPrice).find((v) => v != null);
  const rating = p.aggregateRating ? `${p.aggregateRating.ratingValue} from ${p.aggregateRating.reviewCount || p.aggregateRating.ratingCount} reviews` : '';
  return { name: p.name, price: money(price), currency: offers[0]?.priceCurrency || '', rating, image: [p.image].flat()[0]?.url || [p.image].flat()[0] || '' };
}

function writePage(name, lines) {
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(join(pagesDir, `${name}.md`), lines.filter((l) => l != null).join('\n') + '\n');
}

const found = []; // products for products.json

// Shopify: the catalog's data, then the product page's own text (ingredients, FAQ… live there).
async function shopify(products) {
  for (const p of products.slice(0, limit)) {
    const url = `${store}/products/${p.handle}`;
    const { html, text } = await readPage(url);
    const ld = jsonLdProducts(html).map(ldFacts)[0] || {};
    const prices = [...new Set(p.variants.map((v) => v.price))];
    const variants = p.variants.map((v) => `${v.title === 'Default Title' ? p.title : v.title} — ${v.price}${v.available === false ? ' (sold out)' : ''}`);
    writePage(p.handle, [
      `# ${p.title}`, '', `- Link: ${url}`, `- Type: ${p.product_type || 'Unknown'}`, `- Price: ${prices.join(' / ')}`,
      ld.rating ? `- Rating: ${ld.rating}` : null, p.tags?.some(tag) ? `- Tags: ${p.tags.filter(tag).join(', ')}` : null,
      '', '## Variants', '', ...variants.map((v) => `- ${v}`),
      '', '## Description', '', htmlText(p.body_html) || 'Unknown',
      '', '## Images', '', ...p.images.slice(0, 10).map((i) => `- ${i.src}`),
      '', '## Page text', '', text || 'Unknown',
    ]);
    found.push({ name: p.title, product_url: url, product_id: `shopify-${p.id}`, price: prices.join(' / '), variants: p.variants.map((v) => v.title).filter((t) => t !== 'Default Title'), image: p.images[0]?.src || '' });
    console.error(`  ${p.handle}`);
  }
}

// Elsewhere: product pages from the sitemaps (robots.txt lists them), else the home page's links.
const PRODUCT = /\/(products?|p|shop)\/[^/?#]+\/?$/i;
const isXml = (s) => /^\s*(<\?xml|<(urlset|sitemapindex))/.test(s);
async function sitemapProducts() {
  const urls = new Set();
  const read = async (u, depth = 0) => {
    let xml = await getText(u);
    if (!isXml(xml)) xml = await renderedHtml(u, { raw: true }).catch(() => '');
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const loc = m[1].trim();
      if (/\.xml(\?|$)/.test(loc)) { if (depth < 2 && /product|pdp|catalog/i.test(loc)) await read(loc, depth + 1); }
      else if (PRODUCT.test(new URL(loc).pathname)) urls.add(loc);
    }
  };
  const robots = await getText(`${store}/robots.txt`);
  const maps = [...robots.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  for (const u of maps.length ? maps : [`${store}/sitemap.xml`]) await read(u);
  if (!urls.size) {
    const home = await renderedHtml(store).catch(() => '');
    const links = new Set();
    for (const m of home.matchAll(/href="([^"#?]+)"/g)) {
      const u = new URL(m[1], store);
      if (u.origin !== new URL(store).origin || /\.\w{2,5}$|^\/_|^\/$/.test(u.pathname)) continue;
      (PRODUCT.test(u.pathname) ? urls : links).add(u.href);
    }
    if (!urls.size && links.size) console.log(`No product pages found. The home page links to:\n${[...links].slice(0, 40).join('\n')}\nOpen the categories, then pass the product pages with --url.`);
  }
  return [...urls].slice(0, limit);
}

async function genericPage(url) {
  const { html, text } = await readPage(url);
  const ld = jsonLdProducts(html).map(ldFacts)[0];
  const title = ld?.name || htmlText((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]) || slug(url);
  writePage(slug(url), [
    `# ${title}`, '', `- Link: ${url}`,
    ld ? `- Price: ${[ld.currency, ld.price].filter(Boolean).join(' ') || 'Unknown'}` : null,
    ld?.rating ? `- Rating: ${ld.rating}` : null, ld?.image ? `- Image: ${ld.image}` : null,
    '', '## Page text', '', text || 'Unknown',
  ]);
  if (ld) found.push({ name: ld.name, product_url: url, price: [ld.currency, ld.price].filter(Boolean).join(' '), image: ld.image });
  console.error(`  ${slug(url)}`);
}

// New products join inputs/products.json; existing ones keep their names, aliases and looks.
function saveProducts() {
  if (!found.length || competitor) return;
  const file = join(brand, 'inputs', 'products.json');
  const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const list = Array.isArray(old) ? old : old.products || [];
  for (const p of found) {
    const i = list.findIndex((o) => (o.product_url && o.product_url === p.product_url) || o.name === p.name);
    if (i < 0) list.push({ ...p, aliases: [] });
    else list[i] = { ...p, ...list[i], price: p.price, variants: p.variants ?? list[i].variants, image: list[i].image || p.image };
  }
  writeFileSync(file, JSON.stringify(Array.isArray(old) ? list : { ...old, products: list }, null, 2) + '\n');
  console.log(`products.json: ${list.length} products`);
}

if (store) {
  const products = await listShopifyProducts(store);
  if (products.length) { console.error(`Shopify catalog: ${products.length} products`); await shopify(products); }
  else {
    const urls = await sitemapProducts();
    console.error(`sitemap: ${urls.length} product pages`);
    for (const u of urls) await genericPage(u);
  }
}
for (const u of args.url || []) await genericPage(String(u));
saveProducts();
console.log(`Pages: ${pagesDir}`);
if (!found.length && !args.url?.length) die('nothing read: check the store URL, or pass pages with --url');
