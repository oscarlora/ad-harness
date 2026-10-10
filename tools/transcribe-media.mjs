#!/usr/bin/env node
// transcribe-media.mjs — any audio/video clip -> transcript JSON (no catalog needed). Engines live in
// lib/transcribe.mjs (shared with analyze-media.mjs).
//
//   default  sentence-level transcript: Gemini 3.1 Flash Lite via the Vercel AI Gateway (language,
//            speakers S1, S2…, brand vocabulary hinted) — the text truth.
//   --words  + word timings for captions and cuts: gemini-3.5-transcribe word timestamps via the
//            Gateway, mapped onto that text and snapped to the speech energy.
// A clip that is already a library item (inside a brand's inputs/media/) reuses its catalog
// transcript instead of a new call. Key: <WS>_AI_GATEWAY_API_KEY, the workspace from the input's
// workspaces/<WS>/ path (or --workspace); without one it exits 3 (SKIP).
//
// Output JSON (written to --out, default <input dir>/<input name>.transcript.json):
//   { model, language, has_speech, text, sound?, segments:[{start,end,speaker,text}],
//     words?:[{start,end,word,speaker}], words_model? }
//
// Usage:
//   node tools/transcribe-media.mjs --in <audio/video> [--out <json>] [--words] [--workspace <WS>]

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { typeOf, inferWorkspace, inferBrand, brandDirFrom, mediaDirFrom, catalogPaths, readRecords, parseArgs, die } from './lib/catalog.mjs';
import { gatewayKey, spend, ANALYSIS_MODEL } from './lib/gateway.mjs';
import { audioTrack, transcribeAudio, toTranscript, vocabulary, alignWords } from './lib/transcribe.mjs';

const HELP = `transcribe-media.mjs — audio/video clip -> transcript JSON

Required:
  --in <path>              Audio or video file to transcribe

Optional:
  --out <path>             Output JSON (default: alongside the input as <name>.transcript.json)
  --words                  Add word timings (for captions and cuts)
  --workspace <WS>         Workspace whose Gateway key to use when the input isn't under workspaces/<WS>/

Output: { model, language, has_speech, text, sound?, segments:[{start,end,speaker,text}],
          words?:[{start,end,word,speaker}], words_model? }`;

// A library item's catalog record (by file name in its brand's inputs/media), or null.
function libraryRecord(input) {
  if (!/[\\/]inputs[\\/]media[\\/]/.test(input)) return null;
  return readRecords(catalogPaths(mediaDirFrom(input))).find((r) => r.file?.name === basename(input)) || null;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.in) { console.log(HELP); process.exit(a.help ? 0 : 1); }

  const input = resolve(String(a.in));
  if (!existsSync(input)) die(`input not found: ${input}`);
  const kind = typeOf(input);
  if (kind !== 'audio' && kind !== 'video') die(`not an audio/video file: ${input}`);
  const out = a.out ? resolve(String(a.out)) : input.replace(/\.[^./]+$/, '') + '.transcript.json';

  const ws = a.workspace ? String(a.workspace) : inferWorkspace(input);
  const key = gatewayKey(a.workspace ? join(resolve('workspaces'), ws, '_') : input);
  const media = join(brandDirFrom(input), 'inputs', 'media');

  let result;
  const rec = libraryRecord(input);
  if (rec?.audio_transcript?.segments?.length) {
    console.error(`transcript from catalog record ${rec.id}`);
    const t = rec.audio_transcript;
    result = { model: t.model || rec.analysis?.model || '', has_speech: true, ...t, sound: rec.audio_description };
  } else {
    if (!key) { console.error(`SKIP: no AI Gateway key — add ${(ws || '<WS>').toUpperCase()}_AI_GATEWAY_API_KEY to .env (or pass --workspace)`); process.exit(3); }
    const track = audioTrack(input);
    try {
      if (!track || track.silent) result = { model: ANALYSIS_MODEL, language: '', has_speech: false, text: '', sound: track ? 'Silent — no audible sound.' : 'No audio track.', segments: [] };
      else {
        const snd = await transcribeAudio(key, track, { brand: inferBrand(input), vocab: vocabulary(media) });
        const t = toTranscript(snd, track.duration) || { language: snd.language || '', text: '', segments: [], model: ANALYSIS_MODEL };
        result = { ...t, has_speech: !!t.segments.length, sound: snd.sound };
      }
    } finally { if (track) rmSync(track.dir, { recursive: true, force: true }); }
  }

  if (a.words) {
    if (!result.segments.length) result = { ...result, words: [], words_model: null };
    else if (!key) { console.error(`SKIP: no AI Gateway key for word timings — add ${(ws || '<WS>').toUpperCase()}_AI_GATEWAY_API_KEY to .env (or pass --workspace)`); process.exit(3); }
    else result = await alignWords({ file: input, transcript: result, key });
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.error(`segments  ${result.segments.length}${result.words ? `  words ${result.words.length} (${result.words_model || 'none'})` : ''}  [${result.language || '—'}]${spend.usd ? `  $${spend.usd.toFixed(4)}` : ''}`);
  console.log('Saved: ' + out);
}

main().catch((e) => die(e?.stack || String(e)));
