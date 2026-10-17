// web.mjs — reading public store pages: fetch, Shopify's catalog, a page's product data and text.
import { decodeHtml } from './catalog.mjs';

export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

export async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) return '';
  return res.text();
}

export async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export const htmlText = (s) => decodeHtml((s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Every product of a Shopify store ([] when it isn't one).
export async function listShopifyProducts(store, maxPages = 100) {
  const products = [];
  for (let page = 1; page <= maxPages; page++) {
    let batch;
    try { batch = (await getJson(`${store}/products.json?limit=250&page=${page}`)).products || []; } catch { break; }
    products.push(...batch);
    if (batch.length < 250) break;
  }
  return products;
}

// schema.org Product objects in a page's JSON-LD.
export function jsonLdProducts(html) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if ([v['@type']].flat().includes('Product')) out.push(v);
    if (v['@graph']) walk(v['@graph']);
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* malformed block */ }
  }
  return out;
}

// A page's readable text as light markdown: headings, paragraphs and list items, each once, without
// the navigation, footer, scripts and forms around them.
export function pageMarkdown(html) {
  const body = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<body[\s\S]*<\/body>/i) || [html])[0]
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const lines = [], seen = new Set();
  for (const m of body.matchAll(/<(h[1-4]|p|li|td|th|blockquote|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = htmlText(m[2]);
    if (text.length < 4 || seen.has(text)) continue; // sizes, counters, repeats
    seen.add(text);
    const tag = m[1].toLowerCase();
    lines.push(tag[0] === 'h' ? `${'#'.repeat(+tag[1] + 1)} ${text}` : tag === 'li' ? `- ${text}` : text);
  }
  return lines.join('\n\n');
}

// The page as a browser sees it, for stores that build their pages with JavaScript or turn away
// plain requests. raw: the response body as sent (a sitemap's XML) instead of the rendered page.
export async function renderedHtml(url, { raw = false } = {}) {
  const { chromium } = await import('playwright-core');
  let browser;
  for (const channel of ['chrome', 'msedge', 'chromium']) {
    try { browser = await chromium.launch({ channel }); break; } catch { }
  }
  if (!browser) return '';
  try {
    const page = await browser.newPage({ userAgent: UA });
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
    return raw ? (await res?.text().catch(() => '')) || '' : await page.content();
  } finally { await browser.close(); }
}
