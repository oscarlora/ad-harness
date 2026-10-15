#!/usr/bin/env node
// generate-image.mjs — generate image ads on kie.ai (models: tools/lib/providers.mjs MODELS).
// Saved files are stripped of metadata (C2PA, EXIF, XMP) and get a <stem>.gen.json sidecar.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanImage } from './lib/clean-image.mjs';
import { applyEnv, die, imageFitCmd, parseArgs, runAsync, usage } from './lib/catalog.mjs';
import {
  errorText, gatewayClient, kieJob, kieUploadAll, logGatewayWarnings, pickModel, runProviders, saveResults, times, userError,
  workspaceKeys, writeSidecars,
} from './lib/providers.mjs';

applyEnv();

const HELP = `generate-image.mjs — image ad generator (kie.ai)

  node tools/generate-image.mjs --record workspaces/<WS>/Acme/outputs/json/3.json
  node tools/generate-image.mjs --prompt "<text>" --ref "<img>" --out "<path>.png"

Required (or --record):
  --prompt "<text>"        Inline prompt (max 20,000 characters), OR
  --prompt-file <path>     Prompt from a file
  --out <path>             Output image path
  --record <path>          Per-ad record (outputs/json/<id>.json): supplies prompt/refs/params and is
                           stamped with what was sent + the output

Optional:
  --model <name>           gpt-image-2.5 (default; GPT Image 2.5 Flare) | nano-banana-2.1 (its fallback)
  --ref <path|url>         Reference image (repeatable, order kept: --ref N = reference image N).
                           Max 16 on gpt-image-2.5, 10 on nano-banana-2.1 (jpeg/png/webp, 30 MB);
                           extras are dropped with a WARN
  --aspect <ratio>         4:5 (default; 4x5 also works)
                           gpt-image-2.5: 1:1 3:2 2:3 4:3 3:4 16:9 9:16 21:9 auto, and 27:16 16:27 9:8
                             8:9 at 1K only. 4:5 / 5:4 render at 3:4 / 4:3 and are center-cropped (nothing else changes)
                           nano-banana-2.1: 1:1 2:3 3:2 1:4 4:1 3:4 4:3 4:5 5:4 1:8 8:1 9:16 16:9 21:9 auto
  --resolution <res>       1K (default) | 2K | 4K
  --background <b>         gpt-image-2.5: auto (default) | opaque | transparent
  --format <ext>           nano-banana-2.1: png (default) | jpg. gpt-image-2.5 returns png
  --num <n>                Variations (default 1)
  --timeout <seconds>      Max wait per task (default 300)
  --unlisted-model <id>    A kie model id outside the list, sent as-is with --model's request shape
                           and no checks. Only with the user's yes
  --provider kie|gateway   Force one. By default a request kie rejects before generating goes to the
                           AI Gateway when the workspace has <WS>_AI_GATEWAY_API_KEY

Env: <WORKSPACE>_KIE_API_KEY; the workspace comes from the --out/--record path.`;

// kie request limits per model, from the docs linked in MODELS.
const LIMITS = {
  'gpt-image-2.5': {
    refs: 16, aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', 'auto', '27:16', '16:27', '9:8', '8:9'],
    only1K: ['27:16', '16:27', '9:8', '8:9'],
  },
  'nano-banana-2.1': { refs: 10, aspects: ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9', 'auto'] },
};
const TIERS = ['1K', '2K', '4K'];
// gpt-image-2.5 on kie has no 4:5 / 5:4: render the nearest ratio, then center-crop to it.
const CROP = { '4:5': '3:4', '5:4': '4:3' };
const sentAspect = (shape, aspect) => (shape === 'gpt-image-2.5' && CROP[aspect]) || aspect;

// Lossless center crop of a saved image to `aspect` (w:h).
async function cropTo(path, aspect) {
  const [a, b] = aspect.split(':').map(Number);
  const tmp = path.replace(/(\.[^./]+)$/, '.crop$1');
  const vf = a < b ? `crop=iw:trunc(iw*${b}/${a}/2)*2` : `crop=trunc(ih*${a}/${b}/2)*2:ih`;
  if ((await runAsync('ffmpeg', ['-y', '-v', 'error', '-i', path, '-vf', vf, tmp], { allowFail: true })).status !== 0) throw userError(`could not crop ${path} to ${aspect}`);
  renameSync(tmp, path);
}

// Why kie can't take this aspect/tier, or null.
function kieBlocker(shape, aspect, tier) {
  const { aspects, only1K = [] } = LIMITS[shape];
  if (!aspects.includes(aspect)) return `takes --aspect ${aspects.join(' ')}, not ${aspect}`;
  if (only1K.includes(aspect) && tier !== '1K') return `renders ${aspect} at 1K only`;
  return null;
}

// Drops are named loudly: the prompt numbers its references.
function checkRefs(shape, refs) {
  const max = LIMITS[shape].refs;
  if (refs.length <= max) return refs;
  const label = (p) => basename(String(p).split('?')[0]);
  console.error(`WARN: ${shape} accepts at most ${max} reference images, sending the first ${max} of ${refs.length}.`);
  console.error(`WARN: dropped ${refs.slice(max).map(label).join(', ')}. The prompt's "Reference image N" lines past ${max} now describe images the model never sees.`);
  return refs.slice(0, max);
}

async function viaKie({ entry, prompt, refs, aspect, resolution, background, format, num, timeout }) {
  const refUrls = await kieUploadAll(refs);
  const input = { prompt, aspect_ratio: sentAspect(entry.shape || entry.name, aspect), resolution };
  let id = entry.kie;
  if ((entry.shape || entry.name) === 'gpt-image-2.5') {
    if (background) input.background = background;
    if (refUrls.length) input.input_urls = refUrls;
    if (!entry.unlisted) id += refUrls.length ? '-image-to-image' : '-text-to-image';
  } else {
    input.output_format = format;
    if (refUrls.length) input.image_input = refUrls;
  }
  return times(num, () => kieJob(id, input, timeout, 2000));
}

// Long edge from the tier, short edge from the aspect, both multiples of 16 (GPT Image needs it).
function sizeForTier(aspect, tier) {
  const [a, b] = aspect.split(':').map(Number);
  const long = { '1K': 1280, '2K': 2048, '4K': 3840 }[tier];
  const r16 = (n) => Math.max(16, Math.round(n / 16) * 16);
  return b >= a ? `${r16(long * a / b)}x${long}` : `${long}x${r16(long * b / a)}`;
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

// Gemini (Nano Banana) is a language model on the Gateway: generateText with image output.
async function viaGateway({ entry, prompt, refs, aspect, resolution, num, timeout }) {
  const { ai, gw } = await gatewayClient(process.env.AI_GATEWAY_API_KEY, timeout);
  const images = await inlineRefs(refs);
  const blobs = []; // { bytes, mediaType }
  if (entry.gateway.startsWith('google/')) {
    console.error(`gateway   ${entry.gateway}  aspect=${aspect}  size=${resolution}  refs=${images.length}`);
    const content = [...images.map((image) => ({ type: 'image', image })), { type: 'text', text: prompt }];
    const runs = await times(num, () => ai.generateText({
      model: gw(entry.gateway),
      messages: [{ role: 'user', content }],
      providerOptions: { google: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect, imageSize: resolution } } },
      maxRetries: 0,
    }));
    for (const r of runs) {
      logGatewayWarnings(r.warnings);
      const files = r.files.filter((f) => f.mediaType?.startsWith('image/'));
      if (!files.length) throw new Error(`${entry.gateway} returned no image${r.text ? `: ${r.text.slice(0, 200)}` : ''}`);
      for (const f of files) blobs.push({ bytes: f.uint8Array, mediaType: f.mediaType });
    }
  } else {
    const size = sizeForTier(aspect, resolution);
    console.error(`gateway   ${entry.gateway}  size=${size}  refs=${images.length}`);
    const res = await ai.generateImage({
      model: gw.imageModel(entry.gateway),
      prompt: images.length ? { images, text: prompt } : prompt,
      n: num, size, maxRetries: 0,
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

  const { W } = workspaceKeys([out, recordPath, args['prompt-file'], ...args.ref], '--out/--record');

  const prompt = args['prompt-file'] ? (await readFile(resolve(args['prompt-file']), 'utf8')).trim()
    : args.prompt != null ? String(args.prompt)
    : g.prompt != null ? String(g.prompt) : '';
  if (!prompt) die('prompt is empty (pass --prompt/--prompt-file or a record with generation.prompt)');

  const entry = pickModel({ model: args.model || g.model, 'unlisted-model': args['unlisted-model'] }, 'image', 'gpt-image-2.5');
  const shape = entry.shape || entry.name;
  const aspect = String(args.aspect || g.aspect || '4:5').replace('x', ':');
  const resolution = String(args.resolution || g.resolution || '1K').toUpperCase();
  if (!TIERS.includes(resolution)) die(`--resolution must be ${TIERS.join(' | ')} (got "${resolution}")`);
  const background = args.background || g.background ? String(args.background || g.background).toLowerCase() : null;
  if (background && (shape !== 'gpt-image-2.5' || !['auto', 'opaque', 'transparent'].includes(background)))
    die('--background is auto | opaque | transparent, on gpt-image-2.5 only.');
  const format = String(args.format || g.format || 'png').toLowerCase();
  if (!['png', 'jpg'].includes(format) || (format !== 'png' && shape !== 'nano-banana-2.1')) die('--format is png | jpg, on nano-banana-2.1 only.');
  const num = Math.max(1, parseInt(args.num || '1', 10));
  const timeout = parseInt(args.timeout || '300', 10);
  const refsIn = args.ref.length ? args.ref : (Array.isArray(g.refs) ? g.refs : []);
  const refs = checkRefs(shape, refsIn);

  const opts = { entry, prompt, refs, aspect, resolution, background, format, num, timeout };
  const ran = await runProviders({
    entry, provider: args.provider, ws: W, kie: () => viaKie(opts), gateway: () => viaGateway(opts),
    blocker: entry.unlisted ? null : kieBlocker(shape, sentAspect(shape, aspect), resolution),
  });
  const saved = await saveResults(ran.results, out, { fallbackExt: 'png', transform: cleanImage });
  if (ran.provider === 'kie' && sentAspect(shape, aspect) !== aspect) for (const f of saved) await cropTo(f, aspect);
  await writeSidecars(saved, {
    tool: 'generate-image', model: entry.name, provider: ran.provider, prompt,
    params: { aspect, resolution, background, format: format === 'png' ? null : format },
    refs: refs.map((path) => ({ role: 'ref', path })),
  });

  if (record) {
    record.generation = {
      ...g, provider: ran.provider, model: entry.name, aspect, resolution, ...(background ? { background } : {}),
      prompt, refs: refsIn, output: saved[0], outputs: saved, generatedAt: new Date().toISOString(),
    };
    record.status = 'pending-review';
    await writeFile(recordPath, JSON.stringify(record, null, 2) + '\n');
    console.error('record    updated ' + recordPath);
  }
}

main().catch((e) => die(errorText(e)));
