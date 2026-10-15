#!/usr/bin/env node
// transcribe-media.mjs — any audio/video clip -> transcript JSON (lib/transcribe.mjs).
// A library item reuses its catalog transcript. Word timings run locally (whisper.cpp). Without a kie
// key for a transcript it exits 3 (SKIP).

import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { typeOf, inferWorkspace, inferBrand, brandDirFrom, mediaDirFrom, catalogPaths, readRecords, parseArgs, die, usage, REPO_ROOT } from './lib/catalog.mjs';
import { analysisKeys, spend, spendText, ANALYSIS_MODEL } from './lib/analyze.mjs';
import { audioTrack, transcribeAudio, toTranscript, vocabulary, alignWords } from './lib/transcribe.mjs';

const HELP = `transcribe-media.mjs — audio/video clip -> transcript JSON

  node tools/transcribe-media.mjs --in <clip> [--out <json>] [--words] [--workspace <WS>]

Required:
  --in <path>              Audio or video file to transcribe

Optional:
  --out <path>             Output JSON (default: alongside the input as <name>.transcript.json)
  --words                  Add word timings (for captions and cuts), from local Whisper
  --workspace <WS>         Workspace whose kie key to use when the input isn't under workspaces/<WS>/

Transcripts: Gemini on kie.ai (<WS>_KIE_API_KEY; optional fallback when kie fails: <WS>_AI_GATEWAY_API_KEY).

Output: { model, language, has_speech, text, sound?, segments:[{start,end,speaker,text}],
          words?:[{start,end,word,speaker}], words_model? }`;

function libraryRecord(input) {
  if (!/[\\/]inputs[\\/]media[\\/]/.test(input)) return null;
  return readRecords(catalogPaths(mediaDirFrom(input))).find((r) => r.file?.name === basename(input)) || null;
}

async function main() {
  const a = parseArgs(process.argv.slice(2), { flags: ['words'], help: HELP });
  if (!a.in) usage(HELP);

  const input = resolve(String(a.in));
  if (!existsSync(input)) die(`input not found: ${input}`);
  const kind = typeOf(input);
  if (kind !== 'audio' && kind !== 'video') die(`not an audio/video file: ${input}`);
  const out = a.out ? resolve(String(a.out)) : input.replace(/\.[^./]+$/, '') + '.transcript.json';

  const ws = a.workspace ? String(a.workspace) : inferWorkspace(input);
  const keys = analysisKeys(a.workspace ? join(REPO_ROOT, 'workspaces', ws, '_') : input);
  const media = join(brandDirFrom(input), 'inputs', 'media');

  let result;
  const rec = libraryRecord(input);
  if (rec?.audio_transcript?.segments?.length) {
    console.error(`transcript from catalog record ${rec.id}`);
    const t = rec.audio_transcript;
    result = { model: t.model || rec.analysis?.model || '', has_speech: true, ...t, sound: rec.audio_description };
  } else {
    if (!keys.kie) { console.error(`SKIP: no kie key — add ${(ws || '<WS>').toUpperCase()}_KIE_API_KEY to .env (or pass --workspace)`); process.exit(3); }
    const track = audioTrack(input);
    try {
      if (!track || track.silent) result = { model: ANALYSIS_MODEL, language: '', has_speech: false, text: '', sound: track ? 'Silent — no audible sound.' : 'No audio track.', segments: [] };
      else {
        const snd = await transcribeAudio(keys, track, { brand: inferBrand(input), vocab: vocabulary(media) });
        const t = toTranscript(snd, track.duration) || { language: snd.language || '', text: '', segments: [], model: snd.model };
        result = { ...t, has_speech: !!t.segments.length, sound: snd.sound };
      }
    } finally { if (track) rmSync(track.dir, { recursive: true, force: true }); }
  }

  if (a.words) {
    if (!result.segments.length) result = { ...result, words: [], words_model: null };
    else result = await alignWords({ file: input, transcript: result });
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  console.error(`segments  ${result.segments.length}${result.words ? `  words ${result.words.length} (${result.words_model || 'none'})` : ''}  [${result.language || '—'}]${spend.credits || spend.usd ? `  ${spendText()}` : ''}`);
  console.log('Saved: ' + out);
}

main().catch((e) => die(e?.stack || String(e)));
