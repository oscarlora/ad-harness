#!/usr/bin/env node
// embed-media.mjs — semantic vectors for the media catalog, into _catalog/vectors.json: one for each
// record's text, one per video scene, made locally (lib/embed.mjs). Run after analyze-media; only
// changed records are re-embedded, and all of them when the model changed.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { catalogPaths, readRecords, parseArgs, mediaDirFrom, sha256, usage } from './lib/catalog.mjs';
import { embed, docText, packVec, readVectors, EMBED_MODEL } from './lib/embed.mjs';

const HELP = `embed-media.mjs — semantic vectors for the media catalog (_catalog/vectors.json), made locally
with ${EMBED_MODEL} (no key; the model downloads once, ~210 MB)

  node tools/embed-media.mjs --media <media dir> [--force]
    --force  re-embed every record, not only changed ones`;

const titleOf = (r) => String(r.file?.name || r.id).replace(/^\d+_/, '').replace(/\.[^.]+$/, '').replace(/-/g, ' ');
function recordText(r) {
  return [
    r.products?.length && `Products: ${r.products.join(', ')}`,
    r.people?.length && `People: ${r.people.join(', ')}`,
    r.analysis,
    r.transcript?.text && `Transcript: ${r.transcript.text}`,
  ].filter(Boolean).join('\n').slice(0, 24000);
}

export async function embedAll({ media, force = false }) {
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
      vecs.push(...await embed(jobs.slice(n, n + 100).map((j) => j.text)));
      console.log(`embedded ${Math.min(n + 100, jobs.length)}/${jobs.length}`);
    }
    for (const r of todo) store.items[r.id] = { sig: sigOf(r), scenes: [] };
    jobs.forEach((j, n) => { if (j.i == null) store.items[j.id].text = packVec(vecs[n]); else store.items[j.id].scenes[j.i] = packVec(vecs[n]); });
  }
  writeFileSync(catalogPaths(media).vectors, JSON.stringify(store));
  return { embedded: todo.length, total: recs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2), { flags: ['force'], help: HELP });
  if (!a.media) usage(HELP);
  const res = await embedAll({ media: mediaDirFrom(a.media), force: !!a.force });
  console.log(`${res.embedded} embedded · ${res.total} cataloged`);
}
