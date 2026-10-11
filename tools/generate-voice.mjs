#!/usr/bin/env node
// generate-voice.mjs — generate voiceovers: Gemini 3.8 Flash TTS (default) or Seed Audio 1.0.
//
// Usage:
//   node tools/generate-voice.mjs --script-file <vo.txt> --voice-name Kore --out <vo-A.mp3>
//   node tools/generate-voice.mjs --model seed-audio --script-file <vo.txt> \
//     --voices-file <voices.txt> --target-length 30 --out <vo-A.mp3>
//
// Which provider carries which model: tools/lib/providers.mjs (MODELS). File formats: HELP below.
// Seed Audio's multi-speaker prompt mapping is best-effort (its docs show no worked example).

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
Providers in order: ${PROVIDER_ORDER.join(' -> ')}

Required (one of):
  --script-file <path>     Script file (format below)
  --prompt "<text>"        Seed Audio only (Segmind): a raw scene-description prompt
  --prompt-file <path>     Same, from a file
  --out <path>             Output audio path

Optional:
  --model <name>           gemini-3.8-flash-tts (default): 1-2 speakers on Segmind/kie, 1 on the Gateway
                           seed-audio: Segmind Seed Audio 1.0; on kie, ElevenLabs Text to Dialogue v3
                             (needs elevenlabs_voice_id per label)
                           elevenlabs/<id> (kie only) | a raw Gateway speech id (e.g. fish-audio/s2.1-pro)
                           Without --model: a raw --prompt, 3+ speakers or [DIRECTIVE] lines use
                           seed-audio (with a note); anything else uses Gemini TTS
  --provider <name>        auto (default) | segmind | kie | gateway (vercel = gateway). auto tries each
                           provider with the model, a <WS>_ key and support for the request, moving on
                           only if one rejects it before generating
  --voices-file <path>     Each character once, for every model (format below)
  --format <ext>           mp3 (default) | wav | pcm | ogg_opus (pcm/ogg_opus: Seed Audio only)
  --num <n>                Variations (default 1)
  --timeout <seconds>      Max wait per task (default 600)

Gemini TTS:
  --voice-name <name[,name]> Prebuilt voice per speaker, in order (e.g. Kore or Kore,Puck; 30 voices:
                           Kore, Puck, Charon, Zephyr, Fenrir, Leda, Aoede, ...). A voices-file
                           voice_name wins. Default Kore, then Puck. On a raw Gateway id: its voice id
  --language <code>        Gateway: ISO 639-1 code (default auto-detect)

Seed Audio (Segmind):
  --target-length <secs>   Pace the read to about this length (a prompt instruction, not a guarantee;
                           check it didn't cut content)
  --image <path|url>       One mood/delivery reference image; don't combine with reference_audio
  --sample-rate <hz>       44100 (default) | 8000 | 16000 | 24000 | 32000 | 48000
  --speaker <name>         Voice preset (only "en_female_stokie_uranus_bigtts" exists)
  --pitch-rate <n>         -12..12 semitones
  --loudness-rate <n>      -50..100
  --speech-rate <n>        -50..100
  The composed prompt must stay under 2048 characters: shorten directions, never the script.

ElevenLabs (kie):
  --stability <n>          0 (Creative) | 0.5 (Natural, default) | 1 (Robust)
  --language <code>        en (default) | auto | ...

Script file: one line per event, in order. "LABEL: text" is a spoken line; "[KEYWORD: content]"
  (e.g. [MUSIC: soft guitar swells in]) is a directive, used by Seed Audio only. Blank lines and
  #-comments are skipped.

Voices file: one block per character:
  [HOST]
  description: A 50-year-old American woman, warm and slightly husky, unhurried.
  voice_name: Kore
  elevenlabs_voice_id: q2QIwJIbSmfKmouF78XA
  reference_audio: <url or local path>
  voice_name: Gemini TTS (optional). elevenlabs_voice_id: kie/ElevenLabs. reference_audio: a Seed
  Audio voice clone (optional, max 3). Gemini TTS uses descriptions as delivery direction and
  ignores clones, directives and the Seed Audio / ElevenLabs flags (with a warning).

Env: <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY / <WORKSPACE>_AI_GATEWAY_API_KEY; the
workspace comes from --out. Local refs must live under the brand folder (sent as signed R2 URLs).`;

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

// kie.ai (ElevenLabs) dialogue array. Directives have no kie equivalent and are dropped.
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

// Seed Audio takes one text_prompt: character intros, then the timeline. Clones (max 3) are cited
// as @Audio1..3, in the intro or else on each of that speaker's lines.
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
    const showTag = tagFor[item.label] && !characters[item.label]?.description;
    return `${item.label}${showTag ? ` (${tagFor[item.label]})` : ''}: ${item.text}`;
  });

  const parts = [...intros, ...timeline];
  if (targetLength) parts.push(targetLengthInstruction(targetLength));
  return { text_prompt: parts.join('\n'), reference_audio_urls: referenceAudioUrls };
}

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

// Models return their own format (Gemini TTS: WAV) and warn on an outputFormat they can't honor,
// so convert to --format here.
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

  // Gemini TTS by default; Seed Audio when the job needs it.
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
  const isCast = entry.name === 'seed-audio' || !!entry.name.match(/^elevenlabs\//);
  if (!isCast) {
    if (rawPromptMode) die('--prompt/--prompt-file is a Seed Audio scene prompt — drop --model or pass --model seed-audio.');
    if (!speakers.length) die('the script has no spoken lines');
    if (speakers.length > 2) die(`${entry.name} takes at most 2 speakers (got ${speakers.length}: ${speakers.join(', ')}) — pass --model seed-audio.`);
  }

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
  async function fetchAudio(url) {
    const res = await fetch(url);
    if (!res.ok) throw userError(`download ${url} -> HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    const have = /mpeg|mp3/i.test(ct) ? 'mp3' : /wav/i.test(ct) ? 'wav' : /ogg/i.test(ct) ? 'ogg' : extname(new URL(url).pathname).slice(1).toLowerCase() || 'wav';
    return transcode({ bytes: new Uint8Array(await res.arrayBuffer()), format: have }, format);
  }

  // Two speakers: each line is prefixed with its voice name.
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

  // kie requires an accent; Neutral, since the description carries any accent.
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

  async function runGateway() {
    geminiPrelude('gateway');
    const language = args.language && args.language !== 'auto' ? String(args.language) : undefined;
    const voice = explicitVoice(speakers[0], 0) || (entry.name === 'gemini-3.8-flash-tts' ? 'Kore' : undefined);
    const text = turns.map((t) => t.text).join('\n');
    const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
    console.error(`gateway   ${entry.gateway}  voice=${voice || 'default'}  ${text.length} chars${direction ? '  +instructions' : ''}`);
    const one = async () => {
      const r = await ai.generateSpeech({
        model: gw.speechModel(entry.gateway), text,
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
