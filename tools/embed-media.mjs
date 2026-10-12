#!/usr/bin/env node
// embed-media.mjs — semantic vectors for the media catalog, into _catalog/vectors.json: one for each
// record's text, one per video scene. Run after analyze-media; only changed records are re-embedded.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogPaths, readRecords, parseArgs, mediaDirFrom, sha256, usage } from './lib/catalog.mjs';
import { requireKey, embed, docText, packVec, EMBED_MODEL } from './lib/gateway.mjs';

const HELP = `embed-media.mjs — semantic vectors for the media catalog (_catalog/vectors.json)

  node tools/embed-media.mjs --media <media dir> [--force]
    --force  re-embed every record, not only changed ones`;

const vectorsPath = (media) => join(catalogPaths(media).catalog, 'vectors.json');
export function readVectors(media) {
  const p = vectorsPath(media);
  if (!existsSync(p)) return null;
  try { const v = JSON.parse(readFileSync(p, 'utf8')); return v.model === EMBED_MODEL ? v : null; } catch { return null; }
}

const titleOf = (r) => String(r.file?.name || r.id).replace(/^\d+_/, '').replace(/\.[^.]+$/, '').replace(/-/g, ' ');
function recordText(r) {
  return [
    r.products?.length && `Products: ${r.products.join(', ')}`,
    r.people?.length && `People: ${r.people.join(', ')}`,
    r.tags?.length && `Tags: ${r.tags.join(', ')}`,
    r.visual_description,
    r.audio_description,
    r.audio_transcript?.text && `Transcript: ${r.audio_transcript.text}`,
  ].filter(Boolean).join('\n').slice(0, 24000);
}

export async function embedAll({ media, force = false }) {
  const key = requireKey(media);
  const store = (!force && readVectors(media)) || { model: EMBED_MODEL, items: {} };
  const recs = readRecords(catalogPaths(media)).filter((r) => r.status === 'cataloged');
  const sigOf = (r) => sha256(JSON.stringify([recordText(r), (r.scenes || []).map((s) => s.description)]));
  const todo = recs.filter((r) => store.items[r.id]?.sig !== sigOf(r));
  const live = new Set(recs.map((r) => r.id));
  for (const id of Object.keys(store.items)) if (!live.has(id)) delete store.items[id];

  const jobs = [];
  for (const r of todo) {
    jobs.push({ id: r.id, text: docText(titleOf(r), recordText(r)) });
    (r.scenes || []).forEach((s, i) => s.description && jobs.push({ id: r.id, i, text: docText(`${titleOf(r)} scene ${i + 1}`, s.description) }));
  }
  if (jobs.length) {
    const vecs = [];
    for (let n = 0; n < jobs.length; n += 100) {
      vecs.push(...await embed(key, jobs.slice(n, n + 100).map((j) => j.text)));
      console.log(`embedded ${Math.min(n + 100, jobs.length)}/${jobs.length}`);
    }
    for (const r of todo) store.items[r.id] = { sig: sigOf(r), scenes: [] };
    jobs.forEach((j, n) => { if (j.i == null) store.items[j.id].text = packVec(vecs[n]); else store.items[j.id].scenes[j.i] = packVec(vecs[n]); });
  }
  writeFileSync(vectorsPath(media), JSON.stringify(store));
  return { embedded: todo.length, total: recs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2), { flags: ['force'], help: HELP });
  if (!a.media) usage(HELP);
  const res = await embedAll({ media: mediaDirFrom(a.media), force: !!a.force });
  console.log(`${res.embedded} embedded · ${res.total} cataloged`);
}
