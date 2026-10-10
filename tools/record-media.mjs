#!/usr/bin/env node
// record-media.mjs — the per-file catalog records system: owns the media record schema and builds
// the catalog index. Zero dependencies. Mirror of record-ad.mjs for the media library.
//
// Each media file is one record at  <brand>/inputs/media/_catalog/json/<id>.json  — the single
// source of truth for that asset. lib/media-probe.mjs writes the technical fields; analyze-media.mjs
// (Gemini) fills the descriptions, products / people / tags; embed-media.mjs writes its vectors.
//
// Record schema (image shown; video/audio add scenes, audio_transcript, sprites):
//   {
//     "id": "00042", "sha256": "<hex>",
//     "file": { "name","type":"image|video|audio","mime","bytes","width","height",
//               "orientation","aspect","duration","original" },   // original = the file name it came in as
//     "source": { "type":"brand|generated|external", "name":"" },
//     "products": [], "people": [], "unknown_people": [{ "ref","description","note" }],
//     "tags": [], "visual_description": "", "audio_description": "", "text_in_media": "",
//     "has_speech": false, "analysis": { "model","at" },
//     "scenes": [{ "start","end","keyframe","description" }],
//     "audio_transcript": { "language","text","segments":[{start,end,speaker,text}],"model" },
//                                      // sentence-level, speakers S1, S2…
//     "sprites": { "sheet","cols","rows","interval","frameW","frameH" },
//     "phash": "<hex>" | { "duration", "frames":[{t,h}] },  // near-duplicate fingerprint (lib/media-probe)
//     "generation": { ... },           // only when source.type = generated
//     "status": "probed|cataloged", "ingestedAt": "<iso>"
//   }
//
// Usage:
//   node tools/record-media.mjs --index <media dir|_catalog dir>          rebuild _catalog/index.md
//   node tools/record-media.mjs --media <media dir> --merge <patch.json>  merge a patch (must have id) into a record
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogPaths, ensureDirs, readRecords, parseArgs } from './lib/catalog.mjs';

export const recordPath = (paths, id) => join(paths.json, `${id}.json`);
export function readRecord(paths, id) {
  const p = recordPath(paths, id);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
export function writeRecord(paths, rec) {
  if (!rec.id) throw new Error('record needs an id');
  ensureDirs(paths);
  writeFileSync(recordPath(paths, rec.id), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

// Merge a patch into an existing record (shallow at top level; file/source/sprites/generation
// merged one level deep; a transcript is replaced whole, and a key set to undefined drops it).
// Stamps status=cataloged once a visual_description or transcript exists.
export function mergeRecord(paths, patch) {
  const id = patch.id;
  if (!id) throw new Error('patch needs an id');
  const cur = readRecord(paths, id) || { id };
  const merged = { ...cur, ...patch };
  for (const k of ['file', 'source', 'sprites', 'generation']) {
    if (cur[k] && patch[k] && typeof cur[k] === 'object' && !Array.isArray(cur[k])) merged[k] = { ...cur[k], ...patch[k] };
  }
  const analyzed = merged.visual_description || merged.audio_description || merged.audio_transcript?.text;
  if (analyzed && merged.status === 'probed') merged.status = 'cataloged';
  return writeRecord(paths, merged);
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const clip = (s, n) => { const t = esc(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const dur = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

export function buildIndex(paths) {
  const recs = readRecords(paths).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const cols = ['ID', 'Type', 'Orientation', 'Source', 'Products', 'People', 'Length', 'Description'];
  const rows = recs.map((r) => [
    r.id, r.file?.type, r.file?.orientation || '', r.source?.type,
    (r.products || []).join(', '), [...(r.people || []), ...(r.unknown_people || []).map(() => '?')].join(', '),
    dur(r.file?.duration), clip(r.visual_description || r.audio_description || r.audio_transcript?.text || '', 70),
  ].map(esc));
  const md = [
    '# Media catalog index', '',
    `${recs.length} asset${recs.length === 1 ? '' : 's'}. Generated from \`_catalog/json/*.json\` — do not edit by hand.`,
    '', '| ' + cols.join(' | ') + ' |', '|' + cols.map(() => '---').join('|') + '|',
    ...rows.map((r) => '| ' + r.join(' | ') + ' |'), '',
  ].join('\n');
  writeFileSync(paths.index, md);
  return recs.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.index) {
    const dir = args.index === true ? args._[0] : args.index;
    if (!dir) { console.error('Usage: node tools/record-media.mjs --index <media dir>'); process.exit(1); }
    const n = buildIndex(catalogPaths(dir));
    console.log(`wrote ${catalogPaths(dir).index} (${n} assets)`);
  } else if (args.media && args.merge) {
    const rec = mergeRecord(catalogPaths(args.media), JSON.parse(readFileSync(args.merge, 'utf8')));
    console.log(`merged ${rec.id} (status=${rec.status})`);
  } else {
    console.error('Usage:\n  --index <media dir>\n  --media <media dir> --merge <patch.json>');
    process.exit(1);
  }
}
