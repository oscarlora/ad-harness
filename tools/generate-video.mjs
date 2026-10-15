#!/usr/bin/env node
// generate-video.mjs — generate video ads on kie.ai (models: tools/lib/providers.mjs MODELS).
// Each saved file gets a <stem>.gen.json sidecar.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyEnv, die, ffprobeJson, mimeOf, parseArgs, usage } from './lib/catalog.mjs';
import {
  errorText, gatewayClient, kieJob, kieUpload, kieUploadAll, logGatewayWarnings, pickModel, presignRef, runProviders, saveResults, times,
  userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-video.mjs — video ad generator (kie.ai)

  node tools/generate-video.mjs --prompt-file <prompt.txt> --first-frame <img> --out <clip.mp4>
  node tools/generate-video.mjs --model seedance-2.5 --image <a.png> --image <b.png> --prompt-file <p.txt> --out <clip.mp4>

Required:
  --prompt "<text>"        Inline prompt (max 7,000 characters on minimax-h3), OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output video path

Model:
  --model <name>           minimax-h3 (default) | gemini-omni-1.1-flash (its fallback) | seedance-2.5
                           (omni's fallback). Every model adds its own sound; only seedance-2.5 can
                           turn it off (--no-audio)

Inputs (local files or http(s) URLs). A clip takes frames OR references, never both:
  --first-frame <path|url> Lock the opening frame
  --last-frame <path|url>  Lock the closing frame. minimax-h3 takes it alone too; the others need
                           --first-frame
  --image <path|url>       Reference image (repeatable; prompts cite them in order)
  --video <path|url>       Reference video (repeatable)
  --audio <path|url>       Reference audio (repeatable; needs an --image or --video too)
  minimax-h3:   9 images (256-5760 px, ratio 0.4-2.5, 30 MB), 3 videos (mp4/mov, 2-15 s each, 15 s
                total, 50 MB; billed as extra seconds), 3 audios (wav/mp3, 2-15 s, 15 s total, free).
                The first 5 images are free, then 4 credits each
  omni:         7 slots: an image takes 1, the one --video takes 2 (max 100 MB / 30 s; the model
                reads a 10 s window from --video-start, and the clip length follows it). No --audio
  seedance-2.5: 30 images (300-6000 px, ratio 0.4-2.5, 30 MB), 10 videos (mp4/mov/mkv, 480p/720p,
                2-30 s, 30 s total, 200 MB; billed per input second too), 10 audios (wav/mp3/aac/ogg,
                2-30 s, 30 s total)
  --video-start <s>        omni: where its 10 s window starts (default 0)

Optional:
  --resolution <res>       minimax-h3: 768p (default) | 2k
                           omni: 720p (default; same price as 360p) | 360p | 1080p | 4k
                           seedance-2.5: 480p (default) | 720p | 1080p
  --duration <seconds>     5 (default; 4 on omni). minimax-h3: 4-15. omni: 4 | 6 | 8 | 10.
                           seedance-2.5: 4-30, or auto (the model picks)
  --aspect <ratio>         minimax-h3: 21:9 16:9 4:3 1:1 3:4 9:16 (default 9:16), or adaptive with
                             references (their default); frames set the shape (no --aspect)
                           omni: 9:16 (default) | 16:9
                           seedance-2.5: 1:1 4:3 3:4 16:9 9:16 21:9 adaptive (default)
  --no-audio               seedance-2.5 only: no generated sound
  --num <n>                Variations (default 1)
  --timeout <seconds>      Max wait per task (default 600)
  --unlisted-model <id>    A kie model id outside the list, sent as-is with --model's request shape
                           and no checks. Only with the user's yes
  --provider kie|gateway   Force one. By default a request kie rejects before generating goes to the
                           AI Gateway when the workspace has <WS>_AI_GATEWAY_API_KEY (seedance-2.5 only)

Env: <WORKSPACE>_KIE_API_KEY; the workspace comes from --out.`;

// kie limits per model, from the docs linked in MODELS. res = our name -> kie's value.
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const LIMITS = {
  'minimax-h3': {
    res: { '768p': '768P', '2k': '2K' }, durations: range(4, 15), aspects: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    images: 9, videos: 3, audios: 3, lastAlone: true,
  },
  'gemini-omni-1.1-flash': { res: { '720p': '720p', '360p': '360p', '1080p': '1080p', '4k': '4k' }, durations: [4, 6, 8, 10], aspects: ['9:16', '16:9'], images: 7, videos: 1, audios: 0 },
  'seedance-2.5': {
    res: { '480p': '480p', '720p': '720p', '1080p': '1080p' }, durations: range(4, 30), aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive'],
    images: 30, videos: 10, audios: 10, audioSwitch: true,
  },
};

// [model id, input] for kie. o = the request with hosted URLs.
function minimaxInput(base, o) {
  const input = { prompt: o.prompt, duration: o.duration, resolution: o.res };
  if (o.imageUrls.length || o.videoUrls.length) {
    if (o.aspect) input.aspect_ratio = o.aspect;
    if (o.imageUrls.length) input.reference_image_urls = o.imageUrls;
    if (o.videoUrls.length) input.reference_video_urls = o.videoUrls;
    if (o.audioUrls.length) input.reference_audio_urls = o.audioUrls;
    return [`${base}/reference-to-video`, input];
  }
  if (o.firstFrameUrl || o.lastFrameUrl) {
    if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
    if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
    return [`${base}/image-to-video`, input];
  }
  return [`${base}/text-to-video`, { ...input, aspect_ratio: o.aspect }];
}

// Duration is a string, ignored when a video is given.
function omniInput(base, o) {
  const input = { prompt: o.prompt, duration: String(o.duration), resolution: o.res };
  if (o.aspect) input.aspect_ratio = o.aspect;
  if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
  if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
  if (o.imageUrls.length) input.image_urls = o.imageUrls;
  if (o.videoUrls.length) input.video_list = [{ url: o.videoUrls[0], ...o.videoWindow }];
  return [base, input];
}

function seedanceInput(base, o) {
  const input = { prompt: o.prompt, duration: o.duration, resolution: o.res, generate_audio: o.audio };
  if (o.aspect) input.aspect_ratio = o.aspect;
  if (o.firstFrameUrl) input.first_frame_url = o.firstFrameUrl;
  if (o.lastFrameUrl) input.last_frame_url = o.lastFrameUrl;
  if (o.imageUrls.length) input.reference_image_urls = o.imageUrls;
  if (o.videoUrls.length) input.reference_video_urls = o.videoUrls;
  if (o.audioUrls.length) input.reference_audio_urls = o.audioUrls;
  return [base, input];
}
const INPUT = { 'minimax-h3': minimaxInput, 'gemini-omni-1.1-flash': omniInput, 'seedance-2.5': seedanceInput };

// AI Gateway sizes for Seedance (vercel.com/docs/ai-gateway/modalities/video-generation).
const GATEWAY_RESOLUTION = { '480p': '854x480', '720p': '1280x720', '1080p': '1920x1080' };

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['video', 'image', 'audio'], flags: ['no-audio'], help: HELP });
  for (const k of ['video', 'image', 'audio']) args[k] ||= [];
  if (!args.prompt && !args['prompt-file']) usage(HELP);
  if (!args.out) die('--out is required');
  const { W } = workspaceKeys(args.out);

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim() : String(args.prompt);
  if (!prompt) die('prompt is empty');

  const entry = pickModel(args, 'video', 'minimax-h3');
  const shape = entry.shape || entry.name;
  const L = LIMITS[shape];
  const firstFrame = args['first-frame'] ? String(args['first-frame']) : undefined;
  const lastFrame = args['last-frame'] ? String(args['last-frame']) : undefined;
  const frames = !!(firstFrame || lastFrame);
  const refs = args.image.length + args.video.length + args.audio.length;

  const resolution = String(args.resolution || Object.keys(L.res)[0]).toLowerCase();
  if (!L.res[resolution]) die(`${shape} renders at ${Object.keys(L.res).join(' | ')}, not ${resolution}.`);
  const durArg = String(args.duration || (shape === 'gemini-omni-1.1-flash' ? 4 : 5));
  const duration = durArg === 'auto' && shape === 'seedance-2.5' ? -1 : Number(durArg);
  if (duration !== -1 && !L.durations.includes(duration))
    die(`${shape} takes --duration ${shape === 'gemini-omni-1.1-flash' ? L.durations.join(' | ') : `${L.durations[0]}-${L.durations.at(-1)}`}, not ${durArg}.`);
  let aspect = args.aspect ? String(args.aspect).replace('x', ':') : undefined;
  if (aspect && !L.aspects.includes(aspect) && !(shape === 'minimax-h3' && aspect === 'adaptive' && refs))
    die(`${shape} takes --aspect ${L.aspects.join(' ')}${shape === 'minimax-h3' ? ' (adaptive only with references)' : ''}, not ${aspect}.`);
  if (shape === 'minimax-h3' && frames && aspect) die('minimax-h3 takes no --aspect with frames: the frame sets the shape.');
  if (!aspect && ((shape === 'minimax-h3' && !frames && !refs) || (shape === 'gemini-omni-1.1-flash' && !firstFrame))) aspect = '9:16';

  if (frames && refs) die('A clip takes --first-frame/--last-frame OR --image/--video/--audio references, not both.');
  if (lastFrame && !firstFrame && !L.lastAlone) die(`${shape} takes --last-frame only together with --first-frame.`);
  if (args.image.length > L.images) die(`${shape} takes at most ${L.images} --image references.`);
  if (args.video.length > L.videos) die(`${shape} takes at most ${L.videos} --video reference${L.videos === 1 ? '' : 's'}.`);
  if (args.audio.length > L.audios) die(`${shape} takes ${L.audios ? `at most ${L.audios}` : 'no'} --audio references.`);
  if (args.audio.length && !args.image.length && !args.video.length) die('--audio references need an --image or --video reference too.');
  if (shape === 'gemini-omni-1.1-flash' && args.image.length + 2 * args.video.length > 7) die('omni has 7 slots: each --image takes 1, the --video takes 2.');
  if (args['no-audio'] && !L.audioSwitch) die(`${shape} always adds sound (no switch in kie's docs): mute it in the edit, or ask the user about seedance-2.5 --no-audio.`);
  const audio = !args['no-audio'];

  let videoWindow;
  if (shape === 'gemini-omni-1.1-flash' && args.video.length) {
    const start = Number(args['video-start'] || 0);
    const len = Number(ffprobeJson(args.video[0]).format?.duration);
    if (!len) die(`Could not read the length of ${args.video[0]}.`);
    if (len > 30 || start >= len) die(`omni takes a video of at most 30 s with --video-start inside it (${args.video[0]} is ${len.toFixed(1)} s).`);
    videoWindow = { start, ends: Math.min(len, start + 10) };
  }

  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  const base = { prompt, aspect, duration, audio, videoWindow };

  async function runKie() {
    const o = {
      ...base, res: L.res[resolution],
      imageUrls: await kieUploadAll(args.image), videoUrls: await kieUploadAll(args.video), audioUrls: await kieUploadAll(args.audio),
      firstFrameUrl: firstFrame && await kieUpload(firstFrame), lastFrameUrl: lastFrame && await kieUpload(lastFrame),
    };
    const [model, input] = INPUT[shape](entry.kie, o);
    return times(num, () => kieJob(entry.unlisted ? entry.kie : model, input, timeout));
  }

  // Seedance 2.5 only; the Gateway takes refs as URLs.
  async function runGateway() {
    if (args.audio.length) throw userError('reference audio (--audio) has no documented AI Gateway input.');
    if (duration === -1) throw userError('--duration auto has no AI Gateway equivalent.');
    const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout + 300);
    const host = (p) => presignRef(p, args.out);
    const typed = async (p, fallback) => {
      const type = mimeOf(String(p).split('?')[0]);
      return { data: await host(p), mediaType: type === 'application/octet-stream' ? fallback : type };
    };
    const frameImages = [];
    if (firstFrame) frameImages.push({ image: await host(firstFrame), frameType: 'first_frame' });
    if (lastFrame) frameImages.push({ image: await host(lastFrame), frameType: 'last_frame' });
    const inputReferences = [];
    for (const im of args.image) inputReferences.push(await typed(im, 'image/png'));
    for (const v of args.video) inputReferences.push(await typed(v, 'video/mp4'));
    console.error(`gateway   ${entry.gateway}  ${resolution} ${aspect || 'adaptive'} ${duration}s  frames=${frameImages.length} refs=${inputReferences.length}`);
    return times(num, async () => {
      const r = await ai.experimental_generateVideo({
        model: gw.videoModel(entry.gateway), prompt, n: 1, duration, aspectRatio: aspect || 'adaptive',
        resolution: GATEWAY_RESOLUTION[resolution], generateAudio: audio,
        ...(frameImages.length ? { frameImages } : {}),
        ...(inputReferences.length ? { inputReferences } : {}),
        providerOptions: { bytedance: { pollTimeoutMs: timeout * 1000 } },
        maxRetries: 0,
      });
      logGatewayWarnings(r.warnings);
      return r.videos.map((v) => ({ bytes: v.uint8Array, mediaType: v.mediaType }));
    });
  }

  const { results, provider } = await runProviders({ entry, provider: args.provider, ws: W, kie: runKie, gateway: runGateway });
  const saved = await saveResults(results, args.out, { fallbackExt: 'mp4' });
  const refList = [['first-frame', firstFrame], ['last-frame', lastFrame], ...['image', 'video', 'audio'].flatMap((k) => args[k].map((p) => [k, p]))];
  await writeSidecars(saved, {
    tool: 'generate-video', model: entry.name, provider, prompt,
    params: { aspect, resolution, duration: duration === -1 ? 'auto' : duration, audio },
    refs: refList.filter(([, p]) => p).map(([role, path]) => ({ role, path })),
  });
}

main().catch((e) => die(errorText(e)));
