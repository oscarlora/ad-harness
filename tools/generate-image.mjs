#!/usr/bin/env node
// generate-image.mjs — generate image ads via Segmind, kie.ai or the Vercel AI Gateway.
// Which provider carries which model: tools/lib/providers.mjs (MODELS) — change it there.
// Saved files are stripped of metadata (C2PA, EXIF, XMP) and get a <stem>.gen.json sidecar.
// The AI SDK loads only when the Gateway runs.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanImage } from './lib/clean-image.mjs';
import { applyEnv, die, imageFitCmd, parseArgs, runAsync, usage } from './lib/catalog.mjs';
import {
  MODELS, PROVIDER_ORDER, errorText, gatewayClient, kieJob, kieUpload, logGatewayWarnings, modelEntry, planRoute, presignRef,
  preSubmit, runRoute, saveResults, segmindJob, times, userError, workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-image.mjs — image ad generator. Providers in order: ${PROVIDER_ORDER.join(' -> ')}

  node tools/generate-image.mjs --record workspaces/<WS>/Acme/outputs/json/3.json
  node tools/generate-image.mjs --prompt "<text>" --ref "<img>" --out "<path>.png"

Required (or --record):
  --prompt "<text>"        Inline prompt, OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output image path
  --record <path>          Per-ad record (outputs/json/<id>.json): supplies prompt/refs/params and is
                           stamped with what was sent + the output

Optional:
  --provider <name>        auto (default) | segmind | kie | gateway (vercel = gateway). auto tries each
                           provider with the model and a <WS>_ key, moving on only if one rejects
                           the request before generating
  --ref <path|url>         Reference image (repeatable, order kept: --ref N = reference image N)
  --model <name>           gpt-image-2.5 (default) | gpt-image-2 | nano-banana-pro | nano-banana-2 |
                           nano-banana-2-lite | seedream-5-pro | flux-2-pro | grok-imagine-image-2 |
                           qwen-image-3 | reve-2 | ideogram-v4-fast | a raw Gateway id (e.g. openai/gpt-image-2)
                           Segmind: all but nano-banana-2. kie: gpt-image-2.5 (no 4:5/5:4), gpt-image-2,
                           nano-banana-pro, nano-banana-2-lite. Gateway: all but qwen-image-3, reve-2,
                           ideogram-v4-fast.
  --aspect <ratio>         4:5 (default; 4x5 also works). Unsupported ratios fail with the allowed list
  --resolution <res>       1K (default) | 2K | 4K. Unsupported tiers fail fast
  --quality <q>            low | medium (default) | high | auto. gpt-image-2.5 / gpt-image-2 (not on kie);
                           ideogram-v4-fast on Segmind: high = QUALITY, low = TURBO
  --negative "<text>"      Things to keep out. qwen-image-3 only; elsewhere put it in the prompt
  --num <n>                Variations (default 1)
  --format <ext>           png (default) | jpg. Segmind: nano-banana-pro, nano-banana-2-lite,
                           seedream-5-pro, flux-2-pro, grok-imagine-image-2; kie: nano-banana-pro;
                           Gateway: the model's native format
  --timeout <seconds>      Max wait per task (default 300)

Reference images: flux-2-pro needs at least one; ideogram-v4-fast takes none; the rest are optional.
  Caps: gpt-image-2.5 / gpt-image-2 16, nano-banana-* 14, seedream-5-pro 10, flux-2-pro / reve-2 8,
  qwen-image-3 / grok-imagine-image-2 3. Extras are dropped with a WARN.

Env: <WORKSPACE>_SEGMIND_API_KEY, <WORKSPACE>_KIE_API_KEY, <WORKSPACE>_AI_GATEWAY_API_KEY; the
workspace comes from the --out/--record path.`;

// kie.ai request shapes; a model missing here fails rather than rendering as another model.
// variants = separate -text-to-image / -image-to-image endpoints.
const KIE_SHAPE = {
  'gpt-image-2.5':      { variants: true, imageField: 'input_urls', resolution: true },
  'gpt-image-2':        { variants: true, imageField: 'input_urls', resolution: true },
  'nano-banana-pro':    { imageField: 'image_input', resolution: true, format: true },
  'nano-banana-2-lite': { imageField: 'image_urls' },
};

// Segmind's exact size presets: GPT Image 2 per tier and aspect; Qwen Image 3 ("*", not "x") and
// Ideogram V4 Fast (no aspect field: the size sets it) per aspect. Add sizes from Segmind's docs, never guessed.
const GPT_IMAGE_2_SIZES = {
  '1K': { '1:1':'1024x1024', '4:5':'832x1040', '5:4':'1040x832', '3:4':'768x1024', '4:3':'1024x768', '9:16':'720x1280', '16:9':'1280x720' },
  '2K': { '1:1':'1536x1536', '4:5':'1600x2000', '5:4':'2000x1600', '3:4':'1536x2048', '4:3':'2048x1536', '9:16':'1152x2048', '16:9':'2048x1152' },
  '4K': { '1:1':'2880x2880', '4:5':'2560x3200', '5:4':'3200x2560', '3:4':'2480x3312', '4:3':'3312x2480', '9:16':'2160x3840', '16:9':'3840x2160' },
};
const QWEN_SIZES = {
  '1:1': { '1K': '1024*1024', '2K': '2048*2048', '4K': '2048*2048' },
  '3:4': { '1K': '768*1024', '2K': '1080*1440', '4K': '1080*1440' },
  '4:3': { '1K': '1024*768', '2K': '1440*1080', '4K': '1440*1080' },
};
const IDEOGRAM_SIZES = { '1:1': '2048x2048', '4:5': '1792x2240', '5:4': '2240x1792', '9:16': '1440x2560', '16:9': '2560x1440' };

// Per model: the most reference images sent (0 = none taken; needsRef = at least one), and the aspects
// and tiers it renders — on every provider, or only on `segmind` / `kie`. gpt-image-2 and flux-2-pro
// ref caps come from OpenAI's and FLUX.2's docs (not on Segmind's pages).
const IMAGE_MODELS = {
  'gpt-image-2.5':        { refs: 16, kie: { aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] } },
  'gpt-image-2':          { refs: 16, segmind: { aspects: Object.keys(GPT_IMAGE_2_SIZES['1K']) } },
  'nano-banana-pro':      { refs: 14 },
  'nano-banana-2':        { refs: 14 },
  'nano-banana-2-lite':   { refs: 14, tiers: ['1K'] },
  'seedream-5-pro':       { refs: 10, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], tiers: ['1K', '2K'] },
  'flux-2-pro':           { refs: 8, needsRef: true },
  'qwen-image-3':         { refs: 3, aspects: Object.keys(QWEN_SIZES) },
  'reve-2':               { refs: 8 },
  'grok-imagine-image-2': { refs: 3, segmind: { tiers: ['1K', '2K'] } },
  'ideogram-v4-fast':     { refs: 0, aspects: Object.keys(IDEOGRAM_SIZES) },
};
const TIERS = ['1K', '2K', '4K'];
// Why these limits rule out the aspect or tier, or null.
const offLimits = (model, { aspects, tiers } = {}, aspect, tier) =>
  aspects && !aspects.includes(aspect) ? `${model} takes --aspect ${aspects.join(', ')}, not ${aspect}`
  : tiers && !tiers.includes(tier) ? `${model} renders at ${tiers.join('/')} only, not ${tier}` : null;

// Long edge from the tier, short edge from the aspect, both multiples of 16 (the models require it).
function sizeForTier(aspect, tier) {
  const [a, b] = aspect.split(':').map(Number);
  const long = { '1K': 1280, '2K': 2048, '4K': 3840 }[tier];
  const r16 = (n) => Math.max(16, Math.round(n / 16) * 16);
  return b >= a ? `${r16(long * a / b)}x${long}` : `${long}x${r16(long * b / a)}`;
}

// Segmind GPT Image 2.5 Flare: edges /16, at most 8,294,400 pixels.
function flareSize(aspect, tier) {
  let [w, h] = sizeForTier(aspect, tier).split('x').map(Number);
  const s = Math.sqrt(8294400 / (w * h));
  if (s < 1) [w, h] = [Math.floor(w * s / 16) * 16, Math.floor(h * s / 16) * 16];
  return { width: w, height: h };
}

// Runs before any upload or spend. Drops are named loudly: the prompt numbers its references.
function checkRefs(model, refs) {
  const { refs: max, needsRef } = IMAGE_MODELS[model];
  if (!max && refs.length)
    die(`${model} is text-to-image only (no reference-image input) — remove the reference(s) or pick another model.`);
  if (needsRef && !refs.length)
    die(`${model} needs at least one reference image (it has no text-to-image mode) — attach a reference or pick another model.`);
  if (refs.length > max) {
    const label = (p) => basename(String(p).split('?')[0]);
    console.error(`WARN: ${model} accepts at most ${max} reference images, sending the first ${max} of ${refs.length}.`);
    console.error(`WARN: dropped ${refs.slice(max).map(label).join(', ')}. The prompt's "Reference image N" lines past ${max} now describe images the model never sees.`);
    return refs.slice(0, max);
  }
  return refs;
}

// Segmind request body, in each model's own parameter names. refUrls is already checked.
function segmindImageInput(model, { prompt, aspect, resolution, format, quality, negative, refUrls }) {
  if (model === 'nano-banana-pro') {
    const input = {
      prompt,
      aspect_ratio: aspect,
      output_resolution: resolution,
      output_format: format === 'jpg' ? 'jpg' : 'png',
    };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'nano-banana-2-lite') {
    const input = { prompt, aspect_ratio: aspect, output_resolution: '1K', output_format: format === 'jpg' ? 'jpg' : 'png' };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'seedream-5-pro') {
    const input = { prompt, aspect_ratio: aspect, size: resolution, output_format: format === 'jpg' ? 'jpeg' : 'png' };
    if (refUrls.length) input.image_input = refUrls;
    return input;
  }
  if (model === 'flux-2-pro') {
    const [w, h] = sizeForTier(aspect, resolution).split('x').map(Number);
    return { prompt, image_urls: refUrls, width: w, height: h, output_format: format === 'jpg' ? 'jpeg' : 'png' };
  }
  if (model === 'qwen-image-3') {
    // prompt_extend rewrites the prompt and would mangle the on-image copy.
    const input = { prompt, size: QWEN_SIZES[aspect][resolution], prompt_extend: false };
    if (negative) input.negative_prompt = negative;
    if (refUrls[0]) input.image = refUrls[0];
    if (refUrls[1]) input.image2 = refUrls[1];
    if (refUrls[2]) input.image3 = refUrls[2];
    return input;
  }
  if (model === 'reve-2') {
    // No resolution field: it renders at its own fixed resolution.
    const input = { prompt, aspect_ratio: aspect };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'grok-imagine-image-2') {
    const input = { prompt, aspect_ratio: aspect, resolution: resolution.toLowerCase(), output_format: format === 'jpg' ? 'jpeg' : 'png' };
    if (refUrls.length) input.image_urls = refUrls;
    return input;
  }
  if (model === 'ideogram-v4-fast') {
    // rendering_speed is a price tier: DEFAULT unless --quality high/low.
    const input = { prompt, resolution: IDEOGRAM_SIZES[aspect] };
    if (quality === 'high') input.rendering_speed = 'QUALITY';
    else if (quality === 'low') input.rendering_speed = 'TURBO';
    return input;
  }
  // gpt-image-2 / gpt-image-2.5: always png.
  const size = model === 'gpt-image-2.5' ? flareSize(aspect, resolution) : { size: GPT_IMAGE_2_SIZES[resolution][aspect] };
  const input = { prompt, ...size, quality: quality || 'medium', output_format: 'png', output_compression: 100 };
  if (refUrls.length) input.image_urls = refUrls;
  return input;
}

async function viaSegmind({ model, prompt, refs, aspect, resolution, format, quality, negative, num, out, timeout }) {
  const slug = MODELS[model]?.segmind;
  if (!slug) throw userError(`${model} has no Segmind equivalent — use --provider gateway for this model.`);
  const refUrls = [];
  // Sequential: the prompt refers to each reference by its position.
  for (const r of refs) refUrls.push(await presignRef(r, out));
  const input = segmindImageInput(model, { prompt, aspect, resolution, format, quality, negative, refUrls });
  return times(num, () => segmindJob(slug, input, timeout));
}

async function viaKie({ model, prompt, refs, aspect, resolution, format, num, timeout }) {
  const m = KIE_SHAPE[model];
  if (!m || !MODELS[model]?.kie) throw userError(`${model} has no kie.ai equivalent — use --provider segmind for this model.`);
  const refUrls = [];
  for (const r of refs) refUrls.push(await kieUpload(r)); // sequential: order preserved
  const input = { prompt, aspect_ratio: aspect };
  if (m.resolution) input.resolution = resolution;
  if (m.format) input.output_format = format;
  if (refUrls.length) input[m.imageField] = refUrls;
  const id = m.variants ? `${MODELS[model].kie}-${refUrls.length ? 'image-to-image' : 'text-to-image'}` : MODELS[model].kie;
  return times(num, () => kieJob(id, input, timeout, 2000));
}

// Local refs are downscaled to <=2048 and sent inline (the original when that fails); URLs pass through.
async function inlineRefs(refs) {
  const tmp = mkdtempSync(join(tmpdir(), 'gwref-'));
  try {
    const images = [];
    for (const [i, r] of refs.entries()) {
      if (/^https?:\/\//i.test(r)) { images.push(r); continue; }
      const abs = resolve(r), small = join(tmp, `${i}.png`);
      if (!existsSync(abs)) throw userError(`reference not found: ${r}`);
      const [bin, args] = imageFitCmd(abs, 2048, small);
      const ok = (await runAsync(bin, args, { allowFail: true })).status === 0 && existsSync(small);
      images.push(await readFile(ok ? small : abs));
    }
    return images;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// Gemini "Nano Banana" models are language models on the Gateway: generateText with image output.
// maxRetries 0: a retry after an ambiguous failure would be a second paid generation.
async function viaGateway({ model, prompt, refs, aspect, resolution, quality, num, timeout }) {
  const { gateway: id, kind } = modelEntry(model, 'image');
  const gateway = { id, kind };
  const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
  const images = await inlineRefs(refs).catch((e) => { throw preSubmit(e); });
  const blobs = []; // { bytes, mediaType }
  if (gateway.kind === 'text-image') {
    console.error(`gateway   ${gateway.id} ${images.length ? 'edit' : 'generate'}  aspect=${aspect}  size=${resolution}  refs=${images.length}`);
    const content = [...images.map((image) => ({ type: 'image', image })), { type: 'text', text: prompt }];
    const runs = await times(num, () => ai.generateText({
      model: gw(gateway.id),
      messages: [{ role: 'user', content }],
      providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: resolution } } },
      maxRetries: 0,
    }));
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
  return blobs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { repeat: ['ref'], help: HELP });
  args.ref ||= [];
  if (!args.prompt && !args['prompt-file'] && !args.record) usage(HELP);

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

  // A record's stamped provider is not a pin: re-runs route afresh unless --provider is passed.
  const provider = String(args.provider || 'auto').toLowerCase();
  const modelArg = String(args.model || g.model || 'gpt-image-2.5');
  const entry = modelEntry(modelArg, 'image');
  const model = entry && (IMAGE_MODELS[entry.name] || !MODELS[entry.name]) ? entry.name : 'gpt-image-2.5';
  if (model !== entry?.name) console.error(`WARN: unknown --model "${modelArg}" — using gpt-image-2.5.`);
  const aspect = String(args.aspect || g.aspect || '4:5').replace('x', ':');
  const resolution = String(args.resolution || g.resolution || '1K').toUpperCase();
  if (!TIERS.includes(resolution)) die(`--resolution must be ${TIERS.join(' | ')} (got "${resolution}")`);
  const format = String(args.format || g.format || 'png').toLowerCase();
  const quality = String(args.quality || g.quality || (['gpt-image-2.5', 'gpt-image-2'].includes(model) ? 'medium' : '')).toLowerCase() || null;
  if (quality && !['low', 'medium', 'high', 'auto'].includes(quality)) die(`--quality must be low|medium|high|auto (got "${quality}")`);
  const QUALITY_MODELS = ['gpt-image-2.5', 'gpt-image-2', 'ideogram-v4-fast'];
  if (quality && args.quality && !QUALITY_MODELS.includes(model) && !String(model).startsWith('openai/'))
    console.error(`WARN: --quality applies only to gpt-image-2.5 / gpt-image-2 and Segmind ideogram-v4-fast (model=${model}) — ignored.`);
  const negative = String((args.negative !== true && args.negative) || g.negative || '').trim();
  if (negative && model !== 'qwen-image-3')
    console.error(`WARN: --negative applies only to qwen-image-3 (model=${model}) — ignored. Put exclusions in the prompt instead.`);
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '300', 10);
  const refsIn = args.ref.length ? args.ref : (Array.isArray(g.refs) ? g.refs : []);
  const limits = IMAGE_MODELS[model] || {}; // a raw Gateway id has none
  const refs = IMAGE_MODELS[model] ? checkRefs(model, refsIn) : refsIn;
  const why = offLimits(model, limits, aspect, resolution);
  if (why) die(`${why} — pick another model.`);

  const opts = { model, prompt, refs, aspect, resolution, format, quality, negative, num, out, timeout };
  const blockers = { kie: offLimits(model, limits.kie, aspect, resolution), segmind: offLimits(model, limits.segmind, aspect, resolution) };
  const plan = planRoute({ model, provider, keys, ws: W, kind: 'image', blockers });
  const ran = await runRoute(plan, { gateway: () => viaGateway(opts), segmind: () => viaSegmind(opts), kie: () => viaKie(opts) }, W);
  const saved = await saveResults(ran.results, out, { fallbackExt: 'png', transform: cleanImage });
  await writeSidecars(saved, {
    tool: 'generate-image', model, provider: ran.provider, prompt,
    params: { aspect, resolution, quality: ran.provider === 'kie' ? null : quality, negative: model === 'qwen-image-3' ? negative : null, format: format === 'png' ? null : format },
    refs: refs.map((path) => ({ role: 'ref', path })),
  });

  if (record) {
    record.generation = {
      ...g, provider: ran.provider, model, aspect, resolution, ...(quality ? { quality } : {}),
      ...(negative ? { negative } : {}),
      prompt, refs: refsIn, output: saved[0], outputs: saved, generatedAt: new Date().toISOString(),
    };
    record.status = 'pending-review';
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
    console.error('record    updated ' + recordPath);
  }
}

main().catch((e) => die(errorText(e)));
