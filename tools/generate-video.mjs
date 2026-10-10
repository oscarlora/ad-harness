#!/usr/bin/env node
// generate-video.mjs — generate / edit video ads. Providers are tried in PROVIDER_ORDER (Segmind,
// kie.ai, then the Vercel AI Gateway), skipping any that doesn't carry the model or can't take the
// request (the per-provider blockers below); force one with --provider. Which provider carries which
// model is tools/lib/providers.mjs (MODELS + planRoute) — change it there, never here. Node 22+.
//
// Models: minimax-h3-max (default; MiniMax H3 Max — text, first/last frame, or up to 9 reference
// images in; no audio control, no voices), seedance-2.5, seedance-2, seedance-2-mini, or any raw Gateway id.
// minimax-h3-max per provider: Segmind runs H3 Max Turbo (text / first-last frame) or H3 Max
// Reference-to-Video (--image refs), 480p/768p; kie has only base MiniMax H3 (768P/2K, so a 480p
// request renders at 768P there); the Gateway runs H3 Max, text or first/last frame only.
// Seedance is multimodal: text + image(s) + video(s) + audio in, video + generated audio out —
// video references, reference audio, or voiced video need --model seedance-2.5. Feed the source
// clip with --video and describe the edit in the prompt to do video-to-video. seedance-2.5 clips run
// to 30s (vs 15s) with far more references (30 images / 10 videos / 10 audios) — see MODEL_CAPS /
// GATEWAY_VIDEO_CAPS.
// flux-3-video-edit (FLUX 3 Video Edit, Segmind only) edits one source clip from a prompt that names
// only the change: exactly one --video (MP4, max 15s / 50 MB; above 720p is downscaled) and nothing
// else. It has no duration/resolution/aspect/audio settings — the output follows the source clip.
// gemini-omni-1.1-flash (Gemini Omni 1.1 Flash, kie only) renders text, a first (+ optional last)
// frame, or up to 7 --image refs (refs and frames are mutually exclusive) at 4/6/8/10s, 9:16 or 16:9,
// 360p/720p/1080p/4k (480p drafts render at 360p), always with native audio and voices.
// Drafts and creative iterations default to 480p. A 720p/1080p master is always a fresh model
// generation with the exact approved prompt and original references, changing only the resolution
// (and, when a provider requires it, the model). Never upscale a 480p output or feed it back.
//
// Flow (segmind) : presign local refs from R2, submit, poll, download.
// Flow (kie)     : upload local refs to kie.ai's CDN, create task, poll, download.
// Flow (gateway) : presign local refs from R2 (the Gateway takes URLs only), one
//                  experimental_generateVideo call per variation, save the bytes.
// Each saved file gets a <stem>.gen.json sidecar of what was sent (model, provider, params, refs, prompt).
// Audio: when neither --no-audio nor --generate-audio is passed, Seedance requests state
// generate_audio=true explicitly (Segmind's own default is inconsistent: false on the full model,
// true on Mini) — Ad Harness almost always wants audio (make-ai-podcast generates footage+voice
// together), so it is never left to chance. MiniMax has no audio setting, so none is sent (Segmind's H3 Max
// Turbo still returns a quiet ambient track; no voices. kie runs base H3, aka Hailuo 03, whose
// image-to-video returns its own generated soundtrack).
//
// Usage (edit an existing clip):
//   node tools/generate-video.mjs --model seedance-2.5 \
//     --prompt-file workspaces/<WS>/Acme/outputs/prompts/3_prompt.txt \
//     --video "workspaces/<WS>/Acme/inputs/media/Instagram(3) short.mp4" \
//     --aspect 9:16 --resolution 720p --duration 4 --no-audio \
//     --out "workspaces/<WS>/Acme/outputs/Instagram3_younger-arm_no-text.mp4"
//   node tools/generate-video.mjs --model flux-3-video-edit --video <clip.mp4> \
//     --prompt "Change the gold laptop to a matte black one" --out <edit.mp4>
//
// Defaults: --provider auto  --model minimax-h3-max  --aspect 9:16 (adaptive on Seedance)
//           --resolution 480p  --duration 5  --num 1
//
// Auth: per-workspace <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY /
//   <WORKSPACE>_AI_GATEWAY_API_KEY, inferred from --out, in env or a .env at project root.
//   Local-file refs are sent as signed R2 URLs on the Segmind and Gateway paths (the workspace's
//   R2 credentials) and uploaded to kie.ai's CDN on the kie path; http(s) URL refs pass through.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyEnv, die, mimeOf, parseArgs } from './lib/catalog.mjs';
import {
  PROVIDER_ORDER, errorText, gatewayClient, kieJob, kieUpload, logGatewayWarnings, modelEntry, planRoute, presignRef, preSubmit,
  runRoute, saveResults, segmindJob, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-video.mjs — video generator/editor. Providers in order: ${PROVIDER_ORDER.join(' -> ')}
(routing: tools/lib/providers.mjs)

Required:
  --prompt "<text>"        Inline prompt, OR
  --prompt-file <path>     Read prompt from a file (preferred for long prompts)
  --out <path>             Output video path (e.g. workspaces/<WS>/Acme/outputs/clip.mp4)

Inputs (local files: signed R2 URLs on Segmind/Gateway, kie.ai CDN upload on kie; http(s) URLs pass through):
  --video <path|url>       Reference/source video (repeatable, max 3 — 10 on 2.5; Gateway: 2.5 only)
  --image <path|url>       Reference image (repeatable, max 9 — 30 on 2.5). Prompts cite them in
                           order ([Image 1], [Video 1] on the Gateway).
  --first-frame <path|url> Lock the opening frame
  --last-frame <path|url>  Lock the closing frame
  --audio <path|url>       Reference audio (repeatable, max 3 — 10 on 2.5; Segmind/kie only)
  NOTE: --video/--audio need Seedance (--model seedance-2.5), or minimax-h3-max on kie (base H3
        Reference-to-Video, 768P/2K, audio+video refs <= 15s total). minimax-h3-max takes --image refs
        (Segmind/kie) OR first/last frames, not both. --video and --first-frame/--last-frame are
        mutually exclusive (pick one scene source). flux-3-video-edit takes exactly one --video
        and no other input.

Optional:
  --provider <name>        auto (default) | segmind | kie | gateway   (vercel = gateway). auto = every
                           provider that carries the model, has its <WS>_ key and can take the request,
                           in the order above; a skipped provider prints a note. Fails over only on a
                           rejection before generating (bad request, outage, out of credits) — never
                           after submit.
  --model <name>           minimax-h3-max (default; MiniMax H3 Max; on kie base H3 / Hailuo 03, which adds its own sound) | seedance-2.5 (video/audio
                           references + generated audio) | seedance-2 | seedance-2-mini (raw forms
                           minimax/minimax-h3-max, bytedance/seedance-2, -2-mini, -2-5 also accepted) |
                           flux-3-video-edit (FLUX 3 Video Edit, Segmind only: edits one --video clip,
                           max 15s / 50 MB, from a prompt naming only the change; the output keeps the
                           clip's length and shape, so --aspect/--resolution/--duration are ignored) |
                           gemini-omni-1.1-flash (Gemini Omni 1.1 Flash, kie only: text, first/last
                           frame or up to 7 --image refs, not both; native audio + voices, always on) |
                           any other raw Gateway id (with --provider kie a raw id is sent to kie.ai
                           as-is). Any other name is an error.
  --aspect <ratio>         9:16 on minimax, adaptive on Seedance (defaults) | 1:1 4:3 3:4 16:9 9:16
                           21:9. Accepts 9x16. minimax takes adaptive only with --image refs.
                           gemini-omni-1.1-flash: 9:16 (default) or 16:9 only.
  --resolution <res>       480p (default) | 720p | 1080p | 768p (minimax's master tier)
                           minimax: 480p/768p (kie renders both at 768P). Gateway: 2.5 and 2.0
                           480p/720p/1080p, Mini 480p/720p. Segmind/kie: 2.0 480p/720p/1080p, Mini and
                           2.5 480p/720p. gemini-omni-1.1-flash: 360p/720p/1080p/4k (480p -> 360p).
  --duration <seconds>     5 (default). Integer 4-15 — 4-30 on 2.5; 5-15 on minimax (4-15 on kie);
                           4/6/8/10 on gemini-omni-1.1-flash (rounded up to the next one).
  --no-audio               Disable generated audio (all providers; not possible on gemini-omni-1.1-flash)
  --generate-audio         Force generated audio on (the Seedance default when neither is passed;
                           an error on minimax, which has no audio control)
  --num <n>                Number of variations to generate (default 1)
  --timeout <seconds>      Max wait per task (default 600)

Quality workflow:
  Generate first drafts and every creative iteration at 480p. After approval, make the master by
  running a fresh generation with the exact same prompt and original references, changing only
  --resolution (768p on minimax; 720p/1080p on Seedance) — and --model only if the provider lacks
  that resolution. Never upscale the 480p output and never add that draft as a new --video reference.

Env: <WORKSPACE>_SEGMIND_API_KEY / <WORKSPACE>_KIE_API_KEY / <WORKSPACE>_AI_GATEWAY_API_KEY,
     inferred from --out, in .env.`;

// Canonical short model names: friendly names plus provider ids, so every spelling gets the same
// routing. Any other raw id (containing a slash) goes to the Gateway in auto, or to kie.ai as-is
// with --provider kie — see isRawId in main().
const KNOWN_MODELS = {
  'minimax-h3-max': 'minimax-h3-max', 'minimax/minimax-h3-max': 'minimax-h3-max',
  'seedance-2': 'seedance-2', 'seedance-2.0': 'seedance-2', 'bytedance/seedance-2': 'seedance-2',
  'seedance-2-mini': 'seedance-2-mini', 'seedance-2.0-mini': 'seedance-2-mini',
  'bytedance/seedance-2-mini': 'seedance-2-mini',
  'seedance-2.5': 'seedance-2.5', 'seedance-2-5': 'seedance-2.5',
  'bytedance/seedance-2-5': 'seedance-2.5',
  'flux-3-video-edit': 'flux-3-video-edit',
  'gemini-omni-1.1-flash': 'gemini-omni-1.1-flash', 'google/gemini-omni-flash-1-1': 'gemini-omni-1.1-flash',
};

// Per-model limits on Segmind/kie (checked against kie.ai's and Segmind's docs: Seedance 2026-08-07,
// MiniMax 2026-09-29). Single source of truth for the input validation in main(). Unrecognized raw
// ids fall back to the seedance-2 row and skip the resolution check, since their real limits are
// unknown here. minimax: Segmind H3 Max runs 480P/768P and 5-15s; kie's base H3 runs 768P/2K and
// 4-15s and, on /reference-to-video only, takes up to 3 video + 3 audio refs (<= 15s combined;
// docs.kie.ai, 2026-10-03). Segmind's H3 Max takes none. Neither has an audio-generation switch.
const MODEL_CAPS = {
  'minimax-h3-max':  { minDuration: 5, maxDuration: 15, images: 9, videos: 3, audios: 3, resolutions: ['480p', '768p'], silent: true, aspect: '9:16' },
  'seedance-2':      { minDuration: 4, maxDuration: 15, images: 9,  videos: 3,  audios: 3,  resolutions: ['480p', '720p', '1080p'] },
  'seedance-2-mini': { minDuration: 4, maxDuration: 15, images: 9,  videos: 3,  audios: 3,  resolutions: ['480p', '720p'] },
  'seedance-2.5':    { minDuration: 4, maxDuration: 30, images: 30, videos: 10, audios: 10, resolutions: ['480p', '720p'] },
  // Omni 1.1 Flash on kie: fixed durations, two aspects, audio always generated (no switch). Its
  // video_list / audio_ids / character_ids inputs aren't wired here.
  'gemini-omni-1.1-flash': { minDuration: 4, maxDuration: 10, durations: [4, 6, 8, 10], images: 7, videos: 0, audios: 0, resolutions: ['360p', '720p', '1080p', '4k'], aspects: ['9:16', '16:9'], aspect: '9:16' },
};

// Gateway-side limits (ai-gateway.vercel.sh/v1/models video_capabilities + the Gateway video docs,
// checked 2026-09-29). They differ from Segmind/kie: 2.5 and 2.0 reach 1080p there, only 2.5
// takes 'adaptive' and video references, no Seedance model documents audio references, and
// MiniMax H3 Max is text or first/last frame only (no references, no audio). `frames` = accepts
// first/last frame images.
const GATEWAY_VIDEO_CAPS = {
  'bytedance/seedance-2.5':      { resolutions: ['480p', '720p', '1080p'], adaptive: true,  videos: true,  images: true,  frames: true, audio: true },
  'bytedance/seedance-2.0':      { resolutions: ['480p', '720p', '1080p'], adaptive: false, videos: false, images: true,  frames: true, audio: true },
  'bytedance/seedance-2.0-mini': { resolutions: ['480p', '720p'],          adaptive: false, videos: false, images: true,  frames: true, audio: true },
  'minimax/minimax-h3-max':      { resolutions: ['480p', '768p'],          adaptive: false, videos: false, images: false, frames: true, audio: false, minDuration: 5, maxDuration: 15 },
};
// The AI SDK takes WxH; the Gateway maps these to the provider's tier (Seedance values from the
// Gateway docs; 768p is MiniMax's 16:9 tier and not documented on the Gateway — verify on first use).
const GATEWAY_RESOLUTION = { '480p': '854x480', '720p': '1280x720', '768p': '1366x768', '1080p': '1920x1080' };

// Why the Gateway path can't carry this request (null = it can). auto skips the Gateway with a
// note; --provider gateway fails with this message. Unknown raw ids get no checks.
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

// kie request body (Seedance): reference_*_urls field names; generate_audio only when a flag set it.
function kieVideoInput(opts) {
  const input = { prompt: opts.prompt, resolution: opts.resolution, duration: opts.duration };
  if (opts.aspect) input.aspect_ratio = opts.aspect;
  if (opts.generateAudio !== undefined) input.generate_audio = opts.generateAudio;
  if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
  if (opts.imageUrls.length) input.reference_image_urls = opts.imageUrls;
  if (opts.videoUrls.length) input.reference_video_urls = opts.videoUrls;
  if (opts.audioUrls.length) input.reference_audio_urls = opts.audioUrls;
  return input;
}

// Segmind request body (Seedance): kie's shape with reference_images/_videos/_audios field names and
// generate_audio always explicit — see the file banner for why.
function segmindVideoInput(opts) {
  const input = {
    prompt: opts.prompt, resolution: opts.resolution, duration: opts.duration,
    generate_audio: opts.generateAudio !== undefined ? opts.generateAudio : true,
  };
  if (opts.aspect) input.aspect_ratio = opts.aspect;
  if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
  if (opts.imageUrls.length) input.reference_images = opts.imageUrls;
  if (opts.videoUrls.length) input.reference_videos = opts.videoUrls;
  if (opts.audioUrls.length) input.reference_audios = opts.audioUrls;
  return input;
}

// MiniMax H3 Max on Segmind (segmind.com/models/<slug>/api, 2026-09-29): Reference-to-Video when
// --image refs are given (reference_images 1-9, `ratio` incl. adaptive), else Turbo (`image` = first
// frame, `last_frame_image`; aspect_ratio ignored when a frame is set). Returns [slug, input].
function segmindMinimaxInput(base, opts) {
  const resolution = opts.resolution.toUpperCase(); // 480P | 768P
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

// Base MiniMax H3 on kie (docs.kie.ai/market/minimax, 2026-09-29): /reference-to-video with --image
// (+ --video/--audio) refs, /image-to-video with frames, else /text-to-video (aspect_ratio required, no adaptive).
// Resolution is 768P or 2K only. Returns [model, input].
function kieMinimaxInput(base, opts) {
  const input = { prompt: opts.prompt, duration: opts.duration, resolution: '768P' };
  if (opts.imageUrls.length || opts.videoUrls.length || opts.audioUrls.length) {
    if (opts.imageUrls.length) input.reference_image_urls = opts.imageUrls;
    if (opts.videoUrls.length) input.reference_video_urls = opts.videoUrls;
    if (opts.audioUrls.length) input.reference_audio_urls = opts.audioUrls;
    if (opts.aspect) input.aspect_ratio = opts.aspect;
    return [`${base}/reference-to-video`, input];
  }
  if (opts.firstFrameUrl || opts.lastFrameUrl) {
    if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
    if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
    return [`${base}/image-to-video`, input];
  }
  input.aspect_ratio = opts.aspect;
  return [`${base}/text-to-video`, input];
}

// Gemini Omni 1.1 Flash on kie (docs.kie.ai/market/google/gemini-omni-flash-1-1, 2026-10-06):
// duration is a string; first_frame_url excludes image_urls; last_frame_url needs a first frame.
function kieOmniInput(opts) {
  const input = { prompt: opts.prompt, duration: String(opts.duration), resolution: opts.resolution, aspect_ratio: opts.aspect };
  if (opts.firstFrameUrl) input.first_frame_url = opts.firstFrameUrl;
  if (opts.lastFrameUrl) input.last_frame_url = opts.lastFrameUrl;
  if (opts.imageUrls.length) input.image_urls = opts.imageUrls;
  return input;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['video', 'image', 'audio'] });
  for (const k of ['video', 'image', 'audio']) args[k] ||= [];
  if (args.help || (!args.prompt && !args['prompt-file'])) { console.log(HELP); process.exit(args.help ? 0 : 1); }
  if (!args.out) die('--out is required');
  const { W, keys } = workspaceKeys(args.out);

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim() : String(args.prompt);
  if (!prompt) die('prompt is empty');

  const provider = String(args.provider || 'auto').toLowerCase();
  const modelArg = String(args.model || 'minimax-h3-max').toLowerCase();
  const modelName = KNOWN_MODELS[modelArg] || null;
  const isRawId = modelArg.includes('/') && !modelName; // raw id: the Gateway's in auto, kie's with --provider kie
  if (!modelName && !isRawId) die(`unknown --model "${modelArg}" (minimax-h3-max | seedance-2.5 | seedance-2 | seedance-2-mini | flux-3-video-edit | gemini-omni-1.1-flash | a raw creator/model id)`);
  // A raw id with --provider kie is kie's escape hatch: sent to kie.ai as-is.
  const entry = isRawId && provider === 'kie' ? { name: modelArg, kind: 'video', kie: modelArg } : modelEntry(modelName || modelArg, 'video');
  const isMinimax = modelName === 'minimax-h3-max';
  const isOmni = modelName === 'gemini-omni-1.1-flash';
  const gcaps = (entry.gateway && GATEWAY_VIDEO_CAPS[entry.gateway]) || {};
  const caps = MODEL_CAPS[modelName] || { ...MODEL_CAPS['seedance-2'], ...gcaps.maxDuration && { maxDuration: gcaps.maxDuration }, ...gcaps.minDuration && { minDuration: gcaps.minDuration } };
  // Models without 'adaptive' (MiniMax) default to 9:16, Meta's Reels/Stories shape.
  const aspect = args.aspect ? String(args.aspect).replace('x', ':') : caps.aspect || (!modelName && gcaps.adaptive === false ? '9:16' : 'adaptive');
  // Omni has no 480p: drafts render at its 360p draft tier.
  const resolution = ((r) => (isOmni && r === '480p' ? '360p' : r))(String(args.resolution || '480p').toLowerCase());
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '600', 10);
  const generateAudio = args['no-audio'] ? false : (args['generate-audio'] ? true : undefined);
  const firstFrame = args['first-frame'] ? String(args['first-frame']) : undefined;
  const lastFrame = args['last-frame'] ? String(args['last-frame']) : undefined;

  // FLUX 3 Video Edit (Segmind only): one source clip + the prompt, nothing else. The output follows
  // the clip, so the shape/length/audio flags have nothing to set.
  if (modelName === 'flux-3-video-edit') {
    if (args.video.length !== 1) die('flux-3-video-edit edits one clip: pass exactly one --video (MP4, max 15s / 50 MB).');
    if (args.image.length || args.audio.length || firstFrame || lastFrame)
      die('flux-3-video-edit takes only --video and the prompt (no --image, --audio, --first-frame or --last-frame).');
    const ignored = ['aspect', 'resolution', 'duration', 'no-audio', 'generate-audio'].filter((k) => args[k] !== undefined);
    if (ignored.length) console.error(`WARN: flux-3-video-edit ignores ${ignored.map((k) => `--${k}`).join(', ')}: the output follows the source clip.`);
    const plan = planRoute({ model: modelName, provider, keys, ws: W, entry, kind: 'video' });
    const runSegmind = async () => {
      const input = { prompt, video: await presignRef(String(args.video[0]), args.out) };
      return Promise.all(Array.from({ length: num }, () => segmindJob(entry.segmind, input, timeout)));
    };
    const saved = await saveResults(await runRoute(plan, { segmind: runSegmind }, W), args.out, { fallbackExt: 'mp4' });
    await writeSidecars(saved, { tool: 'generate-video', model: modelName, provider: 'segmind', prompt, refs: [{ role: 'video', path: args.video[0] }] });
    return;
  }

  // MiniMax has no audio control; video/audio references reach it only on kie (blockers below).
  const silent = caps.silent || gcaps.audio === false;
  const avRefs = args.video.length + args.audio.length;
  const unsupported = !isMinimax && gcaps.images === false && avRefs ? 'video/audio references (--video/--audio)'
    : !isMinimax && gcaps.images === false && args.image.length ? 'reference images (--image)'
    : silent && generateAudio ? 'generated audio (--generate-audio) — it has no audio control' : null;
  if (unsupported) die(`${modelName || modelArg} takes no ${unsupported}. Pass --model seedance-2.5 for that.`);
  if (isMinimax && (args.image.length || avRefs) && (firstFrame || lastFrame)) die('minimax-h3-max takes --image/--video/--audio references OR --first-frame/--last-frame, not both.');
  if (isMinimax && aspect === 'adaptive' && !args.image.length) die("minimax-h3-max takes 'adaptive' only with --image references — pass --aspect (e.g. 9:16).");
  if (args.video.length > caps.videos) die(`max ${caps.videos} reference videos on ${modelName || 'this model'}`);
  if (args.image.length > caps.images) die(`max ${caps.images} reference images on ${modelName || 'this model'}`);
  if (args.audio.length > caps.audios) die(`max ${caps.audios} reference audio files on ${modelName || 'this model'}`);
  // A reference video and first/last frame select competing "scenes" — only one allowed, on every provider.
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
  const duration = caps.durations ? caps.durations.find((d) => d >= clamped) : clamped; // fixed lengths: round up
  if (duration !== asked) console.error(`WARN: --duration ${asked} isn't ${caps.durations ? caps.durations.join('/') : `within ${minDuration}-${caps.maxDuration}`}s here — using ${duration}s.`);

  // ---- Segmind / kie: refs hosted once per host (signed R2 URLs / kie.ai CDN), reused on failover ----
  const hosted = new Map();
  const hostRefs = (host) => hosted.get(host) || hosted.set(host, (async () => {
    const up = async (list) => { const urls = []; for (const x of list) urls.push(await host(x)); return urls; }; // sequential: clear logs
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
    } else input = isOmni ? kieOmniInput(opts) : kieVideoInput(opts);
    return (await Promise.all(Array.from({ length: num }, () => kieJob(model, input, timeout)))).flat();
  }
  async function runSegmind() {
    const opts = await hostRefs(r2Host);
    const [slug, input] = isMinimax ? segmindMinimaxInput(entry.segmind, opts) : [entry.segmind, segmindVideoInput(opts)];
    return Promise.all(Array.from({ length: num }, () => segmindJob(slug, input, timeout)));
  }

  // ---- Gateway: refs as signed R2 URLs (Seedance takes URLs only), tagged with their media type ----
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
    return (await Promise.all(Array.from({ length: num }, one))).flat();
  }

  let ran; // the provider that generated (runRoute may fail over)
  const via = (name, run) => () => { ran = name; return run(); };
  const results = await runRoute(plan, { gateway: via('gateway', runGateway), segmind: via('segmind', runSegmind), kie: via('kie', runKie) }, W);
  const saved = await saveResults(results, args.out, { fallbackExt: 'mp4' });
  const refs = [['first-frame', firstFrame], ['last-frame', lastFrame], ...['image', 'video', 'audio'].flatMap((k) => args[k].map((p) => [k, p]))];
  await writeSidecars(saved, {
    tool: 'generate-video', model: modelName || modelArg, provider: ran, prompt,
    params: { aspect, resolution: ran === 'kie' && isMinimax ? '768p' : resolution, duration, audio: generateAudio },
    refs: refs.filter(([, p]) => p).map(([role, path]) => ({ role, path })),
  });
}

main().catch((e) => die(errorText(e)));
