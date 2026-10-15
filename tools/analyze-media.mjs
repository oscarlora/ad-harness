#!/usr/bin/env node
// analyze-media.mjs — describe each cataloged file with ANALYSIS_MODEL (products, people, OCR, tags,
// speech), fill its record, and rename the original to <id>_<descriptor>.<ext>.
// Image: one picture call. Video: a picture call on a silent proxy and a sound call on its track, in
// parallel. Audio: one sound call. Reads inputs/products.json and _catalog/people.json.
import { existsSync, renameSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogPaths, readRecords, readRecord, mergeRecord, readRoster, parseArgs, mediaDirFrom, inferBrand, slugify, ffprobeJson, round, usage } from './lib/catalog.mjs';
import { videoPass, videoMeta, workDir, heavy } from './lib/media-probe.mjs';
import { requireKeys, filePart, generateJSON, spendText, ANALYSIS_MODEL } from './lib/analyze.mjs';
import { buildPrompt, buildSchema } from './lib/analysis-prompt.mjs';
import { audioTrack, transcribeAudio, toTranscript, vocabulary } from './lib/transcribe.mjs';

const HELP = `analyze-media.mjs — describe cataloged media with ${ANALYSIS_MODEL} on kie.ai and fill their records
(key: <WS>_KIE_API_KEY; optional fallback when kie fails: <WS>_AI_GATEWAY_API_KEY)

  node tools/analyze-media.mjs --media <media dir> [--ids 00001,00002 | --all] [--force] [--concurrency 4]
    --all    every record not analyzed yet
    --force  redo analyzed ones too`;

// The proxy the probe left in the work dir, else a fresh proxy-only pass.
async function pictureProxy(src, work) {
  const made = join(work, 'picture.mp4');
  if (existsSync(made)) return made;
  const { proxy } = await heavy(() => videoPass(src, videoMeta(src), { work }));
  if (!proxy) throw new Error('could not make a picture proxy under the inline limit (trim the clip into parts)');
  return proxy;
}

const joinSections = (sections) => sections.map((s) => `${s.label}: ${s.text}`).join('\n\n');

// The probe's cuts take the model's descriptions by index; without cuts, the model's own scenes.
function cleanScenes(scenes, duration) {
  const cl = (x) => round(Math.min(duration || Infinity, Math.max(0, +x || 0)), 1);
  return (scenes || []).map((s) => ({ ...s, start: cl(s.start), end: cl(s.end) })).filter((s) => s.end > s.start);
}
function mergeScenes(detected, got, duration) {
  if (detected.length) return detected.map((s, i) => ({ ...s, description: (got.find((g) => g.index === i) || got[i] || {}).description || s.description || '' }));
  return cleanScenes(got.map((g) => ({ start: g.start, end: g.end, description: g.description })), duration).sort((a, b) => a.start - b.start);
}

const soundOf = (track, snd) => (!track ? 'No audio track.' : track.silent ? 'Silent — no audible sound.' : snd.sound);

async function analyzeOne({ media, id, keys, roster, brand, vocab }) {
  const paths = catalogPaths(media);
  const rec = readRecord(paths, id);
  if (!rec) throw new Error(`no record ${id}`);
  const type = rec.file?.type;
  const original = join(media, rec.file.name);
  const temps = [];

  try {
    if (type !== 'image' && !existsSync(original)) throw new Error(`original missing: ${rec.file.name} (pull it with sync-brand --pull --originals)`);
    const duration = rec.file.duration ?? (type === 'image' ? null : +ffprobeJson(original).format?.duration || null);
    const patch = { id, status: 'cataloged' };
    let pic = null, snd = null, track = null, picModel = null;

    // Silent or missing tracks skip the sound call.
    const work = workDir(rec.sha256);
    if (type === 'video') temps.push(work);
    if (type !== 'image') { track = audioTrack(original, type === 'video' ? join(work, 'track.mp3') : null); if (track) temps.push(track.dir); }
    const sound = async (standalone) => { if (track && !track.silent) snd = await transcribeAudio(keys, track, { brand, vocab, standalone }); };

    if (type === 'image') {
      const proxy = join(paths.proxies, `${id}.jpg`);
      const part = existsSync(proxy) ? filePart(proxy, 'image/jpeg') : filePart(original, rec.file.mime);
      ({ out: pic, model: picModel } = await generateJSON(keys, { parts: [part, { text: buildPrompt('image', { brand, roster }) }], schema: buildSchema('image') }));
    } else if (type === 'video') {
      const detected = cleanScenes(rec.scenes, duration);
      const proxy = await pictureProxy(original, work);
      const picture = generateJSON(keys, { parts: [filePart(proxy, 'video/mp4'), { text: buildPrompt('video', { brand, scenes: detected, roster, duration }) }], schema: buildSchema('video') });
      [{ out: pic, model: picModel }] = await Promise.all([picture, sound(false)]);
      patch.scenes = mergeScenes(detected, pic.scenes || [], duration);
    } else {
      await sound(true);
    }
    if (pic?.unreadable) throw new Error('Gemini could not decode the file');
    // The model that actually answered (the Gateway fallback when kie failed).
    patch.analysis = { model: [...new Set([picModel, snd?.model].filter(Boolean))].join(' + ') || ANALYSIS_MODEL, at: new Date().toISOString() };

    if (pic) {
      Object.assign(patch, {
        products: pic.products || [], people: pic.people || [], unknown_people: pic.unknown_people || [],
        visual_description: type === 'video'
          ? patch.scenes.map((s) => `[${s.start}–${s.end}s] ${s.description}`).join('\n\n')
          : joinSections(pic.sections || []),
      });
    }
    if (type !== 'image') {
      patch.audio_description = soundOf(track, snd);
      // undefined drops a stale transcript when the file has no speech.
      patch.audio_transcript = (snd && toTranscript(snd, duration)) || undefined;
      patch.has_speech = !!patch.audio_transcript;
    }
    const tags = type === 'audio' ? snd?.tags || ['silence'] : pic.tags;
    patch.tags = [...new Set((tags || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean))];

    const descriptor = (type === 'audio' ? snd?.descriptor || 'silent audio' : pic.descriptor);
    const name = `${id}_${slugify(descriptor)}${extname(rec.file.name).toLowerCase()}`;
    if (name !== rec.file.name && existsSync(original) && !existsSync(join(media, name))) { renameSync(original, join(media, name)); patch.file = { name }; }

    mergeRecord(paths, patch);
    return { id, type, name: patch.file?.name || rec.file.name };
  } finally {
    for (const d of temps) rmSync(d, { recursive: true, force: true });
  }
}

const isAnalyzed = (r) => r.status === 'cataloged' && (r.visual_description || r.audio_description);

export async function analyzeMany({ media, ids, all, force, concurrency = 4 }) {
  const keys = requireKeys(media);
  const roster = readRoster(media);
  const vocab = vocabulary(media);
  const brand = inferBrand(media);
  const recs = readRecords(catalogPaths(media));
  const queue = (ids?.length ? recs.filter((r) => ids.includes(r.id)) : all ? recs : []).filter((r) => force || !isAnalyzed(r)).map((r) => r.id);
  const done = [], failed = [];
  let i = 0;
  const worker = async () => {
    while (i < queue.length) {
      const id = queue[i++];
      try { const r = await analyzeOne({ media, id, keys, roster, brand, vocab }); done.push(r); console.log(`analyzed ${id} → ${r.name}`); }
      catch (e) { failed.push({ id, error: e.message }); console.log(`FAILED ${id}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return { done, failed, queued: queue.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2), { flags: ['all', 'force'], help: HELP });
  if (!a.media || (!a.ids && !a.all)) usage(HELP);
  const res = await analyzeMany({ media: mediaDirFrom(a.media), ids: a.ids ? String(a.ids).split(',') : null, all: !!a.all, force: !!a.force, concurrency: a.concurrency ? +a.concurrency : 4 });
  console.log(`${res.done.length}/${res.queued} analyzed${res.failed.length ? `, ${res.failed.length} failed` : ''} · ${spendText()}`);
  if (res.failed.length) process.exit(1);
}
