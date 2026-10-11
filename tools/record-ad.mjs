#!/usr/bin/env node
// record-ad.mjs — owns the ad record schema and builds the ads index.
// One record per ad at <Brand>/outputs/json/<id>.json. The agent writes the creative fields;
// generate-image.mjs --record stamps the generation.
//
//   {
//     "id": 41,
//     "status": "planned | generated | approved | synced",
//     "concept":   { "product": "", "persona": "", "angle": "", "format": "" },
//     "copy":      { "hook": "", "subline-top": "", "pill-1": "" },   // named slots per the format
//     "design":    "treatment notes",
//     "meta":      { "headline": "", "primary_text": "" },            // Meta in-platform copy (write-meta-copy)
//     "generation": {
//       "model": "gpt-image-2.5", "resolution": "2K", "aspect": "4:5", "size": "native",
//       "prompt": "the exact prompt", "refs": ["inputs/media/.../x.png"],
//       "output": "workspaces/<WS>/Acme/outputs/41_..._.png",      // the generator's --out as stamped:
//       "outputs": ["workspaces/<WS>/Acme/outputs/41_..._.png"],   //   repo-relative, or absolute
//       "generatedAt": "<iso>"
//     }
//   }
//
// Usage:
//   node tools/record-ad.mjs --index <brand outputs/ dir>   rebuild outputs/index.md from json/*.json
//
// --index also strips metadata (lib/clean-image.mjs) from the images of approved and synced ads.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cleanImage } from './lib/clean-image.mjs';
import { REPO_ROOT, parseArgs } from './lib/catalog.mjs';

const args = parseArgs(process.argv.slice(2), { flags: ['index'] });
const INDEX = !!args.index;
const dir = args._[0];
if (!INDEX || !dir) { console.error('Usage: node tools/record-ad.mjs --index <brand outputs/ dir>'); process.exit(1); }

const outputs = resolve(dir.replace(/\/(json|index\.md)\/?$/, ''));
const jsonDir = join(outputs, 'json');
if (!existsSync(jsonDir)) { console.error('no json/ dir at ' + jsonDir); process.exit(1); }

const recs = readdirSync(jsonDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => { try { return JSON.parse(readFileSync(join(jsonDir, f), 'utf8')); } catch { return null; } })
  .filter(Boolean)
  .sort((a, b) => (a.id || 0) - (b.id || 0));

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const cols = ['ID', 'Status', 'Product', 'Persona', 'Angle', 'Format', 'Hook', 'Output'];
const rows = recs.map((r) => [
  r.id, r.status, r.concept?.product, r.concept?.persona, r.concept?.angle, r.concept?.format,
  r.copy?.hook, r.generation?.output,
].map(esc));

const md = [
  '# Ads index',
  '',
  `${recs.length} ad${recs.length === 1 ? '' : 's'}. Generated from \`outputs/json/*.json\` — do not edit by hand.`,
  '',
  '| ' + cols.join(' | ') + ' |',
  '|' + cols.map(() => '---').join('|') + '|',
  ...rows.map((r) => '| ' + r.join(' | ') + ' |'),
  '',
].join('\n');

writeFileSync(join(outputs, 'index.md'), md);
console.log(`wrote ${join(outputs, 'index.md')} (${recs.length} ads)`);

// Output paths are repo-relative or absolute, as the generator stamped them.
const locate = (p) => { const abs = resolve(REPO_ROOT, p); return existsSync(abs) ? abs : null; };
let cleaned = 0;
for (const r of recs.filter((x) => ['approved', 'synced'].includes(x.status))) {
  for (const out of new Set([r.generation?.output, ...(r.generation?.outputs || [])].filter(Boolean))) {
    const file = locate(out);
    if (!file) continue;
    const before = readFileSync(file);
    const after = cleanImage(before);
    if (after.length !== before.length) { writeFileSync(file, after); cleaned++; }
  }
}
if (cleaned) console.log(`stripped metadata from ${cleaned} approved image${cleaned === 1 ? '' : 's'}`);
