#!/usr/bin/env node
// generate-video.mjs — generate or edit video ads via Segmind, kie.ai or the Vercel AI Gateway.
// Which provider carries which model: tools/lib/providers.mjs (MODELS) — change it there.
// Each saved file gets a <stem>.gen.json sidecar.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyEnv, die, mimeOf, parseArgs, usage } from './lib/catalog.mjs';
import {
  MODELS, PROVIDER_ORDER, errorText, gatewayClient, kieJob, kieUpload, logGatewayWarnings, modelEntry, planRoute, presignRef, preSubmit,
  runRoute, saveResults, segmindJob, times, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-video.mjs — video generator/editor. Providers in order: ${PROVIDER_ORDER.join(' -> ')}

  node tools/generate-video.mjs --prompt-file <prompt.txt> --first-frame <img> --out <clip.mp4>
  node tools/generate-video.mjs --model flux-3-video-edit --video <clip.mp4> \\
    --prompt "Change the gold laptop to a matte black one" --out <edit.mp4>

Required:
  --prompt "<text>"        Inline prompt, OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output video path

Inputs (local files or http(s) URLs):
  --video <path|url>       Reference/source video (repeatable, max 3; 10 on 2.5; Gateway: 2.5 only)
  --image <path|url>       Reference image (repeatable, max 9; 30 on 2.5). Prompts cite them in
                           order ([Image 1], [Video 1] on the Gateway)
  --first-frame <path|url> Lock the opening frame
  --last-frame <path|url>  Lock the closing frame
  --audio <path|url>       Reference audio (repeatable, max 3; 10 on 2.5; Segmind/kie only)
  --video/--audio need Seedance, or minimax-h3-max on kie (refs <= 15s total). --video and
  --first/--last-frame can't be combined; neither can --image and frames on minimax or omni.

Optional:
  --provider <name>        auto (default) | segmind | kie | gateway (vercel = gateway). auto tries each
                           provider with the model, a <WS>_ key and support for the request, moving on
                           only if one rejects it before generating
  --model <name>           minimax-h3-max (default; no audio control; kie runs base H3, which adds
                             its own sound)
                           seedance-2.5 | seedance-2 | seedance-2-mini (video/audio refs + generated audio)
                           flux-3-video-edit (Segmind only): edits exactly one --video (MP4, max 15s /
                             50 MB) from a prompt naming only the change; output keeps the clip's shape
                           gemini-omni-1.1-flash (kie only): native audio + voices, always on
                           Any provider's id for these works too (e.g. bytedance/seedance-2.5).
                           Else a raw Gateway id (sent to kie.ai as-is with --provider kie)
  --aspect <ratio>         1:1 4:3 3:4 16:9 9:16 21:9 (9x16 also works). Default: 9:16 on minimax and
                           omni, adaptive on Seedance. minimax takes adaptive only with --image refs;
                           omni takes 9:16 or 16:9 only
  --resolution <res>       480p (default) | 720p | 1080p | 768p
                           minimax: 480p/768p (kie renders 768P). Segmind/kie: seedance-2 up to 1080p,
                           Mini and 2.5 up to 720p. Gateway: 2.5 and 2.0 up to 1080p, Mini up to 720p.
                           omni: 360p/720p/1080p/4k (480p -> 360p)
  --duration <seconds>     5 (default). 4-15; 4-30 on 2.5; 5-15 on minimax (4-15 on kie);
                           4/6/8/10 on omni (rounded up)
  --no-audio               No generated audio (omni always has audio)
  --generate-audio         Force generated audio on (Seedance's default; an error on minimax)
  --num <n>                Variations (default 1)
  --timeout <seconds>      Max wait per task (default 600)

Env: <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY / <WORKSPACE>_AI_GATEWAY_API_KEY; the
workspace comes from --out.`;

// Per-model limits on Segmind/kie. Raw ids use the seedance-2 row and skip the resolution check.
// minimax video/audio refs work on kie only.
const MODEL_CAPS = {
  'minimax-h3-max':  { minDuration: 5, maxDuration: 15, images: 9, videos: 3, audios: 3, resolutions: ['480p', '768p'], silent: true, aspect: '9:16' },
  'seedance-2':      { minDuration: 4, maxDuration: 15, images: 9,  videos: 3,  audios: 3,  resolutions: ['480p', '720p', '1080p'] },
  'seedance-2-mini': { minDuration: 4, maxDuration: 15, images: 9,  videos: 3,  audios: 3,  resolutions: ['480p', '720p'] },
  'seedance-2.5':    { minDuration: 4, maxDuration: 30, images: 30, videos: 10, audios: 10, resolutions: ['480p', '720p'] },
  // Omni's video_list / audio_ids / character_ids inputs aren't wired here.
  'gemini-omni-1.1-flash': { minDuration: 4, maxDuration: 10, durations: [4, 6, 8, 10], images: 7, videos: 0, audios: 0, resolutions: ['360p', '720p', '1080p', '4k'], aspects: ['9:16', '16:9'], aspect: '9:16' },
};

// Gateway limits differ from Segmind/kie (ai-gateway.vercel.sh/v1/models video_capabilities).
const GATEWAY_VIDEO_CAPS = {
  'bytedance/seedance-2.5':      { resolutions: ['480p', '720p', '1080p'], adaptive: true,  videos: true,  images: true,  frames: true, audio: true },
  'bytedance/seedance-2.0':      { resolutions: ['480p', '720p', '1080p'], adaptive: false, videos: false, images: true,  frames: true, audio: true },
  'bytedance/seedance-2.0-mini': { resolutions: ['480p', '720p'],          adaptive: false, videos: false, images: true,  frames: true, audio: true },
  'minimax/minimax-h3-max':      { resolutions: ['480p', '768p'],          adaptive: false, videos: false, images: false, frames: true, audio: false, minDuration: 5, maxDuration: 15 },
};
// The AI SDK takes WxH. 768p is not documented on the Gateway — verify on first use.
const GATEWAY_RESOLUTION = { '480p': '854x480', '720p': '1280x720', '768p': '1366x768', '1080p': '1920x1080' };

// Why the Gateway can't carry this request (null = it can). Raw ids get no checks.
function gatewayBlocker(gwId, { resolution, aspect, videos, images, audios, frames }) {
  const c = GATEWAY_VIDEO_CAPS[gwId];
  if (!c) return null;
  if (audios) return 'reference audio (--audio) has no documented Gateway input';
  if (videos && !c.videos) return `${gwId} takes no --video references on the Gateway`;
  if (images && !c.images) return `${gwId} takes no --image references (first/last frame only)`;
  if (frames && images) return 'first/last frames override --image references on the Gateway';
  if (!c.resolutions.includes(resolution)) return `${gwId} runs ${c.resolutions.join('/')} on the Gateway, not ${resolution}`;
  if (aspect === 'adaptive' && !c.adaptive) return `${gwId} has no 'adaptive' aspect on the Gateway — pass --aspect`;
  return null;
}

// Reference fields per provider: [images, videos, audios].
const REF_FIELDS = {
  segmind: ['reference_images', 'reference_videos', 'reference_audios'],
  kie: ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls'],
};
const withRefs = (input, opts, provider) => {
  REF_FIELDS[provider].forEach((field, i) => { const urls = [opts.imageUrls, opts.videoUrls, opts.audioUrls][i]; if (urls.length) input[field] = urls; });
  return input;
};

// Seedance request body. Segmind always gets generate_audio (default on): its own default differs
// between models.
function seedanceInput(provider, opts) {
  const input = { prompt: opts.prompt, resolution: opts.resolution, duration: opts.duration };
  const audio = provider === 'segmind' ? opts.generateAudio ?? true : opts.generateAudio;
  if (audio !== undefined) input.generate_audio = audio;
  if (opts.aspect) input.aspect_ratio = opts.aspect;
  if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
  return withRefs(input, opts, provider);
}

// MiniMax H3 Max on Segmind: Reference-to-Video with --image refs, else Turbo. Returns [slug, input].
function segmindMinimaxInput(base, opts) {
  const resolution = opts.resolution.toUpperCase();
  if (opts.imageUrls.length) {
    const input = { prompt: opts.prompt, reference_images: opts.imageUrls, duration: opts.duration, resolution };
    if (opts.aspect) input.ratio = opts.aspect;
    return [`${base}-reference-to-video`, input];
  }
  const input = { prompt: opts.prompt, duration: opts.duration, resolution };
  if (opts.aspect && opts.aspect !== 'adaptive') input.aspect_ratio = opts.aspect;
  if (opts.firstFrameUrl) input.image = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_image = opts.lastFrameUrl;
  return [`${base}-turbo`, input];
}

// Base MiniMax H3 on kie (768P or 2K only). Returns [model, input].
function kieMinimaxInput(base, opts) {
  const input = { prompt: opts.prompt, duration: opts.duration, resolution: '768P' };
  if (opts.imageUrls.length || opts.videoUrls.length || opts.audioUrls.length) {
    if (opts.aspect) input.aspect_ratio = opts.aspect;
    return [`${base}/reference-to-video`, withRefs(input, opts, 'kie')];
  }
  if (opts.firstFrameUrl || opts.lastFrameUrl) {
    if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
    if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
    return [`${base}/image-to-video`, input];
  }
  input.aspect_ratio = opts.aspect;
  return [`${base}/text-to-video`, input];
}

// Gemini Omni 1.1 Flash on kie: duration is a string.
function kieOmniInput(opts) {
  const input = { prompt: opts.prompt, duration: String(opts.duration), resolution: opts.resolution, aspect_ratio: opts.aspect };
  if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
  if (opts.imageUrls.length) input.image_urls = opts.imageUrls;
  return input;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['video', 'image', 'audio'], flags: ['no-audio', 'generate-audio'], help: HELP });
  for (const k of ['video', 'image', 'audio']) args[k] ||= [];
  if (!args.prompt && !args['prompt-file']) usage(HELP);
  if (!args.out) die('--out is required');
  const { W, keys } = workspaceKeys(args.out);

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim() : String(args.prompt);
  if (!prompt) die('prompt is empty');

  const provider = String(args.provider || 'auto').toLowerCase();
  const modelArg = String(args.model || 'minimax-h3-max').toLowerCase();
  // A MODELS name or any provider's id for it; else a raw id: Gateway only, or sent to kie.ai as-is
  // with --provider kie.
  const known = modelEntry(modelArg, 'video');
  const modelName = MODELS[known?.name]?.kind === 'video' ? known.name : null;
  if (!modelName && !modelArg.includes('/')) die(`unknown --model "${modelArg}" (minimax-h3-max | seedance-2.5 | seedance-2 | seedance-2-mini | flux-3-video-edit | gemini-omni-1.1-flash | a raw creator/model id)`);
  const entry = modelName ? known : { name: modelArg, kind: 'video', [provider === 'kie' ? 'kie' : 'gateway']: modelArg };
  const isMinimax = modelName === 'minimax-h3-max';
  const isOmni = modelName === 'gemini-omni-1.1-flash';
  const gcaps = GATEWAY_VIDEO_CAPS[entry.gateway] || {};
  const caps = MODEL_CAPS[modelName] || MODEL_CAPS['seedance-2'];
  const aspect = args.aspect ? String(args.aspect).replace('x', ':') : caps.aspect || 'adaptive';
  const resolution = ((r) => (isOmni && r === '480p' ? '360p' : r))(String(args.resolution || '480p').toLowerCase());
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  const generateAudio = args['no-audio'] ? false : (args['generate-audio'] ? true : undefined);
  const firstFrame = args['first-frame'] ? String(args['first-frame']) : undefined;
  const lastFrame = args['last-frame'] ? String(args['last-frame']) : undefined;

  if (modelName === 'flux-3-video-edit') {
    if (args.video.length !== 1) die('flux-3-video-edit edits one clip: pass exactly one --video (MP4, max 15s / 50 MB).');
    if (args.image.length || args.audio.length || firstFrame || lastFrame)
      die('flux-3-video-edit takes only --video and the prompt (no --image, --audio, --first-frame or --last-frame).');
    const ignored = ['aspect', 'resolution', 'duration', 'no-audio', 'generate-audio'].filter((k) => args[k] !== undefined);
    if (ignored.length) console.error(`WARN: flux-3-video-edit ignores ${ignored.map((k) => `--${k}`).join(', ')}: the output follows the source clip.`);
    const plan = planRoute({ model: modelName, provider, keys, ws: W, entry, kind: 'video' });
    const runSegmind = async () => {
      const input = { prompt, video: await presignRef(String(args.video[0]), args.out) };
      return times(num, () => segmindJob(entry.segmind, input, timeout));
    };
    const saved = await saveResults((await runRoute(plan, { segmind: runSegmind }, W)).results, args.out, { fallbackExt: 'mp4' });
    await writeSidecars(saved, { tool: 'generate-video', model: modelName, provider: 'segmind', prompt, refs: [{ role: 'video', path: args.video[0] }] });
    return;
  }

  const avRefs = args.video.length + args.audio.length;
  if (caps.silent && generateAudio) die(`${modelName} takes no generated audio (--generate-audio) — it has no audio control. Pass --model seedance-2.5 for that.`);
  if (isMinimax && (args.image.length || avRefs) && (firstFrame || lastFrame)) die('minimax-h3-max takes --image/--video/--audio references OR --first-frame/--last-frame, not both.');
  if (isMinimax && aspect === 'adaptive' && !args.image.length) die("minimax-h3-max takes 'adaptive' only with --image references — pass --aspect (e.g. 9:16).");
  if (args.video.length > caps.videos) die(`max ${caps.videos} reference videos on ${modelName || 'this model'}`);
  if (args.image.length > caps.images) die(`max ${caps.images} reference images on ${modelName || 'this model'}`);
  if (args.audio.length > caps.audios) die(`max ${caps.audios} reference audio files on ${modelName || 'this model'}`);
  if (args.video.length && (firstFrame || lastFrame)) {
    die('--video and --first-frame/--last-frame are mutually exclusive (only one scene source allowed)');
  }
  if (caps.aspects && !caps.aspects.includes(aspect)) die(`${modelName} takes --aspect ${caps.aspects.join(' or ')}, not ${aspect}.`);
  if (isOmni && args.image.length && (firstFrame || lastFrame)) die('gemini-omni-1.1-flash takes --image references OR --first-frame/--last-frame, not both.');
  if (isOmni && lastFrame && !firstFrame) die('gemini-omni-1.1-flash takes a --last-frame only together with a --first-frame.');
  if (isOmni && generateAudio === false) console.error('WARN: gemini-omni-1.1-flash always generates audio (no switch) — mute it in the edit.');

  const offTier = modelName && !caps.resolutions.includes(resolution) ? `${modelName} runs ${caps.resolutions.join('/')} there, not ${resolution}` : null;
  const blockers = {
    kie: offTier,
    gateway: entry.gateway ? gatewayBlocker(entry.gateway, {
      resolution, aspect, videos: args.video.length, images: args.image.length, audios: args.audio.length, frames: !!(firstFrame || lastFrame),
    }) : null,
    segmind: offTier || (isMinimax && avRefs ? 'H3 Max on Segmind takes no video/audio references (kie does)' : null) || (isMinimax && lastFrame && !firstFrame && !args.image.length ? 'H3 Max Turbo takes a last frame only together with a first frame' : null),
  };
  const plan = planRoute({ model: modelName || modelArg, provider, keys, ws: W, blockers, entry, kind: 'video', label: modelName || `${modelArg} (Gateway only)` });

  // kie's base H3 takes 4s; H3 Max elsewhere starts at 5s.
  const minDuration = isMinimax && plan.every((q) => q === 'kie') ? 4 : caps.minDuration;
  const asked = parseInt(args.duration || '5', 10);
  const clamped = Math.max(minDuration, Math.min(caps.maxDuration, asked));
  const duration = caps.durations ? caps.durations.find((d) => d >= clamped) : clamped;
  if (duration !== asked) console.error(`WARN: --duration ${asked} isn't ${caps.durations ? caps.durations.join('/') : `within ${minDuration}-${caps.maxDuration}`}s here — using ${duration}s.`);

  // Refs are hosted once per host and reused on failover.
  const hosted = new Map();
  const hostRefs = (host) => hosted.get(host) || hosted.set(host, (async () => {
    const up = async (list) => { const urls = []; for (const x of list) urls.push(await host(x)); return urls; };
    return {
      prompt, aspect, resolution, duration, generateAudio,
      videoUrls: await up(args.video), imageUrls: await up(args.image), audioUrls: await up(args.audio),
      firstFrameUrl: firstFrame ? await host(firstFrame) : undefined,
      lastFrameUrl: lastFrame ? await host(lastFrame) : undefined,
    };
  })()).get(host);
  const r2Host = (p) => presignRef(p, args.out);
  async function runKie() {
    const opts = await hostRefs(kieUpload);
    let model = entry.kie, input;
    if (isMinimax) {
      console.error(`WARN: kie has only base MiniMax H3 (not H3 Max)${resolution === '480p' ? ', at 768P/2K — rendering at 768P, not 480p' : ''}.`);
      [model, input] = kieMinimaxInput(entry.kie, opts);
    } else input = isOmni ? kieOmniInput(opts) : seedanceInput('kie', opts);
    return times(num, () => kieJob(model, input, timeout));
  }
  async function runSegmind() {
    const opts = await hostRefs(r2Host);
    const [slug, input] = isMinimax ? segmindMinimaxInput(entry.segmind, opts) : [entry.segmind, seedanceInput('segmind', opts)];
    return times(num, () => segmindJob(slug, input, timeout));
  }

  // The Gateway takes refs as URLs only.
  async function runGateway() {
    const gwId = entry.gateway;
    const { ai, gw: gateway } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout + 300);
    const host = (p) => presignRef(p, args.out).catch((e) => { throw preSubmit(e); });
    const typed = async (p, fallbackType) => {
      const type = mimeOf(String(p).split('?')[0]);
      return { data: await host(p), mediaType: type === 'application/octet-stream' ? fallbackType : type };
    };
    const frameImages = [];
    if (firstFrame) frameImages.push({ image: await host(firstFrame), frameType: 'first_frame' });
    if (lastFrame) frameImages.push({ image: await host(lastFrame), frameType: 'last_frame' });
    const inputReferences = [];
    for (const im of args.image) inputReferences.push(await typed(im, 'image/png'));
    for (const v of args.video) inputReferences.push(await typed(v, 'video/mp4'));
    const isSeedance = gwId.startsWith('bytedance/');
    const audio = gcaps.audio === false ? {} : { generateAudio: generateAudio ?? isSeedance };
    console.error(`gateway   ${gwId}  ${resolution} ${aspect} ${duration}s  frames=${frameImages.length} refs=${inputReferences.length}`);
    const one = async () => {
      const r = await ai.experimental_generateVideo({
        model: gateway.videoModel(gwId), prompt, n: 1, duration,
        ...(aspect !== 'adaptive' || gcaps.adaptive ? { aspectRatio: aspect } : {}),
        ...(GATEWAY_RESOLUTION[resolution] ? { resolution: GATEWAY_RESOLUTION[resolution] } : {}),
        ...audio,
        ...(frameImages.length ? { frameImages } : {}),
        ...(inputReferences.length ? { inputReferences } : {}),
        ...(isSeedance ? { providerOptions: { bytedance: { pollTimeoutMs: timeout * 1000 } } } : {}),
        maxRetries: 0,
      });
      logGatewayWarnings(r.warnings);
      return r.videos.map((v) => ({ bytes: v.uint8Array, mediaType: v.mediaType }));
    };
    return times(num, one);
  }

  const { results, provider: ran } = await runRoute(plan, { gateway: runGateway, segmind: runSegmind, kie: runKie }, W);
  const saved = await saveResults(results, args.out, { fallbackExt: 'mp4' });
  const refs = [['first-frame', firstFrame], ['last-frame', lastFrame], ...['image', 'video', 'audio'].flatMap((k) => args[k].map((p) => [k, p]))];
  await writeSidecars(saved, {
    tool: 'generate-video', model: modelName || modelArg, provider: ran, prompt,
    params: { aspect, resolution: ran === 'kie' && isMinimax ? '768p' : resolution, duration, audio: generateAudio },
    refs: refs.filter(([, p]) => p).map(([role, path]) => ({ role, path })),
  });
}

main().catch((e) => die(errorText(e)));
