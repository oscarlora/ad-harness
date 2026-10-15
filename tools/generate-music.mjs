#!/usr/bin/env node
// generate-music.mjs — Suno on kie.ai: an instrumental bed by default, or a song (--vocals, --lyrics).
// Each task returns two takes; each saved file gets a <stem>.gen.json sidecar. Prompt craft:
// skills/add-music. Exports runSuno, which generate-sfx.mjs uses for Suno Sounds.

import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyEnv, die, ffprobeJson, findBin, parseArgs, sleep, usage } from './lib/catalog.mjs';
import { downloadTo, errorText, kie, retryTransient, suffixed, times, userError, workspaceKeys, writeSidecars } from './lib/providers.mjs';

applyEnv();

export const SUNO_MODELS = ['V6', 'V6_MINI', 'V6_WILD'];

const HELP = `generate-music.mjs — music on Suno (kie.ai): an instrumental bed by default, or a song

  node tools/generate-music.mjs --prompt "<style>" --out <bed.mp3> [--duration 30]
  node tools/generate-music.mjs --lyrics <lyrics.txt> --prompt "<style>" --out <song.mp3>

Each run gives two takes (<out>, <out>_2).

Required:
  --prompt "<text>"        Style: micro-genre + BPM + production markers (max 1000 chars). With
                           --vocals: the song idea (max 3000)
  --out <path>             Output audio path

Optional:
  --vocals                 A song with vocals, Suno writing the lyrics
  --lyrics <file>          A song sung with these exact lyrics (max 5000 chars; [Section] tags are
                           structure, not sung). Also writes <take>.suno-words.json (word timings)
  --duration <seconds>     Target length, 10–360 (bed default 30; a song picks its own). Not with
                           --vocals. Takes land within a few seconds of it
  --model <name>           V6 (default) | V6_MINI (faster) | V6_WILD (bolder); same price
  --title <text>           Track title (default from --out; max 80 chars)
  --negative-tags "<text>" Styles to avoid
  --num <n>                Runs (default 1); each gives two takes
  --timeout <seconds>      Max wait per task (default 600)

Env:  <WORKSPACE>_KIE_API_KEY (inferred from --out).`;

async function kieOk(path, body) {
  const json = await kie(path, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (json.code !== 200) throw Object.assign(userError(`${path} -> code ${json.code} ${json.msg || ''}`), { fatal: json.code >= 400 && json.code < 500 && json.code !== 429 });
  return json.data;
}

async function poll(taskId, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const d = await kieOk(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    if (d.state === 'success') {
      const tracks = d.response?.data || [];
      if (!tracks.length) throw new Error(`task ${taskId} succeeded with no tracks`);
      console.error(`done      ${taskId} (${d.creditsConsumed} credits)`);
      return tracks;
    }
    if (d.state === 'fail') throw userError(`task ${taskId} failed: ${d.failMsg || d.failCode}`);
    if (Date.now() > deadline) throw new Error(`task ${taskId} timed out after ${timeoutSec}s (state=${d.state})`);
    console.error(`  ${taskId} ${d.state}`);
    await sleep(5000);
  }
}

// `num` Suno tasks on kie, each polled to the end; saves every take next to `out` (_2, _3 …) and
// prints "Saved:". Only a failed create is retried: a retried poll would pay twice.
export async function runSuno(model, input, { num = 1, timeout = 600, out }) {
  const { W, keys } = workspaceKeys(out);
  if (!keys.kie) throw userError(`Workspace ${W} has no kie.ai key. Add ${W}_KIE_API_KEY to .env (get one at https://kie.ai/api-key).`);
  const takes = await times(num, async () => {
    const { taskId } = await retryTransient(() => kieOk('/api/v1/jobs/createTask', { model, input }));
    console.error(`task      ${model} ${input.model} -> ${taskId}`);
    return (await poll(taskId, timeout)).map((track) => ({ track, taskId }));
  });
  for (const [i, take] of takes.entries()) {
    take.file = await downloadTo(take.track.audio_url || take.track.stream_audio_url, suffixed(out, i), { fallbackExt: 'mp3' });
    if (findBin('ffprobe')) {
      const meta = ffprobeJson(take.file);
      if (!(meta.streams || []).some((s) => s.codec_type === 'audio')) throw userError(`${take.file} has no audio stream`);
      console.error(`audio     take ${i + 1}: ${Number(meta.format?.duration || 0).toFixed(1)}s`);
    }
    console.log('Saved: ' + take.file);
  }
  return takes;
}

// Suno's word timings for one take -> <take>.suno-words.json. Live responses nest a second {code,msg,data}
// envelope inside data (hence res.code, res.data.alignedWords). A failure only warns: the song is saved.
async function saveWords({ track, taskId, file }) {
  try {
    const res = await kieOk('/api/v1/jobs/createTask', { model: 'ai-music-api/timeStamped-lyrics', input: { task_id: taskId, audio_id: track.id } });
    const words = res?.data?.alignedWords;
    if (res?.code !== 200 || !Array.isArray(words)) throw new Error(`no alignedWords in ${JSON.stringify(res).slice(0, 300)}`);
    const out = file.replace(/\.[^./]+$/, '.suno-words.json');
    await writeFile(out, JSON.stringify({ task_id: taskId, audio_id: track.id, hoot_cer: res.data.hootCer, aligned_words: words }, null, 2));
    console.error(`words     ${words.length} timed words -> ${basename(out)}`);
  } catch (e) {
    console.error(`WARN: Suno word timestamps failed for ${basename(file)} (task ${taskId}, audio ${track.id}): ${e.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { flags: ['vocals'], help: HELP });
  if (!args.prompt) usage(HELP);
  if (!args.out) die('--out is required');
  const prompt = String(args.prompt).trim();
  if (!prompt) die('prompt is empty');
  const lyrics = args.lyrics ? (await readFile(String(args.lyrics), 'utf8')).trim() : undefined;
  if (args.lyrics && !lyrics) die(`--lyrics file is empty: ${args.lyrics}`);
  if (lyrics && args.vocals) die('--lyrics and --vocals are exclusive (--vocals lets Suno write its own lyrics)');
  if (args.vocals && args.duration) die('--duration does not work with --vocals; use --lyrics, or trim the take in the edit');
  const model = String(args.model || 'V6').toUpperCase();
  if (!SUNO_MODELS.includes(model)) die(`--model must be one of ${SUNO_MODELS.join(', ')}, got: ${args.model}`);
  const duration = args.duration ? Number(args.duration) : lyrics || args.vocals ? undefined : 30;
  if (duration !== undefined && !(duration >= 10 && duration <= 360)) die(`--duration must be 10–360 seconds, got: ${args.duration}`);
  if (prompt.length > (args.vocals ? 3000 : 1000)) die(`prompt is ${prompt.length} chars; the limit is ${args.vocals ? 3000 : 1000}`);
  if (lyrics?.length > 5000) die(`lyrics are ${lyrics.length} chars; the limit is 5000`);
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  const negativeTags = args['negative-tags'] && String(args['negative-tags']);
  const title = String(args.title || basename(args.out, extname(args.out)).replace(/[-_]+/g, ' ')).slice(0, 80);

  const input = args.vocals
    ? { custom_mode: false, instrumental: false, model, prompt }
    : { custom_mode: true, instrumental: !lyrics, model, title, style: prompt, lyrics, duration };
  if (negativeTags) input.negative_tags = negativeTags;
  console.error(`music     ${lyrics ? 'song from --lyrics' : args.vocals ? 'song with vocals' : 'instrumental bed'}  "${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}"`);

  const takes = await runSuno('ai-music-api/generate', input, { num, timeout, out: args.out });
  if (lyrics) for (const take of takes) await saveWords(take);
  await writeSidecars(takes.map((t) => t.file), {
    tool: 'generate-music', model: `suno-${model}`, provider: 'kie', prompt: lyrics || prompt,
    params: { style: lyrics ? prompt : null, vocals: !!(lyrics || args.vocals), duration, 'negative-tags': negativeTags },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => die(errorText(e)));
