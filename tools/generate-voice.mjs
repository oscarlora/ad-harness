#!/usr/bin/env node
// generate-voice.mjs — generate voiceovers. Two model families, providers tried in PROVIDER_ORDER
// (tools/lib/providers.mjs MODELS + planRoute):
//   - gemini-3.8-flash-tts (default): Gemini 3.8 Flash TTS on Segmind, kie.ai, then the Vercel AI
//     Gateway. One or two speakers (the Gateway: one). Also any raw Gateway speech id
//     (e.g. fish-audio/s2.1-pro), Gateway only.
//   - seed-audio: ByteDance Seed Audio 1.0 on Segmind; on kie the same cast runs on ElevenLabs Text
//     to Dialogue v3 (--model elevenlabs/<id> picks that kie model directly). The path for raw scene
//     prompts (--prompt, music/SFX), 3+ speakers, [DIRECTIVE] lines, and voice clones.
// Without --model, a raw --prompt, a script with 3+ speakers, or [DIRECTIVE] lines switch to
// seed-audio automatically (with a note); everything else runs Gemini TTS. Node 22+; the AI SDK
// loads only when the Gateway runs.
//
// Gemini TTS mapping: the script's spoken lines become the text; each speaker's voice is its
// voices-file `voice_name`, else --voice-name (comma list in speaker order), else Kore / Puck; the
// speakers' voices-file `description`s become the delivery direction (Segmind `style`, kie
// `audio_profile`, Gateway `instructions`). Seed Audio / ElevenLabs-only features — reference_audio
// clones, [DIRECTIVE] lines, --target-length, --image and the Seed Audio tuning flags — are ignored
// there with a warning. Output is converted to --format with ffmpeg.
//
// Segmind Seed Audio and kie ElevenLabs work in fundamentally different ways, which is why a
// --voices-file exists:
//   - kie/ElevenLabs is picked, not designed: input.dialogue is an ordered array of turns, each
//     { text, voice_id }, where voice_id is a specific, pre-auditioned ElevenLabs voice.
//   - Segmind/Seed Audio is designed, not picked: one text_prompt (spoken text, character
//     descriptions, and/or a scene description — dialogue+music+SFX in one call), with up to 3
//     reference-audio clips for voice-cloning, cited inline as @Audio1/@Audio2/@Audio3.
// A --voices-file defines each character ONCE with both facets (a Segmind description and an
// ElevenLabs voice_id), so whichever provider actually runs — primary or fallback — has what it
// needs. This mapping (and the prompt-driven design/length steering below) is best-effort — Seed
// Audio's docs don't show a worked multi-speaker example — verify by ear, not just by file shape.
//
// Voice design: specify age/persona, register, timbre, pace, intonation, energy, target-market
// accent, and one or two natural quirks. Keep delivery direction separate from the verbatim
// script. Seed Audio is prompt-limited, so compress directions before touching spoken copy.
// Put difficult brand/product pronunciations directly into the spoken script phonetically.
//
// "What happens when": the script file is an ordered timeline, not just dialogue. Alongside
// "LABEL: text" turns, a line like "[MUSIC: soft guitar swells in]" is a directive — folded into
// Seed Audio's prompt as scene direction, dropped (with a warning) on ElevenLabs and Gemini TTS.
//
// --target-length steers Seed Audio's pacing via a plain-language instruction woven into the
// prompt (validated live: asking for "about 15 seconds" landed within 0.3% of the target). kie
// has no duration lever at all — the flag is a no-op there, and a warning says so.
//
// Flow: parse a script file (or raw prompt) -> build the request -> create task -> poll -> download.
//
// Usage (single narrator, Gemini TTS):
//   node tools/generate-voice.mjs \
//     --script-file workspaces/<WS>/Acme/outputs/prompts/acme-vo.txt --voice-name Kore \
//     --out workspaces/<WS>/Acme/outputs/acme-vo-A.mp3
// Usage (Seed Audio: a full character + timeline design):
//   node tools/generate-voice.mjs --model seed-audio \
//     --script-file workspaces/<WS>/Acme/outputs/prompts/acme-podcast-vo.txt \
//     --voices-file workspaces/<WS>/Acme/outputs/prompts/acme-voices.txt \
//     --target-length 30 \
//     --out workspaces/<WS>/Acme/outputs/acme-podcast-vo-A.mp3
// Usage (force kie/ElevenLabs explicitly, e.g. for a specific known-good voice):
//   node tools/generate-voice.mjs --provider kie \
//     --script-file workspaces/<WS>/Acme/outputs/prompts/acme-podcast-vo.txt \
//     --voices-file workspaces/<WS>/Acme/outputs/prompts/acme-voices.txt \
//     --out workspaces/<WS>/Acme/outputs/acme-podcast-vo-A.mp3
//
// --voices-file format — one [LABEL] block per character:
//   [HOST]
//   description: A 50-year-old American woman, warm and slightly husky, unhurried, conversational.
//   voice_name: Kore   (optional — Gemini TTS prebuilt voice)
//   elevenlabs_voice_id: q2QIwJIbSmfKmouF78XA
//   reference_audio: (optional — a URL or local path to clone instead of/alongside the description)
//
// Script file: one line per event, in order — "LABEL: text" (dialogue) or "[KEYWORD: content]"
// (directive: music/SFX/pause/tone — Segmind only). Blank lines and #-comments are ignored.
//
// Defaults: --provider auto  --model gemini-3.8-flash-tts (seed-audio for scene prompts / 3+ speakers /
//   directives)  --stability 0.5 (ElevenLabs)  --language en (ElevenLabs; Gateway: auto-detect)
//   --format mp3  --sample-rate 44100 (Seed Audio)  --num 1
//
// Auth: per-workspace <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY /
//   <WORKSPACE>_AI_GATEWAY_API_KEY, inferred from --out, in env or a .env at project root.
//   Local-file refs (reference_audio, --image) go to Segmind as signed R2 URLs,
//   so they must live under the brand folder (workspace R2 credentials); http(s) URLs pass through.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyEnv, die, parseArgs } from './lib/catalog.mjs';
import {
  MODELS, PROVIDER_ORDER, errorText, gatewayClient, kieJob, logGatewayWarnings, modelEntry, planRoute, presignRef, runRoute,
  saveResults, segmindJob, userError, workspaceKeys,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-voice.mjs — voiceover generator: Gemini 3.8 Flash TTS (default) or Seed Audio 1.0.
Providers in order: ${PROVIDER_ORDER.join(' -> ')} (routing: tools/lib/providers.mjs)

Required (one of):
  --script-file <path>     Timeline file; "LABEL: text" dialogue and "[KEYWORD: content]"
                           directive lines, in order (see the file banner for the full format).
  --prompt "<text>"        Seed Audio only (Segmind): a raw scene-description prompt.
  --prompt-file <path>     Seed Audio only: same, read from a file.
  --out <path>             Output audio path (e.g. workspaces/<WS>/Acme/outputs/vo.mp3)

Optional:
  --model <name>           gemini-3.8-flash-tts (default) | seed-audio | elevenlabs/<id> (kie only,
                           e.g. elevenlabs/text-to-dialogue-v3) | any raw Gateway speech id (e.g.
                           fish-audio/s2.1-pro; Gateway only).
                           Without --model: a raw --prompt, 3+ speakers, or [DIRECTIVE] lines use
                           seed-audio (a note says so); anything else uses Gemini TTS.
                           gemini-3.8-flash-tts: 1-2 speakers on Segmind/kie, 1 on the Gateway.
                           seed-audio: Segmind Seed Audio 1.0; on kie the same cast runs on
                           ElevenLabs Text to Dialogue v3 (needs elevenlabs_voice_id per label).
  --provider <name>        auto (default) | segmind | kie | gateway   (vercel = gateway). auto = every
                           provider that carries the model, has its <WS>_ key and can take the
                           request, in the order above. Fails over only on a rejection before
                           generating (bad request, outage, out of credits) — never after submit.
  --voices-file <path>     Defines each character once for every model — see the file banner for
                           the [LABEL] block format (description, voice_name, elevenlabs_voice_id,
                           reference_audio).
  --format <ext>           mp3 (default) | wav (all) | pcm | ogg_opus (Seed Audio only)

Gemini TTS:
  --voice-name <name[,name]> Prebuilt voice per speaker, in speaker order (e.g. Kore or Kore,Puck;
                           30 voices: Kore, Puck, Charon, Zephyr, Fenrir, Leda, Aoede, ...). A
                           voices-file voice_name wins. Default: Kore, then Puck. (On a raw Gateway
                           id such as fish-audio/..., that model's voice id.)
  --language <code>        Gateway only: ISO 639-1 code (default: auto-detect).

Seed Audio (Segmind):
  --target-length <secs>   Asks Seed Audio to pace the read to roughly this length (a prompt
                           instruction, not a hard guarantee — verify by ear that it didn't
                           shorten by cutting content rather than just speaking faster).
  --image <path|url>       Single mood/delivery reference image (mutually exclusive with clone
                           refs at the Seed Audio API level — don't combine them)
  --sample-rate <hz>       44100 (default) | 8000 | 16000 | 24000 | 32000 | 48000
  --speaker <name>         Named voice preset (only "en_female_stokie_uranus_bigtts" exists today)
  --pitch-rate <n>         -12..12 semitones
  --loudness-rate <n>      -50..100
  --speech-rate <n>        -50..100

ElevenLabs (kie):
  --stability <n>          0 (Creative) | 0.5 (Natural, default) | 1 (Robust)
  --language <code>        en (default) | auto | ...

  --num <n>                Number of variations (default 1)
  --timeout <seconds>      Max wait per task (default 600)

Voice design for Seed Audio:
  Describe age/persona, register, timbre, pace, intonation, energy, accent, and natural quirks.
  Keep voice, delivery, and verbatim script distinct. Write phonetic pronunciations directly in
  the spoken script. If the prompt exceeds 2048 characters, shorten directions — never the copy.

Env: <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY / <WORKSPACE>_AI_GATEWAY_API_KEY,
     inferred from --out.`;

// Parse a --voices-file: one [LABEL] block per character, each with description/
// elevenlabs_voice_id/reference_audio key:value lines. Defines a character once for BOTH
// providers — the Segmind description (composed into text_prompt) and the ElevenLabs voice_id
// (used on kie, whether picked explicitly or reached as the auto-mode fallback).
function parseVoicesFile(text) {
  const profiles = {};
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[([^:\]]+)\]$/);
    if (header) { current = header[1].trim().toUpperCase(); profiles[current] = {}; continue; }
    if (!current) die(`voices-file line outside any [LABEL] block: ${line}`);
    const kv = line.match(/^([a-z_]+)\s*:\s*(.+)$/i);
    if (!kv) die(`voices-file line is not "key: value" or "[LABEL]": ${line}`);
    const key = kv[1].trim().toLowerCase();
    if (key === 'description') profiles[current].description = kv[2].trim();
    else if (key === 'elevenlabs_voice_id') profiles[current].elevenlabsVoiceId = kv[2].trim();
    else if (key === 'reference_audio') profiles[current].referenceAudio = kv[2].trim();
    else if (key === 'voice_name') profiles[current].voiceName = kv[2].trim();
    else die(`voices-file: unknown key "${key}" (expected description / voice_name / elevenlabs_voice_id / reference_audio)`);
  }
  if (!Object.keys(profiles).length) die('voices-file produced no [LABEL] profiles');
  return profiles;
}

// Parse the script file into an ordered timeline — "what happens when." Dialogue: "LABEL: text".
// Directives (music/SFX/pause/tone cues, Segmind-only): "[KEYWORD: content]" on its own line.
// Blank lines and #-comments are skipped.
function parseScript(scriptText) {
  const items = [];
  for (const raw of scriptText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const directive = line.match(/^\[([^:\]]+):\s*(.+)\]$/);
    if (directive) { items.push({ type: 'directive', keyword: directive[1].trim().toUpperCase(), content: directive[2].trim() }); continue; }
    const turn = line.match(/^([^:]+):\s*(.+)$/);
    if (!turn) die(`script line is not "LABEL: text" or "[KEYWORD: content]": ${line}`);
    items.push({ type: 'turn', label: turn[1].trim().toUpperCase(), text: turn[2].trim() });
  }
  if (!items.length) die('script produced no dialogue turns or directives');
  return items;
}

// kie.ai (ElevenLabs) dialogue array: every turn's label must map to a real voice_id. Directive
// lines have no kie equivalent and are dropped — warn so it's not silently different from Segmind.
function buildDialogue(items, kieVoiceMap) {
  const directives = items.filter((i) => i.type === 'directive');
  if (directives.length) {
    console.error(`WARN: kie has no equivalent for ${directives.length} directive line(s) — dropped: ${directives.map((d) => `[${d.keyword}]`).join(', ')}`);
  }
  return items.filter((i) => i.type === 'turn').map(({ label, text }) => {
    const voice_id = kieVoiceMap[label];
    if (!voice_id) die(`no voice_id for label "${label}" (have: ${Object.keys(kieVoiceMap).join(', ') || 'none'}) — add elevenlabs_voice_id to --voices-file's [${label}] block`);
    return { text, voice_id };
  });
}

const targetLengthInstruction = (n) =>
  `Keep the total length to about ${n} seconds — adjust pacing accordingly without cutting or paraphrasing the dialogue.`;

// Segmind/Seed Audio: compose the parsed timeline into ONE text_prompt — Seed Audio has no
// discrete dialogue-turn array. Characters with a `description` are introduced once up top;
// characters with `reference_audio` (max 3 — Seed Audio's own cap) get cited inline as
// @Audio1/@Audio2/@Audio3, in the intro if they have one or else on each of their dialogue lines.
// The timeline below plays dialogue and directive ([MUSIC: ...] etc.) lines out in order.
// Best-effort — Seed Audio's docs don't show a worked multi-speaker example — verify by ear.
async function composeTextPrompt(items, characters, targetLength, host) {
  const referenceAudioUrls = [];
  const tagFor = {};
  for (const [label, char] of Object.entries(characters)) {
    if (!char.referenceAudio || referenceAudioUrls.length >= 3) continue;
    const value = char.referenceAudio;
    const isUrl = /^https?:\/\//i.test(value);
    if (!isUrl && !existsSync(resolve(value))) {
      die(`${label}'s reference_audio (${value}) isn't a URL or an existing local file`);
    }
    referenceAudioUrls.push(await host(value));
    tagFor[label] = `@Audio${referenceAudioUrls.length}`;
  }

  const intros = Object.entries(characters)
    .filter(([, c]) => c.description)
    .map(([label, c]) => `${label}${tagFor[label] ? ` (${tagFor[label]})` : ''} is ${c.description}`);

  const timeline = items.map((item) => {
    if (item.type === 'directive') return `[${item.keyword}: ${item.content}]`;
    const showTag = tagFor[item.label] && !characters[item.label]?.description; // else already shown in the intro
    return `${item.label}${showTag ? ` (${tagFor[item.label]})` : ''}: ${item.text}`;
  });

  const parts = [...intros, ...timeline];
  if (targetLength) parts.push(targetLengthInstruction(targetLength));
  return { text_prompt: parts.join('\n'), reference_audio_urls: referenceAudioUrls };
}

// Segmind request body for seed-audio-1.0.
function segmindVoiceInput({ textPrompt, format, sampleRate, referenceAudioUrls, imageUrl, speaker, pitchRate, loudnessRate, speechRate }) {
  const input = { text_prompt: textPrompt, format, sample_rate: sampleRate };
  if (referenceAudioUrls.length) input.reference_audio_urls = referenceAudioUrls;
  if (imageUrl) input.image_url = imageUrl;
  if (speaker) input.speaker = speaker;
  if (pitchRate !== undefined) input.pitch_rate = pitchRate;
  if (loudnessRate !== undefined) input.loudness_rate = loudnessRate;
  if (speechRate !== undefined) input.speech_rate = speechRate;
  return input;
}

// Gateway speech models return their own native format (Gemini TTS: WAV) and warn on an
// outputFormat they can't honor, so the call never asks; convert here with ffmpeg so --out and
// --format always mean what they say.
function transcode(audio, want) {
  const have = audio.format === 'mpeg' ? 'mp3' : audio.format;
  if (!have || have === want) return { bytes: audio.bytes, ext: have || 'mp3' };
  const args = ['-v', 'error', '-i', 'pipe:0', ...(want === 'mp3' ? ['-b:a', '192k'] : []), '-f', want, 'pipe:1'];
  const r = spawnSync('ffmpeg', args, { input: Buffer.from(audio.bytes), maxBuffer: 1 << 30 });
  if (r.error || r.status !== 0) {
    console.error(`WARN: could not convert ${have} to ${want} (${r.error?.message || r.stderr?.toString().trim()}) — saving ${have}.`);
    return { bytes: audio.bytes, ext: have };
  }
  return { bytes: r.stdout, ext: want };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPromptMode = !!(args.prompt || args['prompt-file']);
  if (args.help || (!args['script-file'] && !rawPromptMode)) { console.log(HELP); process.exit(args.help ? 0 : 1); }
  if (!args.out) die('--out is required');

  const provider = String(args.provider || 'auto').toLowerCase();
  if (rawPromptMode && provider === 'kie') {
    die("--prompt/--prompt-file only works with Segmind (kie's dialogue format has no raw-prompt equivalent) — drop --provider kie, or use --script-file instead");
  }

  const { W, keys } = workspaceKeys(args.out);

  const characters = args['voices-file']
    ? parseVoicesFile(await readFile(resolve(String(args['voices-file'])), 'utf8'))
    : {};
  const script = rawPromptMode ? null : parseScript(await readFile(resolve(String(args['script-file'])), 'utf8'));
  const host = (p) => presignRef(p, args.out);

  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  let targetLength;
  if (args['target-length'] !== undefined) {
    targetLength = parseInt(args['target-length'], 10);
    if (!Number.isFinite(targetLength) || targetLength <= 0) die(`--target-length must be a positive number of seconds, got: ${args['target-length']}`);
  }

  async function runSegmind() {
    let textPrompt, referenceAudioUrls = [];
    if (rawPromptMode) {
      textPrompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim() : String(args.prompt);
      if (!textPrompt) die('prompt is empty');
      if (targetLength) textPrompt += '\n\n' + targetLengthInstruction(targetLength);
    } else {
      ({ text_prompt: textPrompt, reference_audio_urls: referenceAudioUrls } = await composeTextPrompt(script, characters, targetLength, host));
    }
    if (textPrompt.length > 2048)
      die(`Seed Audio prompt is ${textPrompt.length} characters; maximum is 2048. Compress voice/delivery directions without changing the spoken script.`);
    const imageUrl = args.image ? await host(String(args.image)) : undefined;
    const input = segmindVoiceInput({
      textPrompt,
      format: String(args.format || 'mp3').toLowerCase(),
      sampleRate: parseInt(args['sample-rate'] || '44100', 10),
      referenceAudioUrls,
      imageUrl,
      speaker: args.speaker ? String(args.speaker) : undefined,
      pitchRate: args['pitch-rate'] !== undefined ? Number(args['pitch-rate']) : undefined,
      loudnessRate: args['loudness-rate'] !== undefined ? Number(args['loudness-rate']) : undefined,
      speechRate: args['speech-rate'] !== undefined ? Number(args['speech-rate']) : undefined,
    });
    console.error(`prompt    ${textPrompt.length} chars  refs: ${referenceAudioUrls.length}`);
    return Promise.all(Array.from({ length: num }, () => segmindJob(entry.segmind, input, timeout)));
  }

  async function runKie() {
    if (targetLength) console.error('WARN: --target-length has no effect on kie/ElevenLabs — ignored');
    const kieVoiceMap = {};
    for (const [label, c] of Object.entries(characters)) if (c.elevenlabsVoiceId) kieVoiceMap[label] = c.elevenlabsVoiceId;
    const dialogue = buildDialogue(script, kieVoiceMap);
    const stability = args.stability !== undefined ? Number(args.stability) : 0.5;
    if (![0, 0.5, 1].includes(stability)) die(`--stability must be 0, 0.5, or 1 (v3 requires a multiple of 0.5); got ${args.stability}`);
    const model = entry.kie;
    const input = { dialogue, stability, language_code: String(args.language || 'en') };
    console.error(`turns     ${dialogue.length}  voices: ${[...new Set(dialogue.map((i) => i.voice_id))].join(', ')}`);
    return (await Promise.all(Array.from({ length: num }, () => kieJob(model, input, timeout)))).flat();
  }

  // ---- model: Gemini TTS by default; Seed Audio when the job needs it (see the file banner) ----
  const turns = script ? script.filter((i) => i.type === 'turn') : [];
  const directives = script ? script.filter((i) => i.type === 'directive') : [];
  const speakers = [...new Set(turns.map((i) => i.label))];
  const modelArg = args.model ? String(args.model) : null;
  let entry;
  if (!modelArg) {
    const why = rawPromptMode ? 'a raw --prompt is a Seed Audio scene prompt'
      : speakers.length > 2 ? `${speakers.length} speakers (Gemini TTS takes at most 2)`
      : directives.length ? `${directives.length} [DIRECTIVE] line(s)` : null;
    if (why) console.error(`note      using Seed Audio 1.0: ${why}.`);
    entry = modelEntry(why ? 'seed-audio' : 'gemini-3.8-flash-tts');
  } else if (/^elevenlabs\//.test(modelArg)) entry = { name: modelArg, kind: 'speech', kie: modelArg };
  else entry = modelEntry(modelArg, 'speech');
  if (!entry || (MODELS[entry.name] && MODELS[entry.name].kind !== 'speech'))
    die(`unknown --model "${modelArg}" (gemini-3.8-flash-tts | seed-audio | elevenlabs/<id> | a raw Gateway speech id)`);
  const isCast = entry.name === 'seed-audio' || !!entry.name.match(/^elevenlabs\//); // Seed Audio / ElevenLabs family
  if (!isCast) {
    if (rawPromptMode) die('--prompt/--prompt-file is a Seed Audio scene prompt — drop --model or pass --model seed-audio.');
    if (!speakers.length) die('the script has no spoken lines');
    if (speakers.length > 2) die(`${entry.name} takes at most 2 speakers (got ${speakers.length}: ${speakers.join(', ')}) — pass --model seed-audio.`);
  }

  // ---- Gemini TTS (Segmind / kie / Gateway): voices, delivery direction, output format ----
  const voiceNames = String(args['voice-name'] || '').split(',').map((v) => v.trim()).filter(Boolean);
  const explicitVoice = (label, i) => characters[label]?.voiceName || voiceNames[i];
  const voiceOf = (label, i) => explicitVoice(label, i) || ['Kore', 'Puck'][i];
  const described = speakers.filter((l) => characters[l]?.description);
  const direction = speakers.length === 1 ? characters[speakers[0]]?.description
    : described.map((l) => `${l} (${voiceOf(l, speakers.indexOf(l))}): ${characters[l].description}`).join(' ') || undefined;
  let format = String(args.format || 'mp3').toLowerCase();
  function geminiPrelude(where) {
    const clones = speakers.filter((l) => characters[l]?.referenceAudio);
    const ignored = [
      directives.length && `${directives.length} [DIRECTIVE] line(s)`,
      targetLength && '--target-length',
      clones.length && 'reference_audio',
      ...['image', 'speaker', 'pitch-rate', 'loudness-rate', 'speech-rate', 'sample-rate', 'stability'].filter((k) => args[k] !== undefined).map((k) => `--${k}`),
      where !== 'gateway' && args.language && '--language',
    ].filter(Boolean);
    if (ignored.length) console.error(`WARN: ${entry.name} on ${where} has no equivalent for ${ignored.join(', ')} — ignored (Seed Audio / ElevenLabs only).`);
    if (!['mp3', 'wav'].includes(format)) { console.error(`WARN: --format ${format} is Seed Audio only — using mp3.`); format = 'mp3'; }
    if (speakers.length === 2 && voiceOf(speakers[0], 0) === voiceOf(speakers[1], 1)) die(`both speakers resolve to voice ${voiceOf(speakers[0], 0)} — give each a different voice_name / --voice-name.`);
  }
  // A provider's audio URL, converted to --format (Gemini TTS returns its own native format).
  async function fetchAudio(url) {
    const res = await fetch(url);
    if (!res.ok) throw userError(`download ${url} -> HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    const have = /mpeg|mp3/i.test(ct) ? 'mp3' : /wav/i.test(ct) ? 'wav' : /ogg/i.test(ct) ? 'ogg' : extname(new URL(url).pathname).slice(1).toLowerCase() || 'wav';
    return transcode({ bytes: new Uint8Array(await res.arrayBuffer()), format: have }, format);
  }

  // Segmind gemini-3.8-flash-tts: `text` (two speakers: each line prefixed with its voice name),
  // voice_1 / voice_2, `style` = delivery direction for every line.
  async function geminiSegmind() {
    geminiPrelude('segmind');
    const two = speakers.length === 2;
    const input = {
      text: turns.map((t) => (two ? `${voiceOf(t.label, speakers.indexOf(t.label))}: ${t.text}` : t.text)).join('\n'),
      voice_1: voiceOf(speakers[0], 0),
      ...(two ? { voice_2: voiceOf(speakers[1], 1) } : {}),
      ...(direction ? { style: direction } : {}),
    };
    console.error(`segmind   ${entry.segmind}  voices=${[input.voice_1, input.voice_2].filter(Boolean).join(',')}  ${input.text.length} chars${direction ? '  +style' : ''}`);
    const urls = await Promise.all(Array.from({ length: num }, () => segmindJob(entry.segmind, input, timeout)));
    return Promise.all(urls.map(fetchAudio));
  }

  // kie google/gemini-3-8-flash-tts: speakers[] ("Speaker N", voice_name, accent — required,
  // Neutral here; the description carries any accent — and audio_profile) + ordered dialogue_turns.
  async function geminiKie() {
    geminiPrelude('kie');
    const id = (label) => `Speaker ${speakers.indexOf(label) + 1}`;
    const input = {
      speakers: speakers.map((l, i) => ({
        speaker_id: id(l), voice_name: voiceOf(l, i), accent: 'Neutral',
        ...(characters[l]?.description ? { audio_profile: characters[l].description } : {}),
      })),
      dialogue_turns: turns.map((t) => ({ speaker_id: id(t.label), text: t.text })),
    };
    console.error(`kie       ${entry.kie}  voices=${input.speakers.map((x) => x.voice_name).join(',')}  turns=${turns.length}`);
    const urls = (await Promise.all(Array.from({ length: num }, () => kieJob(entry.kie, input, timeout)))).flat();
    return Promise.all(urls.map(fetchAudio));
  }

  // Gateway: one speaker's spoken lines as text, its voice, its description as instructions.
  async function runGateway() {
    geminiPrelude('gateway');
    const language = args.language && args.language !== 'auto' ? String(args.language) : undefined;
    const voice = explicitVoice(speakers[0], 0) || (entry.name === 'gemini-3.8-flash-tts' ? 'Kore' : undefined);
    const text = turns.map((t) => t.text).join('\n');
    const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
    console.error(`gateway   ${entry.gateway}  voice=${voice || 'default'}  ${text.length} chars${direction ? '  +instructions' : ''}`);
    const one = async () => {
      const r = await ai.generateSpeech({
        model: gw.speechModel(entry.gateway), text, // no outputFormat: models vary; transcode() normalizes
        ...(voice ? { voice } : {}), ...(language ? { language } : {}),
        ...(direction ? { instructions: `Voice and delivery: ${direction}` } : {}),
        maxRetries: 0,
      });
      logGatewayWarnings(r.warnings);
      return transcode({ bytes: r.audio.uint8Array, format: r.audio.format }, format);
    };
    return Promise.all(Array.from({ length: num }, one));
  }

  const blockers = isCast
    ? { kie: rawPromptMode ? 'a raw --prompt is a Seed Audio scene prompt (Segmind only)' : null }
    : { gateway: speakers.length > 1 ? `${speakers.length}-speaker dialogue needs Segmind/kie (the Gateway speech call takes one voice)` : null };
  const plan = planRoute({ model: entry.name, provider, keys, ws: W, blockers, entry, kind: 'speech', label: entry.name });
  const runners = isCast ? { segmind: runSegmind, kie: runKie } : { segmind: geminiSegmind, kie: geminiKie, gateway: runGateway };
  const results = await runRoute(plan, runners, W);
  await saveResults(results, args.out, { fallbackExt: 'mp3' });
}

main().catch((e) => die(errorText(e)));
