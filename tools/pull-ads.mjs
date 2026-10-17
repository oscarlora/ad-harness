#!/usr/bin/env node
// pull-ads.mjs — an advertiser's ads from Meta's public Ad Library (no login, no key): its most-seen
// and its newest. Drives Chrome on the Ad Library page and reads the ads from the JSON the page loads,
// so the page's look can change without breaking it. research-brand runs it for the brand and its
// competitors.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brandDirFrom, die, parseArgs, slugify, usage } from './lib/catalog.mjs';
import { downloadTo } from './lib/providers.mjs';
import { UA } from './lib/web.mjs';

const HELP = `pull-ads.mjs — an advertiser's top and newest ads from Meta's Ad Library

  node tools/pull-ads.mjs --advertiser "<name>" --brand <brand dir> [--page-id <id>] [--top 3] [--latest 3]
                          [--country US] [--name <folder name>]

  --advertiser <name>  the Facebook or Instagram page that runs the ads (the first match in the Ad
                       Library's advertiser search; the others print, so a wrong pick can be redone
                       with --page-id)
  --page-id <id>       the page's Ad Library id, instead of searching
  --top <n>            the n ads with the most impressions (default 3)
  --latest <n>         the n newest ads (default 3)
  --country <code>     whose Ad Library to read (default US)
  --name <folder>      the folder under inputs/sources/ads/ (default: the advertiser's name)

Writes inputs/sources/ads/<name>/ads.md (each ad's copy, headline, call to action, link, dates,
platforms and how many ads share it) with its images and videos beside it.`;

const args = parseArgs(process.argv.slice(2), { help: HELP });
if (!args.brand || (!args.advertiser && !args['page-id'])) usage(HELP);
const brand = brandDirFrom(String(args.brand));
const country = String(args.country || 'US').toUpperCase();
const counts = { top: Number(args.top ?? 3), latest: Number(args.latest ?? 3) };
const LIBRARY = 'https://www.facebook.com/ads/library/';
const SORT = { top: 'total_impressions', latest: 'relevancy_monthly_grouped' }; // the page's "Impressions: high to low" and "Most recent"

// Every object in a response that has key k (responses are JSON, sometimes several per body).
function findAll(text, k) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (k in v) out.push(v);
    Object.values(v).forEach(walk);
  };
  for (const part of text.split(/\n(?=\{)/)) { try { walk(JSON.parse(part)); } catch { } }
  return out;
}

const { chromium } = await import('playwright-core').catch(() => die('playwright-core missing — run: bash tools/setup.sh'));
let browser;
for (const channel of ['chrome', 'msedge', 'chromium']) { try { browser = await chromium.launch({ channel }); break; } catch { } }
if (!browser) die('no browser: install Google Chrome, or run: npx playwright-core install chromium');
const page = await browser.newPage({ userAgent: UA, locale: 'en-US' });
const bodies = [];
page.on('response', async (r) => {
  if (!/\/api\/graphql\/|\/ads\/library/.test(r.url())) return;
  try { bodies.push(await r.text()); } catch { }
});

try {
  // The advertiser's page id, from the search box's suggestions.
  let pageId = args['page-id'] ? String(args['page-id']) : '';
  let pageName = args.advertiser ? String(args.advertiser) : '';
  if (!pageId) {
    // A keyword search opens the results view, whose box suggests advertisers as you type.
    await page.goto(`${LIBRARY}?active_status=all&ad_type=all&country=${country}&media_type=all&search_type=keyword_unordered&q=${encodeURIComponent(pageName)}`, { waitUntil: 'networkidle', timeout: 60000 });
    const box = page.getByPlaceholder(/search by keyword or advertiser/i);
    await box.click();
    await box.fill('');
    bodies.length = 0;
    await box.pressSequentially(pageName, { delay: 60 });
    await page.waitForTimeout(4000);
    const pages = [];
    for (const b of bodies) for (const o of findAll(b, 'page_id')) if (o.name && !pages.some((p) => p.page_id === o.page_id)) pages.push(o);
    if (!pages.length) die(`no advertiser named like "${pageName}" in ${country}'s Ad Library: check the name, or pass --page-id`);
    const pick = pages.find((p) => p.name.toLowerCase() === pageName.toLowerCase()) || pages[0];
    pageId = String(pick.page_id); pageName = pick.name;
    console.log(`Advertiser: ${pick.name} (page id ${pageId})`);
    const others = pages.filter((p) => p !== pick).slice(0, 5);
    if (others.length) console.log(`Other matches (rerun with --page-id): ${others.map((p) => `${p.name} ${p.page_id}`).join(' · ')}`);
  }

  const ads = {};
  for (const [kind, n] of Object.entries(counts)) {
    if (!n) continue;
    bodies.length = 0;
    const url = `${LIBRARY}?active_status=all&ad_type=all&country=${country}&media_type=all&search_type=page&view_all_page_id=${pageId}&sort_data[direction]=desc&sort_data[mode]=${SORT[kind]}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const html = await page.content();
    const seen = new Set();
    const embedded = [...html.matchAll(/<script[^>]*application\/json[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]); // the first ads come in the page
    ads[kind] = [...embedded, ...bodies].flatMap((b) => findAll(b, 'ad_archive_id'))
      .filter((a) => a.snapshot && String(a.page_id) === pageId && !seen.has(a.ad_archive_id) && seen.add(a.ad_archive_id))
      .slice(0, n);
  }
  if (!ads.top?.length && !ads.latest?.length) die(`no ads found for ${pageName} (page id ${pageId}) in ${country}: it may not be running any`);

  // The ads, their media beside them.
  const dir = join(brand, 'inputs', 'sources', 'ads', slugify(String(args.name || pageName)));
  mkdirSync(dir, { recursive: true });
  const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '');
  const lines = [`# ${pageName} — Meta ads (${country})`, '', `Ad Library: ${LIBRARY}?active_status=all&ad_type=all&country=${country}&view_all_page_id=${pageId}`, ''];
  for (const [kind, list] of Object.entries(ads)) {
    lines.push(`## ${kind === 'top' ? 'Most impressions' : 'Newest'}`, '');
    for (const a of list) {
      const s = a.snapshot;
      const media = [];
      for (const v of [...(s.videos || []), ...(s.cards || [])].map((x) => x.video_hd_url || x.video_sd_url).filter(Boolean)) media.push([v, 'mp4']);
      for (const i of [...(s.images || []), ...(s.cards || [])].map((x) => x.original_image_url || x.resized_image_url).filter(Boolean)) media.push([i, 'jpg']);
      const files = [];
      for (const [i, [src, ext]] of media.slice(0, 4).entries()) {
        const out = join(dir, `${a.ad_archive_id}${i ? `-${i + 1}` : ''}.${ext}`);
        if (!existsSync(out)) await downloadTo(src, out, { fallbackExt: ext }).catch(() => null);
        if (existsSync(out)) files.push(out.split("/").pop());
      }
      // Catalog (dco) ads keep {{placeholders}} in the ad and the real words in each card.
      const real = (t) => (t && !/\{\{/.test(t) ? t.trim() : '');
      const text = real(s.body?.text) || [...new Set((s.cards || []).map((c) => real(c.body)).filter(Boolean))].join('\n\n');
      const headline = real(s.title) || [...new Set((s.cards || []).map((c) => real(c.title)).filter(Boolean))].join(' · ');
      lines.push(
        `### ${a.ad_archive_id}`, '',
        `- Link: ${LIBRARY}?id=${a.ad_archive_id}`,
        `- Running: ${day(a.start_date)} to ${a.is_active ? 'now' : day(a.end_date)}${a.collation_count > 1 ? ` · ${a.collation_count} ads use this creative` : ''}`,
        `- Platforms: ${(a.publisher_platform || []).join(', ').toLowerCase() || 'Unknown'}`,
        `- Format: ${(s.display_format || 'Unknown').toLowerCase()}${s.cards?.length > 1 ? `, ${s.cards.length} cards` : ''}`,
        headline ? `- Headline: ${headline}` : null,
        s.cta_text ? `- Call to action: ${s.cta_text}${s.link_url ? ` → ${s.link_url}` : ''}` : null,
        files.length ? `- Media: ${files.join(', ')}` : null,
        '', text ? text.split('\n').map((l) => `> ${l}`).join('\n') : '> (no copy)', '',
      );
    }
  }
  writeFileSync(join(dir, 'ads.md'), lines.filter((l) => l != null).join('\n'));
  console.log(`${(ads.top?.length || 0) + (ads.latest?.length || 0)} ads → ${join(dir, 'ads.md')}`);
} finally { await browser.close(); }
