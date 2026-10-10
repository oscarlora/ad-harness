#!/usr/bin/env node
// generate-image.mjs — generate image ads. Providers are tried in PROVIDER_ORDER (Segmind, kie.ai,
//   then the Vercel AI Gateway), skipping any that doesn't carry the model; force one with
//   --provider. Which provider carries which model is tools/lib/providers.mjs (MODELS + planRoute) —
//   change it there, never here. Each model's Segmind request shape lives in segmindImageInput
//   below (checked against segmind.com/models/<slug>/api on 2026-08-24; gpt-image-2.5-flare on
//   2026-09-29).
//
// Flow (segmind) : presign brand refs from R2, submit v2 job, poll, download.
// Flow (kie)     : upload local refs -> URLs, create task, poll, download result(s).
// Flow (gateway) : refs downscaled + sent inline; generateImage (image models) or generateText
//                  with image output (Gemini "Nano Banana" models); save. AI SDK 7 (`npm install`).
// Every saved file is stripped of embedded metadata (C2PA, EXIF, XMP) by lib/clean-image.mjs;
// pixels are untouched.
// Each saved file gets a <stem>.gen.json sidecar of what was sent (model, provider, params, refs, prompt).
// The Segmind/kie paths stay dependency-free — the AI SDK loads only when the Gateway runs.
//
// Usage (record-driven — the normal path):
//   node tools/generate-image.mjs --record workspaces/<WS>/Acme/outputs/json/3.json
// Ad-hoc:
//   node tools/generate-image.mjs --prompt "<text>" --ref "<img>" --out "<path>.png"
//
// Defaults: --provider auto  --model gpt-image-2.5  --aspect 4:5  --resolution 1K  --quality medium  --num 1
//
// Auth: per-workspace only. The workspace is inferred from the output/record path, and the keys
//   used are <WORKSPACE>_SEGMIND_API_KEY, <WORKSPACE>_KIE_API_KEY and/or
//   <WORKSPACE>_AI_GATEWAY_API_KEY — e.g. ACME_SEGMIND_API_KEY. No shared fallback.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanImage } from './lib/clean-image.mjs';
import { applyEnv, die, findBin, parseArgs } from './lib/catalog.mjs';
import {
  MODELS, PROVIDER_ORDER, errorText, gatewayClient, kieJob, kieUpload, logGatewayWarnings, modelEntry, planRoute, presignRef,
  preSubmit, runRoute, saveResults, segmindJob, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();
const exec = promisify(execFile);

const HELP = `generate-image.mjs — image ad generator. Providers in order: ${PROVIDER_ORDER.join(' -> ')}
(routing: tools/lib/providers.mjs)

Required:
  --prompt "<text>"        Inline prompt, OR
  --prompt-file <path>     Read prompt from a file (preferred for long prompts)
  --out <path>             Output image path (e.g. workspaces/<WS>/Acme/outputs/3_4x5_...png)
  --record <path>          Per-ad record (outputs/json/<id>.json): supplies prompt/refs/params and is
                           stamped with the actual payload + output. With it, the three above are optional.

Optional:
  --provider <name>        auto (default) | segmind | kie | gateway   (vercel = gateway). auto = every
                           provider that carries the model and has its <WS>_ key, in the order above.
                           Fails over only when a provider rejects the request before generating
                           (bad request, outage, out of credits) — never after submit.
  --ref <path|url>         Reference image (repeatable). Segmind receives signed R2 URLs for local
                           brand files; kie uploads local files; the Gateway inlines them (downscaled).
  --model <name>           gpt-image-2.5 (default; GPT Image 2.5 Flare) | gpt-image-2 | nano-banana-pro |
                           nano-banana-2 | nano-banana-2-lite | seedream-5-pro | flux-2-pro |
                           grok-imagine-image-2 | qwen-image-3 | reve-2 | ideogram-v4-fast | any raw
                           Gateway id (e.g. openai/gpt-image-2).
                           Segmind: all but nano-banana-2. kie: gpt-image-2.5 (no 4:5/5:4 there),
                           gpt-image-2, nano-banana-pro, nano-banana-2-lite. Gateway: all but
                           qwen-image-3, reve-2, ideogram-v4-fast; nano-banana-2 and raw ids are Gateway only.
  --aspect <ratio>         4:5 (default). Accepts 4x5. Some models only accept specific ratios —
                           an unsupported one fails fast with the list it does accept.
  --resolution <res>       1K (default) | 2K | 4K   (quality tier; exact pixels /16 where a model takes
                           a size. Some models only reach 1K or 1K/2K — an unsupported tier fails fast.)
  --quality <q>            low | medium (default) | high | auto   (gpt-image-2.5 / gpt-image-2 on Segmind and the
                           Gateway; kie has no quality field. On Segmind ideogram-v4-fast high buys its
                           QUALITY tier, low its TURBO one)
  --negative "<text>"      Things to keep out of the image. Segmind qwen-image-3 only, the sole model
                           with a real negative_prompt field; everywhere else, put it in the prompt.
  --num <n>                Number of variations to generate (default 1)
  --format <ext>           png (default) | jpg   (Segmind: nano-banana-pro, nano-banana-2-lite,
                           seedream-5-pro, flux-2-pro, grok-imagine-image-2; kie: nano-banana-pro;
                           the Gateway saves the model's native format)
  --timeout <seconds>      Max wait per task (default 300)

Reference images per model: gpt-image-2.5, gpt-image-2, nano-banana-pro, nano-banana-2(-lite), seedream-5-pro,
  qwen-image-3, reve-2, grok-imagine-image-2 take them optionally. flux-2-pro REQUIRES at least
  one (it has no text-to-image mode). ideogram-v4-fast accepts none at all. Passing refs a model
  can't take, or none to a model that requires them, fails before any request is sent.
  Order is preserved end to end, so --ref N is the model's Nth reference image. Per-model caps
  (see REF_MODE): gpt-image-2.5 / gpt-image-2 16, nano-banana-pro / nano-banana-2 / nano-banana-2-lite 14,
  seedream-5-pro 10, flux-2-pro / reve-2 8, qwen-image-3 / grok-imagine-image-2 3. Extras past the
  cap are dropped with a WARN naming each dropped file, not an error.

Env: per-workspace keys, inferred from the --out/--record path — <WORKSPACE>_SEGMIND_API_KEY,
     <WORKSPACE>_KIE_API_KEY and/or <WORKSPACE>_AI_GATEWAY_API_KEY.`;

// kie.ai request shapes for the models MODELS gives a kie id — anything else must fail rather than
// silently render as another model. `variants` = separate -text-to-image / -image-to-image endpoints.
// nano-banana-2-lite has no resolution or format field there (docs.kie.ai/market/google/
// nano-banana-2-lite, checked 2026-08-24). gpt-image-2.5-flare's aspect_ratio enum has no 4:5/5:4
// and no quality field (docs.kie.ai, checked 2026-09-29).
const KIE_SHAPE = {
  'gpt-image-2.5':      { variants: true, imageField: 'input_urls', resolution: true, aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] },
  'gpt-image-2':        { variants: true, imageField: 'input_urls', resolution: true },
  'nano-banana-pro':    { imageField: 'image_input', resolution: true, format: true },
  'nano-banana-2-lite': { imageField: 'image_urls' },
};
const kieBlocker = (model, aspect) => {
  const a = KIE_SHAPE[model]?.aspects;
  return a && !a.includes(aspect) ? `${model} takes ${a.join(', ')} there, not ${aspect}` : null;
};

// Pixel size for size-driven models (openai/, bfl/ and bytedance/ ids on the Gateway; flux-2-pro on
// Segmind): long edge from the tier, short edge from the aspect, both rounded to a multiple of 16
// (the models require it). 4:5 @ 2K -> 1632x2048.
function sizeForTier(aspect, tier) {
  const [a, b] = aspect.split(':').map(Number);
  const long = { '1K': 1280, '2K': 2048, '4K': 3840 }[tier] || 2048;
  const r16 = (n) => Math.max(16, Math.round(n / 16) * 16);
  return b >= a ? `${r16(long * a / b)}x${long}` : `${long}x${r16(long * b / a)}`;
}

// Segmind GPT Image 2's exact size presets per tier and aspect.
const SEGMIND_GPT_IMAGE_2_SIZES = {
  '1K': { '1:1':'1024x1024', '4:5':'832x1040', '5:4':'1040x832', '3:4':'768x1024', '4:3':'1024x768', '9:16':'720x1280', '16:9':'1280x720' },
  '2K': { '1:1':'1536x1536', '4:5':'1600x2000', '5:4':'2000x1600', '3:4':'1536x2048', '4:3':'2048x1536', '9:16':'1152x2048', '16:9':'2048x1152' },
  '4K': { '1:1':'2880x2880', '4:5':'2560x3200', '5:4':'3200x2560', '3:4':'2480x3312', '4:3':'3312x2480', '9:16':'2160x3840', '16:9':'3840x2160' },
};
function segmindImageSize(aspect, tier) {
  const size = SEGMIND_GPT_IMAGE_2_SIZES[tier]?.[aspect];
  if (!size) die(`Segmind GPT Image 2 does not support --resolution ${tier} with --aspect ${aspect}`);
  return size;
}

// Segmind GPT Image 2.5 Flare takes a custom width/height: edges /16, at most 8,294,400 pixels (so a
// 4K tier on a non-16:9 aspect is scaled down to that cap).
function flareSize(aspect, tier) {
  let [w, h] = sizeForTier(aspect, tier).split('x').map(Number);
  const s = Math.sqrt(8294400 / (w * h));
  if (s < 1) [w, h] = [Math.floor(w * s / 16) * 16, Math.floor(h * s / 16) * 16];
  return { width: w, height: h };
}

// ---- Per-model Segmind capability table (2026-08-24) ----
// One row per model id: whether it takes reference images at all ('none' | 'optional' |
// 'required' — flux-2-pro has no text-to-image mode, it always edits/composites from refs),
// and the max it accepts before extras are dropped (matches how these models themselves behave
// when handed more than their limit). Checked live against segmind.com/models/<slug>/api.
//
// Every row now carries a max, because the compiled prompt numbers its references ("Reference
// image 1...") and a nameless drop makes that numbering point at images the provider never
// received. Provenance, since the Segmind pages don't all state a limit:
//   gpt-image-2 16       OpenAI's own edits endpoint caps input images at 16; Segmind is silent.
//   nano-banana-pro 14   stated verbatim on the Segmind page ("accepts up to 14 images").
//   nano-banana-2-lite 14, seedream-5-pro 10, reve-2 8, qwen-image-3 3, grok-imagine-image-2 3
//                        all stated verbatim on their Segmind pages.
//   flux-2-pro 8         Black Forest Labs' FLUX.2 editing docs cap it at 8; Segmind is silent.
const REF_MODE = {
  'gpt-image-2.5':        { mode: 'optional', max: 16 }, // same OpenAI edits cap as gpt-image-2
  'gpt-image-2':          { mode: 'optional', max: 16 },
  'nano-banana-pro':      { mode: 'optional', max: 14 },
  'nano-banana-2':        { mode: 'optional', max: 14 },
  'nano-banana-2-lite':   { mode: 'optional', max: 14 },
  'seedream-5-pro':       { mode: 'optional', max: 10 },
  'flux-2-pro':           { mode: 'required', max: 8 },
  'qwen-image-3':         { mode: 'optional', max: 3 },
  'reve-2':               { mode: 'optional', max: 8 },
  'grok-imagine-image-2': { mode: 'optional', max: 3 },
  'ideogram-v4-fast':     { mode: 'none' },
};

// Enforces each model's reference-image contract BEFORE any upload or request — a model with no
// image input at all being handed refs, or a refs-required model (flux-2-pro) handed none, fails
// here with no Segmind spend and no R2 presign work wasted. Extras beyond a model's max are
// dropped rather than erroring, matching provider behavior for over-supplying refs, but the drop
// is named loudly: the prompt numbers its references, so a silent drop leaves the brief talking
// about images the model was never sent.
function checkRefs(model, refs) {
  const r = REF_MODE[model];
  if (r.mode === 'none' && refs.length)
    die(`${model} is text-to-image only (no reference-image input) — remove the reference(s) or pick another model.`);
  if (r.mode === 'required' && !refs.length)
    die(`${model} needs at least one reference image (it has no text-to-image mode) — attach a reference or pick another model.`);
  if (r.max && refs.length > r.max) {
    const label = (p) => basename(String(p).split('?')[0]);
    console.error(`WARN: ${model} accepts at most ${r.max} reference images, sending the first ${r.max} of ${refs.length}.`);
    console.error(`WARN: dropped ${refs.slice(r.max).map(label).join(', ')}. The prompt's "Reference image N" lines past ${r.max} now describe images the model never sees.`);
    return refs.slice(0, r.max);
  }
  return refs;
}

// Seedream 5 Pro: fixed aspect_ratio enum (no 4:5/5:4) and 1K/2K only (no 4K master).
const SEEDREAM_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'];
function seedreamSize(aspect, resolution) {
  if (!SEEDREAM_ASPECTS.includes(aspect)) die(`Seedream 5 Pro supports aspect ratios ${SEEDREAM_ASPECTS.join(', ')} (got ${aspect}).`);
  if (resolution === '4K') die('Seedream 5 Pro renders at 1K/2K only (no 4K master) — pick 2K or another model.');
  return resolution === '2K' ? '2K' : '1K';
}

// Nano Banana 2 Lite: Segmind's own docs state only "1K" output is supported at all.
function nanoBanana2LiteCheck(resolution) {
  if (resolution !== '1K') die('Nano Banana 2 Lite renders at 1K only (no 2K/4K master) — pick another model for masters.');
}

// Qwen Image 3: discrete "W*H" sizes (asterisk, not "x"), no free aspect_ratio field.
const QWEN_SIZES = {
  '1:1': { '1K': '1024*1024', '2K': '2048*2048', '4K': '2048*2048' },
  '3:4': { '1K': '768*1024', '2K': '1080*1440', '4K': '1080*1440' },
  '4:3': { '1K': '1024*768', '2K': '1440*1080', '4K': '1440*1080' },
};
function qwenSize(aspect, resolution) {
  const row = QWEN_SIZES[aspect];
  if (!row) die(`Qwen Image 3 supports aspect ratios ${Object.keys(QWEN_SIZES).join(', ')} (got ${aspect}).`);
  return row[resolution] || row['1K'];
}

// Grok Imagine Image 2: resolution enum is "1k"/"2k" only (no 4K master).
function grokResolution(resolution) {
  if (resolution === '4K') die('Grok Imagine Image 2 renders at 1K/2K only (no 4K master) — pick 2K or another model.');
  return resolution === '2K' ? '2k' : '1k';
}

// Ideogram V4 Fast: a discrete "WxH" resolution enum stands in for aspect_ratio (no separate
// aspect field exists on this model at all). Table holds the enum values confirmed verbatim
// against segmind.com/models/ideogram-v4-fast/api; the model's full 23-value enum wasn't fully
// enumerable there, so only the aspect ratios Ad Harness actually uses are wired — extend this
// table (don't guess a WxH string) if another aspect is needed.
const IDEOGRAM_RESOLUTIONS = { '1:1': '2048x2048', '4:5': '1792x2240', '5:4': '2240x1792', '9:16': '1440x2560', '16:9': '2560x1440' };
function ideogramResolution(aspect) {
  const r = IDEOGRAM_RESOLUTIONS[aspect];
  if (!r) die(`Ideogram V4 Fast supports aspect ratios ${Object.keys(IDEOGRAM_RESOLUTIONS).join(', ')} (got ${aspect}).`);
  return r;
}

// Build the Segmind request body. Each branch uses that model's real parameter names, verified
// against segmind.com/models/<slug>/api on 2026-08-24. checkRefs() has already run, so refUrls is
// always contract-valid for the model (right mode, capped to max).
function segmindImageInput(model, { prompt, aspect, resolution, format, quality, negative, refUrls }) {
  if (model === 'nano-banana-pro') {
    const input = {
      prompt,
      aspect_ratio: aspect, // same "W:H" shape Ad Harness already uses — Segmind's enum matches
      output_resolution: resolution, // "1K"/"2K"/"4K" — matches Segmind's enum verbatim
      output_format: format === 'jpg' ? 'jpg' : 'png',
    };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'nano-banana-2-lite') {
    nanoBanana2LiteCheck(resolution);
    const input = { prompt, aspect_ratio: aspect, output_resolution: '1K', output_format: format === 'jpg' ? 'jpg' : 'png' };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'seedream-5-pro') {
    const input = { prompt, aspect_ratio: aspect, size: seedreamSize(aspect, resolution), output_format: format === 'jpg' ? 'jpeg' : 'png' };
    if (refUrls.length) input.image_input = refUrls; // Seedream's own field name, not image_urls
    return input;
  }
  if (model === 'flux-2-pro') {
    // No aspect_ratio/size field on this model — explicit width/height integers instead.
    // checkRefs already guaranteed refUrls.length >= 1 (this model has no text-to-image mode).
    const [w, h] = sizeForTier(aspect, resolution).split('x').map(Number);
    return { prompt, image_urls: refUrls, width: w, height: h, output_format: format === 'jpg' ? 'jpeg' : 'png' };
  }
  if (model === 'qwen-image-3') {
    // Three individual URI fields (image/image2/image3), not an array field.
    // prompt_extend defaults to true here, which runs the brief through a rewriter before
    // generation. Ad Harness always sends a fully composed brief whose literal on-image copy has
    // to survive character for character, so a rewrite can only cost fidelity. Off.
    // negative_prompt is the only true negative field of any model here, so it is wired here alone.
    const input = { prompt, size: qwenSize(aspect, resolution), prompt_extend: false };
    if (negative) input.negative_prompt = negative;
    if (refUrls[0]) input.image = refUrls[0];
    if (refUrls[1]) input.image2 = refUrls[1];
    if (refUrls[2]) input.image3 = refUrls[2];
    return input;
  }
  if (model === 'reve-2') {
    // No resolution/size field on this model at all — it always renders at its own fixed high
    // resolution, so a requested tier other than 1K isn't a downgrade, just a no-op here.
    const input = { prompt, aspect_ratio: aspect };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'grok-imagine-image-2') {
    const input = { prompt, aspect_ratio: aspect, resolution: grokResolution(resolution), output_format: format === 'jpg' ? 'jpeg' : 'png' };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'ideogram-v4-fast') {
    // Text-to-image only — checkRefs already guaranteed refUrls is empty; no ref field to send.
    // rendering_speed is a price tier, so it stays on Segmind's DEFAULT unless the caller opts
    // in: Ideogram's own docs recommend QUALITY for text-heavy designs, which every ad here is.
    const input = { prompt, resolution: ideogramResolution(aspect) };
    if (quality === 'high') input.rendering_speed = 'QUALITY';
    else if (quality === 'low') input.rendering_speed = 'TURBO';
    return input;
  }
  // gpt-image-2 / gpt-image-2.5 (Flare): always png (no --format). Same shape but for the size field.
  const size = model === 'gpt-image-2.5' ? flareSize(aspect, resolution) : { size: segmindImageSize(aspect, resolution) };
  const input = { prompt, ...size, quality: quality || 'medium', output_format: 'png', output_compression: 100 };
  if (refUrls.length) input.image_urls = refUrls;
  return input;
}

// Segmind provider: dispatches to the per-model builder above. Models without a Segmind id
// (nano-banana-2, raw ids) fail here rather than silently rendering as another model.
async function viaSegmind({ model, prompt, refsIn, aspect, resolution, format, quality, negative, num, out, timeout }) {
  const slug = MODELS[model]?.segmind;
  if (!slug) throw userError(`${model} has no Segmind equivalent — use --provider gateway for this model.`);
  const capped = checkRefs(model, refsIn); // fails fast, before any upload or spend
  const refUrls = [];
  // Sequential on purpose: refUrls must come out in the order the caller passed them, because
  // the prompt refers to each reference by its position in this array.
  for (const r of capped) refUrls.push(await presignRef(r, out));
  const input = segmindImageInput(model, { prompt, aspect, resolution, format, quality, negative, refUrls });
  const results = await Promise.all(Array.from({ length: num }, () => segmindJob(slug, input, timeout)));
  return { results, provider: 'segmind' };
}

// kie.ai provider. The ref cap applies on the fallback path too: the prompt was compiled against
// the model's reference limit, so a failover must send the same images.
async function viaKie({ model, prompt, refsIn, aspect, resolution, format, num, timeout }) {
  const m = KIE_SHAPE[model];
  if (!m || !MODELS[model]?.kie) throw userError(`${model} has no kie.ai equivalent — use --provider segmind for this model.`);
  const refUrls = [];
  for (const r of checkRefs(model, refsIn)) refUrls.push(await kieUpload(r)); // sequential: clearer logs, order preserved
  const input = { prompt, aspect_ratio: aspect };
  if (m.resolution) input.resolution = resolution;
  if (m.format) input.output_format = format;
  if (refUrls.length) input[m.imageField] = refUrls;
  const id = m.variants ? `${MODELS[model].kie}-${refUrls.length ? 'image-to-image' : 'text-to-image'}` : MODELS[model].kie;
  const groups = await Promise.all(Array.from({ length: num }, () => kieJob(id, input, timeout, 2000)));
  return { results: groups.flat(), provider: 'kie' };
}

// Refs for the Gateway: local files downscaled to <=2048 long edge (sips on macOS, else ffmpeg,
// else the original) and sent inline; http(s) URLs pass through as strings.
async function inlineRefs(refs) {
  const images = [];
  for (const r of refs) {
    if (/^https?:\/\//i.test(r)) { images.push(r); continue; }
    const abs = resolve(r);
    if (!existsSync(abs)) die(`reference not found: ${r}`);
    const tmp = join(tmpdir(), `gwref_${images.length}_${basename(abs)}.png`);
    try {
      if (findBin('sips')) await exec('sips', ['-s', 'format', 'png', '-Z', '2048', abs, '--out', tmp]);
      else if (findBin('ffmpeg')) await exec(findBin('ffmpeg'), ['-y', '-i', abs, '-vf', "scale=w='min(iw,2048)':h='min(ih,2048)':force_original_aspect_ratio=decrease", tmp]);
      else throw new Error('no resize tool');
      images.push(await readFile(tmp));
    }
    catch { images.push(await readFile(abs)); }
  }
  return images;
}

// Vercel AI Gateway provider. Image models go through generateImage (size-driven models get an
// exact /16 pixel size from the tier; others get the aspect ratio); Gemini "Nano Banana" models are
// language models on the Gateway, so they go through generateText with image output, one call per
// variation. maxRetries 0: a retry after an ambiguous failure would be a second paid generation.
async function viaGateway({ model, prompt, refsIn, aspect, resolution, quality, num, timeout }) {
  const { gateway: id, kind } = modelEntry(model, 'image');
  const gateway = { id, kind };
  const capped = REF_MODE[model] ? checkRefs(model, refsIn) : refsIn; // fails fast, before any spend
  if (model === 'seedream-5-pro') seedreamSize(aspect, resolution);
  if (model === 'nano-banana-2-lite') nanoBanana2LiteCheck(resolution);
  const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
  const images = await inlineRefs(capped).catch((e) => { throw preSubmit(e); });
  const blobs = []; // { bytes, mediaType } — saveResults picks the extension (png if unknown)
  if (gateway.kind === 'text-image') {
    console.error(`gateway   ${gateway.id} ${images.length ? 'edit' : 'generate'}  aspect=${aspect}  size=${resolution}  refs=${images.length}`);
    const content = [...images.map((image) => ({ type: 'image', image })), { type: 'text', text: prompt }];
    const runs = await Promise.all(Array.from({ length: num }, () => ai.generateText({
      model: gw(gateway.id),
      messages: [{ role: 'user', content }],
      providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: resolution } } },
      maxRetries: 0,
    })));
    for (const r of runs) {
      logGatewayWarnings(r.warnings);
      const files = r.files.filter((f) => f.mediaType?.startsWith('image/'));
      if (!files.length) throw new Error(`${gateway.id} returned no image${r.text ? `: ${r.text.slice(0, 200)}` : ''}`);
      for (const f of files) blobs.push({ bytes: f.uint8Array, mediaType: f.mediaType });
    }
  } else {
    const sized = /^(openai|bfl|bytedance)\//.test(gateway.id);
    const size = sized ? sizeForTier(aspect, resolution) : undefined;
    console.error(`gateway   ${gateway.id} ${images.length ? 'edit' : 'generate'}  ${size ? `size=${size}` : `aspect=${aspect}`}  refs=${images.length}`);
    const res = await ai.generateImage({
      model: gw.imageModel(gateway.id),
      prompt: images.length ? { images, text: prompt } : prompt,
      n: num,
      ...(size ? { size } : { aspectRatio: aspect }),
      ...(quality && gateway.id.startsWith('openai/') ? { providerOptions: { openai: { quality } } } : {}),
      maxRetries: 0,
    });
    logGatewayWarnings(res.warnings);
    for (const im of res.images) blobs.push({ bytes: Buffer.from(im.base64, 'base64'), mediaType: im.mediaType });
  }
  return { results: blobs, provider: 'gateway' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['ref'] });
  args.ref ||= [];
  if (args.help || (!args.prompt && !args['prompt-file'] && !args.record)) { console.log(HELP); process.exit(args.help ? 0 : 1); }

  // Record-driven mode: read prompt/refs/params from a per-ad record; stamp the payload + output back.
  let record = null, recordPath = null;
  if (args.record) { recordPath = resolve(args.record); record = JSON.parse(await readFile(recordPath, 'utf8')); }
  const g = (record && record.generation) || {};

  const out = args.out || g.output;
  if (!out) die('--out is required (or record.generation.output)');

  const { W, keys } = workspaceKeys([out, recordPath, args['prompt-file'], ...args.ref], '--out/--record');

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim()
    : args.prompt != null ? String(args.prompt)
    : g.prompt != null ? String(g.prompt) : '';
  if (!prompt) die('prompt is empty (pass --prompt/--prompt-file or a record with generation.prompt)');

  // A record's stamped provider is where the last take ran, not a pin: re-runs route afresh unless
  // --provider is passed. A stamped provider id (e.g. openai/gpt-image-2) maps back to its name.
  const provider = String(args.provider || 'auto').toLowerCase();
  const modelArg = String(args.model || g.model || 'gpt-image-2.5');
  const entry = modelEntry(modelArg, 'image');
  const model = entry && (REF_MODE[entry.name] || !MODELS[entry.name]) ? entry.name : 'gpt-image-2.5';
  if (model !== entry?.name) console.error(`WARN: unknown --model "${modelArg}" — using gpt-image-2.5.`);
  const aspect = String(args.aspect || g.aspect || '4:5').replace('x', ':');
  const resolution = String(args.resolution || g.resolution || '1K').toUpperCase();
  const format = String(args.format || g.format || 'png').toLowerCase();
  const quality = String(args.quality || g.quality || (['gpt-image-2.5', 'gpt-image-2'].includes(model) ? 'medium' : '')).toLowerCase() || null;
  if (quality && !['low', 'medium', 'high', 'auto'].includes(quality)) die(`--quality must be low|medium|high|auto (got "${quality}")`);
  // gpt-image-2 maps it to its own `quality`; ideogram-v4-fast maps high/low to its
  // rendering_speed tier. No other model has a comparable knob.
  const QUALITY_MODELS = ['gpt-image-2.5', 'gpt-image-2', 'ideogram-v4-fast'];
  if (quality && args.quality && !QUALITY_MODELS.includes(model) && !String(model).startsWith('openai/'))
    console.error(`WARN: --quality applies only to gpt-image-2.5 / gpt-image-2 and Segmind ideogram-v4-fast (model=${model}) — ignored.`);
  // Only qwen-image-3 exposes a real negative_prompt; anywhere else this is accepted and ignored.
  const negative = String((args.negative !== true && args.negative) || g.negative || '').trim();
  if (negative && model !== 'qwen-image-3')
    console.error(`WARN: --negative applies only to qwen-image-3 (model=${model}) — ignored. Put exclusions in the prompt instead.`);
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '300', 10);
  const refsIn = args.ref.length ? args.ref : (Array.isArray(g.refs) ? g.refs : []);

  const opts = { model, prompt, refsIn, aspect, resolution, format, quality, negative, num, out, timeout };
  const plan = planRoute({ model, provider, keys, ws: W, kind: 'image', blockers: { kie: kieBlocker(model, aspect) } });
  const ran = await runRoute(plan, { gateway: () => viaGateway(opts), segmind: () => viaSegmind(opts), kie: () => viaKie(opts) }, W);
  const saved = await saveResults(ran.results, out, { fallbackExt: 'png', transform: cleanImage });
  await writeSidecars(saved, {
    tool: 'generate-image', model, provider: ran.provider, prompt,
    params: { aspect, resolution, quality: ran.provider === 'kie' ? null : quality, negative: model === 'qwen-image-3' ? negative : null, format: format === 'png' ? null : format },
    refs: refsIn.slice(0, REF_MODE[model]?.max).map((path) => ({ role: 'ref', path })), // as sent: capped like checkRefs
  });

  // Stamp the actual payload + output back into the record (its source of truth).
  if (record) {
    record.generation = {
      ...g, provider: ran.provider, model, aspect, resolution, ...(quality ? { quality } : {}),
      ...(negative ? { negative } : {}),
      prompt, refs: refsIn, output: saved[0], outputs: saved, generatedAt: new Date().toISOString(),
    };
    delete record.generation.size; // strip any stale value the ...g spread carried over from an older record
    record.status = 'generated';
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
    console.error('record    updated ' + recordPath);
  }
}

main().catch((e) => die(errorText(e)));
