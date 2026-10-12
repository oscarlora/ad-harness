// providers.mjs — provider routing (Segmind, kie.ai, Vercel AI Gateway), per-workspace keys, the
// provider clients, reference hosting and saving results, shared by generate-*.mjs.
//
// Fail over only on an explicit pre-submit rejection or a known outage shape, and resubmit only when
// the submit itself failed: once a provider returns a task id, poll it to the end. A second
// submission is a second charge.
// Segmind auth is `x-api-key`, not Bearer (verified live). Segmind v2: POST /v2/<slug> -> request_id,
// poll /v2/requests/{id}/status, then GET /v2/requests/{id}; output URLs expire after ~1 hour.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { REPO_ROOT, brandDirFrom, die, extForMime, inferBrand, inferWorkspace, loadEnv, mimeOf, sleep, typeOf } from './catalog.mjs';
import { r2FromEnv } from './r2.mjs';

// <WS>_PROVIDER_ORDER=kie,gateway in .env overrides it exactly: providers left out are never used.
export const PROVIDER_ORDER = ['segmind', 'kie', 'gateway'];
const providerOrder = (ws) => {
  const own = (process.env[`${ws}_PROVIDER_ORDER`] || '').split(',').map((q) => q.trim().toLowerCase()).filter((q) => PROVIDER_ORDER.includes(q));
  return own.length ? [...new Set(own)] : PROVIDER_ORDER;
};

// Kit model name -> the id each provider carries it under (missing = not carried). generate-*.mjs
// never hardcode another id. `kind` picks the Gateway call: image = generateImage, text-image =
// generateText with image output (Gemini image models), video = experimental_generateVideo, speech =
// generateSpeech. Tools add endpoint suffixes (e.g. kie gpt-image-* -> -text-to-image | -image-to-image).
// A provider id is set only where its docs carry the same model; never guess one.
export const MODELS = {
  // images
  'gpt-image-2.5':        { kind: 'image',      segmind: 'gpt-image-2.5-flare', kie: 'gpt-image-2-5-flare', gateway: 'openai/gpt-image-2.5-flare' }, // default
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
  'minimax-h3-max':       { kind: 'video', segmind: 'minimax-h3-max', kie: 'minimax-h3', gateway: 'minimax/minimax-h3-max' }, // default; kie has only base H3
  'seedance-2.5':         { kind: 'video', segmind: 'seedance-2.5',      kie: 'bytedance/seedance-2-5',    gateway: 'bytedance/seedance-2.5' },
  'seedance-2':           { kind: 'video', segmind: 'seedance-2.0',      kie: 'bytedance/seedance-2',      gateway: 'bytedance/seedance-2.0' },
  'seedance-2-mini':      { kind: 'video', segmind: 'seedance-2.0-mini', kie: 'bytedance/seedance-2-mini', gateway: 'bytedance/seedance-2.0-mini' },
  'flux-3-video-edit':    { kind: 'video', segmind: 'flux-3-video-edit' }, // edit-only: one source clip + prompt
  // kie only: Segmind's gemini-omni-flash is the older 1.0; the Gateway has only a preview.
  'gemini-omni-1.1-flash': { kind: 'video', kie: 'google/gemini-omni-flash-1-1' },
  // voice
  'gemini-3.8-flash-tts': { kind: 'speech', segmind: 'gemini-3.8-flash-tts', kie: 'google/gemini-3-8-flash-tts', gateway: 'google/gemini-3.8-flash-tts' }, // default
  // Seed Audio 1.0 (voice, music, SFX); on kie the same --voices-file cast runs on ElevenLabs.
  'seed-audio':           { kind: 'speech', segmind: 'seed-audio-1.0', kie: 'elevenlabs/text-to-dialogue-v3' },
};

// Accepts a MODELS name, any provider id in it, or a raw Gateway id (`creator/model`, Gateway only).
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

// Only the inferred workspace's <WS>_* keys are used (no shared fallback). Sets the unprefixed names
// the clients read; returns { W, keys } (key presence).
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

// Returns the ordered providers to try. `blockers` = { provider: why it can't take this request }:
// auto skips it with a note, an explicit --provider fails with the reason.
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

// Gateway failures before anything is generated. 5xx and timeouts may already be billed: no failover.
const GATEWAY_PRESUBMIT = new Set(['GatewayInvalidRequestError', 'GatewayForbiddenError', 'GatewayModelNotFoundError', 'GatewayRateLimitError']);
const isGatewayPreSubmit = (e) => GATEWAY_PRESUBMIT.has(e?.name) || [400, 402, 403, 404, 429].includes(e?.statusCode);
const isGatewayAuth = (e) => e?.name === 'GatewayAuthenticationError' || e?.statusCode === 401;
// Marks a local failure before anything was sent, so the next provider may run.
export const preSubmit = (e) => Object.assign(e instanceof Error ? e : new Error(String(e)), { preSubmit: true });
// kie: 402 credits, 429/433 limits, 455 maintenance, 5xx (HTTP or body `code`), the 4:5/5:4 tier 422.
const isKieOutage = (e) => /temporarily unavailable|aspect ratios|Internal error|(HTTP|code) (402|429|433|455|5\d\d)\b|failCode\D*5\d\d/i.test(e?.message || '');
// Segmind: 5xx, 429 rate limit, 406 credits, and a FAILED job (422 on the result fetch).
const isSegmindOutage = (e) => /HTTP 5\d\d|HTTP 429|HTTP 406|HTTP 422|status.*FAILED/i.test(e?.message || '');

// Runs the plan's providers in order until one generates: { results, provider }.
export async function runRoute(plan, runners, ws) {
  const failover = { gateway: isGatewayPreSubmit, segmind: isSegmindOutage, kie: isKieOutage };
  for (let i = 0; ; i++) {
    try { return { results: await runners[plan[i]](), provider: plan[i] }; }
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
// Our own and the Gateway's errors print without a stack.
export const errorText = (e) => (e?.quiet || /^Gateway/.test(e?.name || '') ? `${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message}` : e?.stack || String(e));

// Retry a submit that failed before the job was accepted. Outage and `fatal` errors throw at once
// so runRoute can fail over. Never wrap a poll in this: that would be a second paid generation.
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
// Imported lazily so the Segmind/kie paths need no npm install. Node's fetch drops a request after
// 5 min of silence, too short for video renders, hence the undici agent. Call sites pass
// maxRetries: 0: an SDK retry after a timeout is a second paid generation.
export async function gatewayClient(apiKey, timeoutSec = 1800) {
  let ai, createGateway;
  try { ai = await import('ai'); ({ createGateway } = await import('@ai-sdk/gateway')); }
  catch { throw preSubmit(new Error('The Gateway provider needs the AI SDK — run `npm install` in the repo root.')); }
  let fetchImpl;
  try {
    // undici's own fetch: its Agent can't drive Node's bundled (older) undici.
    const { Agent, fetch: undiciFetch } = await import('undici');
    const dispatcher = new Agent({ headersTimeout: timeoutSec * 1000, bodyTimeout: timeoutSec * 1000 });
    fetchImpl = (url, init) => undiciFetch(url, { ...init, dispatcher });
  } catch { /* undici missing: default fetch timeouts */ }
  return { ai, gw: createGateway({ apiKey, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) };
}

// Unsupported settings are warnings on the Gateway, not errors.
export function logGatewayWarnings(warnings) {
  for (const w of warnings || []) console.error(`WARN: gateway ${w.feature || w.setting || w.type}: ${w.details || w.message || ''}`.trim());
}

// ---------- references ----------
// A local reference as a public URL: a 1-hour signed R2 URL (uploaded first if R2 doesn't have it),
// or, for a workspace without R2, kie's temporary file hosting.
export async function presignRef(refPath, contextPath) {
  if (/^https?:\/\//i.test(refPath)) return refPath;
  const abs = resolve(refPath);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  const brandDir = brandDirFrom(contextPath);
  const workspace = inferWorkspace(brandDir);
  const brand = inferBrand(brandDir);
  const r2 = workspace && r2FromEnv(loadEnv(), workspace);
  if (!r2) {
    if (process.env.KIE_API_KEY) return kieUpload(abs);
    throw userError(`Local references need a public URL: add R2 or a kie key for workspace ${workspace || '?'}, or pass an https URL.`);
  }
  const rel = relative(brandDir, abs).replace(/\\/g, '/');
  if (!brand || rel.startsWith('../') || rel === '..')
    throw userError(`Local references must live inside ${brandDir} to get a signed R2 URL; move/catalog the file there or pass an https URL.`);
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

// The v2 result envelope isn't fully documented, so try the plausible paths.
function segmindOutputUrl(body) {
  for (const v of [body?.output, body?.result?.output, body?.response?.output]) {
    const url = Array.isArray(v) ? v[0] : v;
    if (typeof url === 'string' && url) return url;
  }
  throw new Error(`segmind job completed but no output url found: ${JSON.stringify(body)}`);
}

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
export async function kie(path, { base = 'https://api.kie.ai', ...opts } = {}) {
  const res = await fetch(base + path, { ...opts, headers: { Authorization: `Bearer ${process.env.KIE_API_KEY}`, ...opts.headers } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw userError(`${path} -> HTTP ${res.status} ${JSON.stringify(json)}`);
  return json;
}

export async function kieUpload(refPath) {
  if (/^https?:\/\//i.test(refPath)) return refPath;
  const abs = resolve(refPath);
  if (!existsSync(abs)) throw userError(`reference not found: ${refPath}`);
  const fd = new FormData();
  fd.append('file', new Blob([await readFile(abs)], { type: mimeOf(abs) }), basename(abs));
  fd.append('uploadPath', `${{ image: 'images', video: 'videos' }[typeOf(abs)] || 'audio'}/ad-production-kit`);
  const json = await kie('/api/file-stream-upload', { method: 'POST', body: fd, base: 'https://kieai.redpandaai.co' });
  const url = json?.data?.downloadUrl;
  if (!url) throw new Error(`upload failed for ${refPath}: ${JSON.stringify(json)}`);
  console.error(`uploaded  ${basename(abs)} -> ${url}`);
  return url;
}

export async function kieJob(model, input, timeoutSec, pollMs = 5000) {
  const taskId = await retryTransient(async () => {
    const json = await kie('/api/v1/jobs/createTask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, input }) });
    // kie reports most rejections as HTTP 200 + a body code.
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

// n calls of fn at once (one per variation), flattened: kie returns a list per task.
export const times = async (n, fn) => (await Promise.all(Array.from({ length: n }, fn))).flat();

// ---------- saving results ----------
// foo.png + index 1 -> foo_2.png
export const suffixed = (p, i) => (i === 0 ? p : join(dirname(p), `${basename(p, extname(p))}_${i + 1}${extname(p)}`));

async function writeAs(outPath, ext, bytes) {
  const finalPath = `${outPath.replace(/\.[^./]+$/, '')}.${ext}`;
  await mkdir(dirname(resolve(finalPath)), { recursive: true });
  await writeFile(resolve(finalPath), bytes);
  return finalPath;
}

// The extension follows the actual bytes: providers may return jpg for a png request.
export async function downloadTo(url, outPath, { fallbackExt, transform = (b) => b } = {}) {
  const res = await fetch(url);
  if (!res.ok) throw userError(`download ${url} -> HTTP ${res.status}`);
  const ext = extForMime(res.headers.get('content-type')) || extname(new URL(url).pathname).slice(1).toLowerCase() || fallbackExt;
  return writeAs(outPath, ext, transform(Buffer.from(await res.arrayBuffer())));
}

// Results are URLs (Segmind/kie) or { bytes, mediaType | ext } (Gateway). Prints "Saved: <path>" per file.
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

// <stem>.gen.json beside each saved file, read by the Studio. Ref paths are brand-relative when possible.
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

// Music beds and SFX run through generate-voice.mjs's Seed Audio client. `seconds` is best-effort.
export function runSeedAudio({ prompt, seconds, num = 1, timeout = 600, out }) {
  const child = spawnSync(process.execPath, [
    join(REPO_ROOT, 'tools', 'generate-voice.mjs'),
    '--model', 'seed-audio', '--provider', 'segmind', '--prompt', prompt,
    '--target-length', String(seconds), '--num', String(num), '--timeout', String(timeout), '--out', String(out),
  ], { stdio: 'inherit' });
  if (child.error) die(`Seed Audio launch failed: ${child.error.message}`);
  if (child.status !== 0) process.exit(child.status || 1);
}
