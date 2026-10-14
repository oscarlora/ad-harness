#!/usr/bin/env node
// generate-music.mjs — generate a music bed (Seed Audio 1.0), or a song on Suno when asked for.
// Seed Audio beds are always instrumental. Suno returns two full takes per run and has no length
// setting. Each saved file gets a <stem>.gen.json sidecar. Prompt craft: skills/add-music.

import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { applyEnv, die, FFMPEG_FIX, ffprobeJson, findBin, parseArgs, run, sleep, usage } from './lib/catalog.mjs';
import { downloadTo, errorText, kie, retryTransient, runSeedAudio, suffixed, times, userError, workspaceKeys, writeSidecars } from './lib/providers.mjs';

applyEnv();

// kie validation demands a callBackUrl even though we poll; results are fetched via record-info.
const CALLBACK_PLACEHOLDER = 'https://example.com/suno-callback';

const HELP = `generate-music.mjs — ad-bed / song generator: Seed Audio 1.0 (default) or Suno (explicit)

  node tools/generate-music.mjs --prompt "<style>" --out <bed.mp3> [--duration 30]
  node tools/generate-music.mjs --lyrics <lyrics.txt> --prompt "<style>" --out <song.mp3>

Required:
  --prompt "<text>"        Style: micro-genre + BPM + production markers
  --out <path>             Output audio path

Optional:
  --provider <name>        seed-audio (default; alias segmind) | suno (alias kie)
  --vocals                 Suno only: a full song with vocals, Suno writing the lyrics
  --lyrics <file>          Suno (implied): a song sung with these exact lyrics ([Section] tags are
                           structure, not sung); --prompt becomes the style. Also writes
                           <take>.suno-words.json (Suno's word timings). Never trimmed
  --duration <seconds>     Seed Audio target length (default 30, best-effort). Suno: trim each take
                           to the first N seconds; omit to keep full tracks
  --model <name>           Suno only: V4_5 (default; V6 with --lyrics) | V4 | V4_5PLUS | V4_5ALL |
                           V5 | V5_5 | V6 | V6_MINI | V6_WILD
  --title <text>           Suno only: track title (default from --out)
  --negative-tags "<text>" Suno only: styles to avoid
  --num <n>                Generations (default 1). Seed Audio: one take each; Suno: two
  --timeout <seconds>      Max wait per task (default 600)

Env:  <WORKSPACE>_SEGMIND_API_KEY by default; <WORKSPACE>_KIE_API_KEY for Suno.`;

// Suno endpoints report failures in a `code` field as well as the HTTP status.
async function suno(path, opts) {
  const json = await kie(path, opts);
  if (json.code !== undefined && json.code !== 200) throw userError(`${path} -> code ${json.code} ${json.msg || JSON.stringify(json)}`);
  return json;
}

// Friendly model name -> kie.ai Suno version id (V4_5, V4_5PLUS, ...). Unknown shapes pass through.
function resolveModel(model) {
  return String(model).toUpperCase().replace(/\+/g, 'PLUS').replace(/[.\s-]/g, '_').replace(/_+/g, '_');
}

async function createTask(opts) {
  // Custom mode: `prompt` is sung verbatim (V6 reads `lyrics` first, so both carry it). Non-custom
  // mode (--vocals): `prompt` describes the song and Suno writes the lyrics.
  const input = opts.lyrics
    ? { model: opts.model, customMode: true, instrumental: false, prompt: opts.lyrics, lyrics: opts.lyrics, style: opts.prompt, title: opts.title }
    : opts.instrumental
    ? { model: opts.model, customMode: true, instrumental: true, style: opts.prompt, title: opts.title }
    : { model: opts.model, customMode: false, instrumental: false, prompt: opts.prompt };
  if (opts.negativeTags) input.negativeTags = opts.negativeTags;
  input.callBackUrl = CALLBACK_PLACEHOLDER;

  const json = await suno('/api/v1/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const taskId = json?.data?.taskId;
  if (!taskId) throw new Error(`createTask failed: ${JSON.stringify(json)}`);
  console.error(`task      suno ${opts.model} -> ${taskId}`);
  return taskId;
}

async function pollResult(taskId, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const json = await suno(`/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`);
    const d = json?.data || {};
    const tracks = d?.response?.sunoData || [];
    // CALLBACK_EXCEPTION means our placeholder callback failed, not the audio — accept it when tracks exist.
    if (d.status === 'SUCCESS' || (d.status === 'CALLBACK_EXCEPTION' && tracks.length)) {
      if (!tracks.length) throw new Error(`task ${taskId} SUCCESS but no sunoData tracks`);
      return tracks;
    }
    if (['CREATE_TASK_FAILED', 'GENERATE_AUDIO_FAILED', 'CALLBACK_EXCEPTION'].includes(d.status)) {
      throw new Error(`task ${taskId} failed: ${d.status} ${d.errorMessage || d.errorCode || ''}`.trim());
    }
    if (d.status === 'SENSITIVE_WORD_ERROR') {
      throw userError(`task ${taskId} rejected: SENSITIVE_WORD_ERROR — reword the prompt (artist/brand names trip this)`);
    }
    if (Date.now() > deadline) throw new Error(`task ${taskId} timed out after ${timeoutSec}s (status=${d.status})`);
    console.error(`  ${taskId} ${d.status || 'PENDING'}`);
    await sleep(5000);
  }
}

// Suno's word timings for one take -> <take>.suno-words.json. Live responses nest a second
// {code,msg,data} envelope and use camelCase (alignedWords, hootCer), unlike the docs.
// A failure only warns: the song is already saved.
async function saveWords(track, saved) {
  try {
    const json = await suno('/api/v1/jobs/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'ai-music-api/timeStamped-lyrics', input: { task_id: track.taskId, audio_id: track.id } }),
    });
    const d = json?.data?.data || json?.data || {};
    const words = d.alignedWords || d.aligned_words;
    if (!Array.isArray(words)) throw new Error(`no alignedWords in ${JSON.stringify(json).slice(0, 300)}`);
    const out = saved.replace(/\.[^./]+$/, '.suno-words.json');
    await writeFile(out, JSON.stringify({ task_id: track.taskId, audio_id: track.id, hoot_cer: d.hootCer ?? d.hoot_cer, aligned_words: words }, null, 2));
    console.error(`words     ${words.length} timed words -> ${basename(out)}`);
  } catch (e) {
    console.error(`WARN: Suno word timestamps failed for ${basename(saved)} (task ${track.taskId}, audio ${track.id}): ${e.message}`);
  }
}

// Trim to the first N seconds in place (stream copy).
async function trimTo(file, seconds) {
  if (!findBin('ffmpeg')) die(`--duration needs ffmpeg. To get it, ${FFMPEG_FIX}`);
  const tmp = file.replace(/(\.[^./]+)$/, '.trim$1');
  const r = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-t', String(seconds), '-c', 'copy', tmp], { allowFail: true });
  if (r.status !== 0) { await unlink(tmp).catch(() => {}); die(`ffmpeg trim failed: ${r.stderr || r.error}`); }
  await rename(tmp, file);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ['vocals'], help: HELP });
  if (!args.prompt) usage(HELP);
  if (!args.out) die('--out is required');
  const provider = String(args.provider || (args.lyrics ? 'suno' : 'seed-audio')).toLowerCase();
  if (!['seed-audio', 'segmind', 'suno', 'kie'].includes(provider))
    die(`--provider must be seed-audio or suno, got: ${args.provider}`);

  const prompt = String(args.prompt).trim();
  if (!prompt) die('prompt is empty');
  const duration = args.duration ? Number(args.duration) : undefined;
  if (args.duration && (!Number.isFinite(duration) || duration <= 0)) die(`--duration must be a positive number of seconds, got ${args.duration}`);
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  const lyrics = args.lyrics ? (await readFile(String(args.lyrics), 'utf8')).trim() : undefined;
  if (args.lyrics && !lyrics) die(`--lyrics file is empty: ${args.lyrics}`);
  if (lyrics && args.vocals) die('--lyrics and --vocals are exclusive (--vocals lets Suno write its own lyrics)');
  if (lyrics && duration) console.error('note      --duration ignored with --lyrics (the song sets the length)');

  if (provider === 'seed-audio' || provider === 'segmind') {
    if (lyrics) die('--lyrics is Suno only (Seed Audio does not sing given lyrics)');
    if (args.vocals) die('--vocals requires --provider suno');
    runSeedAudio({
      prompt: ['Generate instrumental music only. No speech and no sung lyrics.', prompt, 'Start with the hook, with no intro. Keep the ending loopable.'].join(' '),
      seconds: duration || 30, num, timeout, out: args.out,
    });
    return;
  }

  const { W, keys } = workspaceKeys(args.out);
  if (!keys.kie) die(`Workspace ${W} has no kie.ai key. Add ${W}_KIE_API_KEY to .env (get one at https://kie.ai/api-key).`);

  const instrumental = !args.vocals && !lyrics;
  const model = resolveModel(String(args.model || (lyrics ? 'V6' : 'V4_5')));
  const styleLimit = ['V3_5', 'V4'].includes(model) ? 200 : 1000;
  if ((instrumental || lyrics) && prompt.length > styleLimit) die(`prompt is ${prompt.length} chars; ${model} allows ${styleLimit} for style`);
  if (args.vocals && prompt.length > 500) die(`prompt is ${prompt.length} chars; --vocals mode allows 500`);
  const lyricsLimit = model === 'V4' ? 3000 : 5000;
  if (lyrics && lyrics.length > lyricsLimit) die(`lyrics are ${lyrics.length} chars; ${model} allows ${lyricsLimit}`);

  const title = String(args.title || basename(args.out, extname(args.out)).replace(/[-_]+/g, ' ')).slice(0, 80);
  const opts = { model, prompt, title, instrumental, lyrics, negativeTags: args['negative-tags'] && String(args['negative-tags']) };
  console.error(`music     ${lyrics ? 'song from --lyrics' : instrumental ? 'instrumental bed' : 'song with vocals'}  "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`);

  // Only a failed create is retried; once Suno returns a task id, the task is polled to the end.
  const tracks = await times(num, async () => {
    const taskId = await retryTransient(() => createTask(opts));
    return (await pollResult(taskId, timeout)).map((t) => ({ ...t, taskId }));
  });
  const saved = [];

  for (let i = 0; i < tracks.length; i++) {
    const url = tracks[i].audioUrl || tracks[i].streamAudioUrl;
    if (!url) die(`take ${i + 1} has no audio url: ${JSON.stringify(tracks[i])}`);
    const file = await downloadTo(url, suffixed(args.out, i), { fallbackExt: 'mp3' });
    if (duration && !lyrics) await trimTo(file, duration);
    if (lyrics) await saveWords(tracks[i], file);
    if (findBin('ffprobe')) {
      const meta = ffprobeJson(file);
      const f = meta.format || {};
      if (!(meta.streams || []).some((s) => s.codec_type === 'audio')) die(`${file} has no audio stream`);
      console.error(`audio     take ${i + 1}: ${Math.round(Number(f.duration || 0))}s  ${(Number(f.size || 0) / 1e6).toFixed(1)}MB  ${(meta.streams[0] || {}).codec_name || '?'}`);
    }
    console.log('Saved: ' + file);
    saved.push(file);
  }
  await writeSidecars(saved, {
    tool: 'generate-music', model: `suno-${model}`, provider: 'kie', prompt: lyrics || prompt,
    params: { style: lyrics ? prompt : null, vocals: !instrumental, duration: lyrics ? null : duration, 'negative-tags': opts.negativeTags },
  });
}

main().catch((e) => die(errorText(e)));
