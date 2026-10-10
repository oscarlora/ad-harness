// providers.mjs — who generates: Segmind, kie.ai and the Vercel AI Gateway, tried in PROVIDER_ORDER (or the workspace's own order).
// The one shared layer for generate-image / -video / -voice / -music: the routing decision
// (PROVIDER_ORDER + MODELS + planRoute/runRoute), per-workspace keys, the Gateway client, the
// Segmind and kie.ai REST clients, reference hosting, and saving results (+ their .gen.json sidecars).
//
// Routing, in one place: `--provider auto` walks PROVIDER_ORDER, keeping each provider that carries
// the model (MODELS below, or a raw `creator/model` Gateway id), has its <WS>_ key, and can take this
// request (a tool's per-provider blocker). A failover only happens on an explicit pre-submit
// rejection (bad request, model not found, rate limit, out of credits) or a provider's known outage
// shape — never on an ambiguous failure after submit, since a second generation is a second charge.
// For the same reason a job is only ever resubmitted when the submit itself failed
// (retryTransient): once a provider hands back a task/request id, the tool polls it to the end and
// never submits again.
//
// Segmind auth is `x-api-key`, NOT `Authorization: Bearer` (kie.ai's scheme) — verified live,
// do not "fix" this to Bearer.
//
// Segmind async (v2), one code path for images/video/audio:
//   POST /v2/<slug> -> { request_id }
//   poll GET /v2/requests/{id}/status until status is COMPLETED or FAILED
//   GET /v2/requests/{id} for the final body
// Output is a direct URL that expires ~1 hour after completion — download promptly. The
// Segmind/kie paths are zero-dependency (plain fetch); the AI SDK is imported only when the
// Gateway actually runs.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { REPO_ROOT, brandDirFrom, die, extForMime, inferBrand, inferWorkspace, loadEnv, mimeOf, sleep, typeOf } from './catalog.mjs';
import { r2FromEnv } from './r2.mjs';

// The default provider order. A workspace can set its own in .env (<WS>_PROVIDER_ORDER=kie,gateway);
// it is exact: providers it leaves out are never used for that workspace.
export const PROVIDER_ORDER = ['segmind', 'kie', 'gateway'];
const providerOrder = (ws) => {
  const own = (process.env[`${ws}_PROVIDER_ORDER`] || '').split(',').map((q) => q.trim().toLowerCase()).filter((q) => PROVIDER_ORDER.includes(q));
  return own.length ? [...new Set(own)] : PROVIDER_ORDER;
};

// Harness model name -> the id each provider carries it under; a missing provider doesn't carry it.
// generate-*.mjs build each provider's request from these ids and never hardcode another. `kind`
// picks the Gateway's AI SDK call: image = generateImage, text-image = generateText with image output
// (Gemini "Nano Banana" models are language models on the Gateway), video = experimental_generateVideo,
// speech = generateSpeech. Base ids with endpoint variants get their suffix in the tool:
// kie gpt-image-* -> <id>-text-to-image | -image-to-image; Segmind minimax-h3-max -> -turbo |
// -reference-to-video; kie minimax-h3 -> /text-to-video | /image-to-video | /reference-to-video.
// A kie id is set only where docs.kie.ai carries the SAME model (or, for minimax-h3-max, its base
// H3 — the only H3 kie has) under a compatible shape; seedream-5-pro (kie: Seedream 3.0),
// flux-2-pro (kie: Kontext only), grok-imagine-image-2 (kie: no refs), ideogram-v4-fast (kie: V3),
// qwen-image-3 and reve-2 have none. Gateway ids: ai-gateway.vercel.sh/v1/models, checked 2026-09-29.
// Re-check the provider's docs before adding an id — never guess one.
export const MODELS = {
  // images
  'gpt-image-2.5':        { kind: 'image',      segmind: 'gpt-image-2.5-flare', kie: 'gpt-image-2-5-flare', gateway: 'openai/gpt-image-2.5-flare' }, // default (Flare = fast variant)
  'gpt-image-2':          { kind: 'image',      segmind: 'gpt-image-2',         kie: 'gpt-image-2',         gateway: 'openai/gpt-image-2' },
  'nano-banana-pro':      { kind: 'text-image', segmind: 'nano-banana-pro',     kie: 'nano-banana-pro',     gateway: 'google/gemini-3-pro-image' },
  'nano-banana-2':        { kind: 'text-image',                                                             gateway: 'google/gemini-3.1-flash-image' },
  'nano-banana-2-lite':   { kind: 'text-image', segmind: 'nano-banana-2-lite',  kie: 'nano-banana-2-lite',  gateway: 'google/gemini-3.1-flash-lite-image' },
  'seedream-5-pro':       { kind: 'image',      segmind: 'seedream-5-pro',                                  gateway: 'bytedance/seedream-5.0-pro' },
  'flux-2-pro':           { kind: 'image',      segmind: 'flux-2-pro',                                      gateway: 'bfl/flux-2-pro' },
  'grok-imagine-image-2': { kind: 'image',      segmind: 'grok-imagine-image-2',                            gateway: 'spacexai/grok-imagine-image-2.0' },
  'qwen-image-3':         { kind: 'image',      segmind: 'qwen-image-3' },
  'reve-2':               { kind: 'image',      segmind: 'reve-2' },
  'ideogram-v4-fast':     { kind: 'image',      segmind: 'ideogram-v4-fast' },
  // video
  'minimax-h3-max':       { kind: 'video', segmind: 'minimax-h3-max', kie: 'minimax-h3', gateway: 'minimax/minimax-h3-max' }, // default
  'seedance-2.5':         { kind: 'video', segmind: 'seedance-2.5',      kie: 'bytedance/seedance-2-5',    gateway: 'bytedance/seedance-2.5' },
  'seedance-2':           { kind: 'video', segmind: 'seedance-2.0',      kie: 'bytedance/seedance-2',      gateway: 'bytedance/seedance-2.0' },
  'seedance-2-mini':      { kind: 'video', segmind: 'seedance-2.0-mini', kie: 'bytedance/seedance-2-mini', gateway: 'bytedance/seedance-2.0-mini' },
  'flux-3-video-edit':    { kind: 'video', segmind: 'flux-3-video-edit' }, // edit-only: one source clip + prompt (segmind.com/models/flux-3-video-edit/api, 2026-10-01)
  // kie only (docs.kie.ai/market/google/gemini-omni-flash-1-1, 2026-10-06): Segmind's gemini-omni-flash
  // is the older 1.0 (no resolution or first frame); the Gateway has only gemini-omni-flash-preview.
  'gemini-omni-1.1-flash': { kind: 'video', kie: 'google/gemini-omni-flash-1-1' },
  // voice
  'gemini-3.8-flash-tts': { kind: 'speech', segmind: 'gemini-3.8-flash-tts', kie: 'google/gemini-3-8-flash-tts', gateway: 'google/gemini-3.8-flash-tts' }, // default
  // Seed Audio 1.0 (voice, music, SFX). kie has no Seed Audio: there the same --voices-file cast
  // runs on ElevenLabs Text to Dialogue v3.
  'seed-audio':           { kind: 'speech', segmind: 'seed-audio-1.0', kie: 'elevenlabs/text-to-dialogue-v3' },
};

// A model's routing entry: a MODELS name, any provider id listed there (e.g. openai/gpt-image-2 ->
// gpt-image-2), or a raw Gateway id (`creator/model`, Gateway only) so any Gateway model runs
// without a table edit. Returns { name, kind, segmind?, kie?, gateway? } or null.
export function modelEntry(model, kind) {
  if (MODELS[model]) return { name: model, ...MODELS[model] };
  const hit = Object.entries(MODELS).find(([, e]) => e.gateway === model || e.segmind === model || e.kie === model);
  if (hit) return { name: hit[0], ...hit[1] };
  if (!/^[a-z0-9-]+\/[a-z0-9._-]+$/i.test(model || '')) return null;
  return { name: model, kind: kind === 'image' && /^google\/gemini-.*-image/i.test(model) ? 'text-image' : kind, gateway: model };
}

// An error whose message is the whole story: errorText prints it without a stack.
export const userError = (message) => Object.assign(new Error(message), { quiet: true });

const PROVIDER_KEY = { gateway: 'AI_GATEWAY_API_KEY', segmind: 'SEGMIND_API_KEY', kie: 'KIE_API_KEY' };

// Per-workspace keys, strictly scoped (no shared fallback): the workspace comes from the first of
// `paths` under workspaces/<WS>/, and only its <WS>_* keys are used. Sets the unprefixed names the
// Segmind/kie clients read; returns { W, keys } (key presence) for planRoute.
export function workspaceKeys(paths, from = '--out') {
  const ws = [paths].flat().filter(Boolean).map((p) => inferWorkspace(String(p))).find(Boolean);
  if (!ws) throw userError(`Could not infer the workspace from ${from} (expected workspaces/<Workspace>/...).`);
  const W = ws.toUpperCase();
  const keys = {};
  for (const [q, name] of Object.entries(PROVIDER_KEY)) {
    process.env[name] = process.env[`${W}_${name}`] || '';
    keys[q] = !!process.env[name];
  }
  return { W, keys };
}

// The routing decision. Returns the ordered providers to try. `keys` = { gateway, segmind, kie }
// presence; `entry` = the model's routing entry (default modelEntry(model, kind)); `blockers` =
// { provider: why it can't carry this request } — auto skips that provider with a note, an explicit
// --provider fails with the reason.
export function planRoute({ model, provider = 'auto', keys, ws, blockers = {}, kind, entry = modelEntry(model, kind), label = model }) {
  const p = provider === 'vercel' ? 'gateway' : provider;
  const need = (q) => `Add ${ws}_${PROVIDER_KEY[q]}=... to .env`;
  const carriers = providerOrder(ws).filter((q) => entry?.[q]);
  if (PROVIDER_KEY[p]) {
    if (!entry?.[p]) throw userError(`${label} isn't on ${p}${carriers.length ? ` — use --provider ${carriers.join('|')}` : ''}.`);
    if (blockers[p]) throw userError(`${p} can't run this request: ${blockers[p]}.${carriers.length > 1 ? ` Use --provider ${carriers.filter((q) => q !== p).join('|')}.` : ''}`);
    if (!keys[p]) throw userError(`Workspace ${ws} has no ${p} key. ${need(p)}${p === 'gateway' ? ' (Vercel → AI Gateway → API keys)' : ''}.`);
    return [p];
  }
  if (p !== 'auto') throw userError(`--provider must be auto | segmind | kie | gateway (got "${provider}")`);
  const plan = [];
  for (const q of carriers) {
    if (!keys[q]) continue;
    if (blockers[q]) console.error(`note      ${q} skipped: ${blockers[q]}.`);
    else plan.push(q);
  }
  if (!plan.length) {
    const options = carriers.filter((q) => !blockers[q]);
    if (!options.length) throw userError(`${label}: no provider can run this request${carriers.length ? ` (${carriers.map((q) => `${q}: ${blockers[q]}`).join('; ')})` : ''}.`);
    const names = options.map((q) => `${ws}_${PROVIDER_KEY[q]}`);
    throw userError(`Workspace ${ws} has no key for ${label}. ${names.length > 1 ? `Add one of ${names.join(', ')}` : `Add ${names[0]}=...`} to .env.`);
  }
  return plan;
}

// Gateway failures that happen before anything is generated: a rejected request (400), no
// access/credit (402/403), unknown model (404), rate limit (429). 5xx, timeouts and malformed
// responses are ambiguous — the generation may already be billed — so they never fail over.
const GATEWAY_PRESUBMIT = new Set(['GatewayInvalidRequestError', 'GatewayForbiddenError', 'GatewayModelNotFoundError', 'GatewayRateLimitError']);
const isGatewayPreSubmit = (e) => GATEWAY_PRESUBMIT.has(e?.name) || [400, 402, 403, 404, 429].includes(e?.statusCode);
const isGatewayAuth = (e) => e?.name === 'GatewayAuthenticationError' || e?.statusCode === 401;
// A local pre-submit failure on any provider (missing AI SDK, reference hosting, a request shape the
// provider can't take): nothing was sent, so the next provider may run.
export const preSubmit = (e) => Object.assign(e instanceof Error ? e : new Error(String(e)), { preSubmit: true });
// kie.ai: 402 insufficient credits, 429/433 rate or sub-key limits, 455 maintenance, 5xx outages (as
// an HTTP status or the body's `code`), and the 4:5/5:4 upscale-tier 422.
const isKieOutage = (e) => /temporarily unavailable|aspect ratios|Internal error|(HTTP|code) (402|429|433|455|5\d\d)\b|failCode\D*5\d\d/i.test(e?.message || '');
// Segmind: 5xx, 429 rate-limited, 406 insufficient credits, and a FAILED job (HTTP 422 on the result
// fetch). Widen empirically as new shapes show up.
const isSegmindOutage = (e) => /HTTP 5\d\d|HTTP 429|HTTP 406|HTTP 422|status.*FAILED/i.test(e?.message || '');

// Walk the plan: run the first provider; move to the next only on that provider's explicit
// pre-submit / outage failure. Gateway auth failures get a clear fix-the-key message instead.
export async function runRoute(plan, runners, ws) {
  const failover = { gateway: isGatewayPreSubmit, segmind: isSegmindOutage, kie: isKieOutage };
  for (let i = 0; ; i++) {
    try { return await runners[plan[i]](); }
    catch (e) {
      if (plan[i] === 'gateway' && isGatewayAuth(e))
        throw userError(`AI Gateway authentication failed for workspace ${ws}. Add ${ws}_AI_GATEWAY_API_KEY=... to .env with a valid key (Vercel → AI Gateway → API keys), or pass --provider segmind|kie.\n  (${e.name}: ${firstLine(e.message)})`);
      if (plan[i + 1] && (e?.preSubmit || failover[plan[i]](e))) {
        console.error(`${plan[i]} unavailable (rejected before generating) — using ${plan[i + 1]}. (${firstLine(e.message).slice(0, 120)})`);
        continue;
      }
      throw e;
    }
  }
}
const firstLine = (m) => String(m || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0];
// What a tool prints for a fatal error: our own and the Gateway's messages are self-explanatory;
// anything else keeps its stack.
export const errorText = (e) => (e?.quiet || /^Gateway/.test(e?.name || '') ? `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message}` : e?.stack || String(e));

// Retry a submit that failed before the provider accepted the job (no task/request id yet).
// Outage-shaped and `fatal` errors are thrown at once so runRoute can fail over. Never wrap a poll
// in this: resubmitting after a job was accepted is a second paid generation.
export async function retryTransient(submit, isOutage = () => false, attempts = 3, delayMs = 3000) {
  for (let attempt = 1; ; attempt++) {
    try { return await submit(); }
    catch (e) {
      if (e?.fatal || isOutage(e) || attempt >= attempts) throw e;
      console.error(`  submit failed (attempt ${attempt}/${attempts}): ${firstLine(e.message)} — retrying...`);
      await sleep(delayMs);
    }
  }
}

// ---------- Gateway ----------
// The Gateway client (AI SDK 7). Imported lazily so the Segmind/kie paths need no npm install.
// Long video renders hold one request open; Node's fetch drops it after 5 min of silence, so the
// client gets an undici agent with generous timeouts. Every call site passes maxRetries: 0 — an SDK
// retry after a timeout would be a second paid generation.
export async function gatewayClient(apiKey, timeoutSec = 1800) {
  let ai, createGateway;
  try { ai = await import('ai'); ({ createGateway } = await import('@ai-sdk/gateway')); }
  catch { throw preSubmit(new Error('The Gateway provider needs the AI SDK — run `npm install` in the repo root.')); }
  let fetchImpl;
  try {
    const { Agent } = await import('undici');
    const dispatcher = new Agent({ headersTimeout: timeoutSec * 1000, bodyTimeout: timeoutSec * 1000 });
    fetchImpl = (url, init) => fetch(url, { ...init, dispatcher });
  } catch { /* undici missing: default fetch timeouts */ }
  return { ai, gw: createGateway({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) };
}

// Print the Gateway's per-call warnings (unsupported settings are warnings there, not errors).
export function logGatewayWarnings(warnings) {
  for (const w of warnings || []) console.error(`WARN: gateway ${w.feature || w.setting || w.type}: ${w.details || w.message || ''}`.trim());
}

// ---------- references ----------
// A local reference as a temporary signed R2 URL (Gateway video, every Segmind path). Brand assets
// stay in the workspace R2 master; only the signed GET URL is temporary. A file not yet in R2 is
// uploaded on demand — the local file is the source of truth, and a missing R2 copy is a sync gap,
// not a reason to fail the render. http(s) URLs pass through.
export async function presignRef(refPath, contextPath) {
  if (/^https?:\/\//i.test(refPath)) return refPath;
  const abs = resolve(refPath);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  const brandDir = brandDirFrom(contextPath);
  const workspace = inferWorkspace(brandDir);
  const brand = inferBrand(brandDir);
  const rel = relative(brandDir, abs).replace(/\\/g, '/');
  if (!workspace || !brand || rel.startsWith('../') || rel === '..')
    throw userError(`Local references must live inside ${brandDir} to get a signed R2 URL; move/catalog the file there or pass an https URL.`);
  const r2 = r2FromEnv(loadEnv(), workspace);
  if (!r2) throw userError(`No R2 credentials for workspace ${workspace}; local references need a signed R2 URL.`);
  const key = `${brand}/${rel}`;
  if (!(await r2.head(key))) {
    console.error(`not yet in R2, uploading ${basename(abs)} (${key})`);
    await r2.putFile(key, abs, mimeOf(abs));
  }
  const url = r2.presignGet(key, 3600);
  console.error(`presigned ${basename(abs)} from R2`);
  return url;
}

// ---------- Segmind ----------
async function segmindFetch(path, opts = {}) {
  const res = await fetch('https://api.segmind.com' + path, { ...opts, headers: { 'x-api-key': process.env.SEGMIND_API_KEY, ...opts.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw userError(`${path} -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// The output URL of a completed v2 job. The envelope isn't fully documented, so check the
// plausible paths and throw with the raw body if none match.
function segmindOutputUrl(body) {
  for (const v of [body?.output, body?.result?.output, body?.response?.output]) {
    const url = Array.isArray(v) ? v[0] : v;
    if (typeof url === 'string' && url) return url;
  }
  throw new Error(`segmind job completed but no output url found: ${JSON.stringify(body)}`);
}

// Submit one v2 job (retrying only a failed submit), poll it to the end, return its output URL.
export async function segmindJob(slug, input, timeoutSec) {
  const id = await retryTransient(async () => {
    const json = await segmindFetch(`/v2/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    if (!json.request_id) throw new Error(`segmind submit failed: ${JSON.stringify(json)}`);
    return json.request_id;
  }, isSegmindOutage);
  console.error(`task      segmind/${slug} -> ${id}`);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const json = await segmindFetch(`/v2/requests/${id}/status`);
    const status = json?.status;
    if (status === 'COMPLETED') return segmindOutputUrl(await segmindFetch(`/v2/requests/${id}`));
    if (status === 'FAILED') throw new Error(`segmind request ${id} FAILED: ${JSON.stringify(json)}`);
    if (Date.now() > deadline) throw new Error(`segmind request ${id} timed out after ${timeoutSec}s (status=${status})`);
    console.error(`  ${id} ${status || 'pending'}`);
    await sleep(4000);
  }
}

// ---------- kie.ai ----------
// Throws on a non-OK response, so runRoute can fail over on an outage.
export async function kie(path, { base = 'https://api.kie.ai', ...opts } = {}) {
  const res = await fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, ...opts.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw userError(`${path} -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

// Upload a local file to kie.ai's CDN and return its public URL; http(s) URLs pass through.
export async function kieUpload(refPath) {
  if (/^https?:\/\//i.test(refPath)) return refPath;
  const abs = resolve(refPath);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  const fd = new FormData();
  fd.append('file', new Blob([await readFile(abs)], { type: mimeOf(abs) }), basename(abs));
  fd.append('uploadPath', `${{ image: 'images', video: 'videos' }[typeOf(abs)] || 'audio'}/ad-harness`);
  const json = await kie('/api/file-stream-upload', { method: 'POST', body: fd, base: 'https://kieai.redpandaai.co' });
  const url = json?.data?.downloadUrl;
  if (!url) throw new Error(`upload failed for ${refPath}: ${JSON.stringify(json)}`);
  console.error(`uploaded  ${basename(abs)} -> ${url}`);
  return url;
}

// Create one market job (retrying only a failed create), poll it to the end, return its result URLs.
export async function kieJob(model, input, timeoutSec, pollMs = 5000) {
  const taskId = await retryTransient(async () => {
    const json = await kie('/api/v1/jobs/createTask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
    // kie reports most rejections (402 no credits, 422 bad input, 455 maintenance) as HTTP 200 + body code.
    if (json?.code !== undefined && json.code !== 200)
      throw Object.assign(userError(`${model} createTask -> code ${json.code} ${json.msg || JSON.stringify(json)}`), { fatal: json.code >= 400 && json.code < 500 });
    if (!json?.data?.taskId) throw new Error(`createTask failed: ${JSON.stringify(json)}`);
    return json.data.taskId;
  }, isKieOutage);
  console.error(`task      ${model} -> ${taskId}`);
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const d = (await kie(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`))?.data || {};
    if (d.state === 'success') {
      const urls = JSON.parse(d.resultJson || '{}').resultUrls || [];
      if (!urls.length) throw new Error(`task ${taskId} success but no resultUrls`);
      return urls;
    }
    if (d.state === 'fail') throw new Error(`task ${taskId} failed: ${d.failMsg || d.failCode || 'unknown'}`);
    if (Date.now() > deadline) throw new Error(`task ${taskId} timed out after ${timeoutSec}s (state=${d.state})`);
    console.error(`  ${taskId} ${d.state || 'pending'}${d.progress ? ` ${d.progress}%` : ''}`);
    await sleep(pollMs);
  }
}

// ---------- saving results ----------
// Insert a variation suffix before the extension: foo.png + index 1 -> foo_2.png
export const suffixed = (p, i) => (i === 0 ? p : join(dirname(p), `${basename(p, extname(p))}_${i + 1}${extname(p)}`));

async function writeAs(outPath, ext, bytes) {
  const finalPath = `${outPath.replace(/\.[^./]+$/, '')}.${ext}`;
  await mkdir(dirname(resolve(finalPath)), { recursive: true });
  await writeFile(resolve(finalPath), bytes);
  return finalPath;
}

// Download a result URL to outPath under the extension of the actual bytes (Content-Type, else the
// URL's own) — providers may return jpg for a png request, so --out's extension isn't trusted.
export async function downloadTo(url, outPath, { fallbackExt, transform = (b) => b } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw userError(`download ${url} -> HTTP ${res.status}`);
  const ext = extForMime(res.headers.get('content-type')) || extname(new URL(url).pathname).slice(1).toLowerCase() || fallbackExt;
  return writeAs(outPath, ext, transform(Buffer.from(await res.arrayBuffer())));
}

// Save every result — a URL (Segmind/kie) is downloaded, { bytes, mediaType | ext } (Gateway) is
// written — result i to suffixed(out, i). Prints "Saved: <path>" per file; returns the paths.
export async function saveResults(results, out, { fallbackExt, transform = (b) => b } = {}) {
  const saved = [];
  for (const [i, r] of results.entries()) {
    const path = typeof r === 'string'
      ? await downloadTo(r, suffixed(out, i), { fallbackExt, transform })
      : await writeAs(suffixed(out, i), r.ext || extForMime(r.mediaType) || fallbackExt, transform(Buffer.from(r.bytes)));
    console.log('Saved: ' + path);
    saved.push(path);
  }
  return saved;
}

// The generation sidecar: <stem>.gen.json beside each saved file, recording what was sent —
// { tool, model, provider, at, params (only those set), refs: [{ role, path }], prompt } — for the
// Studio. Ref paths are brand-relative when the file sits in a brand folder, else as given.
export async function writeSidecars(saved, { tool, model, provider, params = {}, refs = [], prompt }) {
  const rel = (p) => (/^https?:\/\//i.test(p) || !inferBrand(p) ? p : relative(brandDirFrom(p), resolve(p)).replace(/\\/g, '/'));
  const body = JSON.stringify({
    tool, model, provider, at: new Date().toISOString(),
    params: Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')),
    refs: refs.map(({ role, path }) => ({ role, path: rel(String(path)) })),
    prompt,
  }, null, 2) + '\n';
  for (const p of saved) {
    await writeFile(resolve(p.replace(/\.[^./]+$/, '') + '.gen.json'), body)
      .catch((e) => console.error(`WARN: no sidecar for ${p}: ${e.message}`)); // never fail a paid generation over it
  }
}

// Seed Audio 1.0 (music beds, SFX) runs through generate-voice.mjs's Seed Audio client on Segmind,
// so audio generation has one client and one default. `seconds` is the target length (best-effort).
// Exits with the child's status if it fails.
export function runSeedAudio({ prompt, seconds, num = 1, timeout = 600, out }) {
  const child = spawnSync(process.execPath, [
    join(REPO_ROOT, 'tools', 'generate-voice.mjs'),
    '--model', 'seed-audio', '--provider', 'segmind', '--prompt', prompt,
    '--target-length', String(seconds), '--num', String(num), '--timeout', String(timeout), '--out', String(out),
  ], { stdio: 'inherit' });
  if (child.error) die(`Seed Audio launch failed: ${child.error.message}`);
  if (child.status !== 0) process.exit(child.status || 1);
}
