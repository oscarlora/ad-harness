// gateway.mjs — the model seam for the media catalog, through Vercel AI Gateway (AI SDK 7):
// structured JSON analysis of an image/video/audio file (analyze-media, transcribe), text
// embeddings (embed-media, search-media), and word-timestamped transcription (caption word
// timings, lib/transcribe.mjs). Key: <WS>_AI_GATEWAY_API_KEY in .env, the workspace inferred
// from the path being worked on. The Gateway calls Google's paid API: media is not trained on.
// The AI SDK loads lazily (providers.gatewayClient), so keyword-only search runs without npm deps.
import { readFileSync } from 'node:fs';
import { loadEnv, inferWorkspace } from './catalog.mjs';
import { gatewayClient } from './providers.mjs';

export const ANALYSIS_MODEL = 'google/gemini-3.1-flash-lite';
export const EMBED_MODEL = 'google/gemini-embedding-2';
const EMBED_DIMS = 768; // requested; the model auto-normalizes truncated dims
export const WORDS_MODEL = 'google/gemini-3.5-transcribe'; // word timestamps only (Flash Lite keeps the text)

// Running total of Gateway-reported spend in this process (USD), for end-of-run summaries.
export const spend = { usd: 0 };
const tally = (meta) => { const c = +(meta?.gateway?.cost ?? 0); if (c) spend.usd += c; };

export function gatewayKey(anyPath) {
  const W = inferWorkspace(anyPath).toUpperCase();
  const env = { ...loadEnv(), ...process.env };
  return (W && env[`${W}_AI_GATEWAY_API_KEY`]) || '';
}
export function requireKey(anyPath) {
  const key = gatewayKey(anyPath);
  if (!key) {
    const W = inferWorkspace(anyPath).toUpperCase() || '<WS>';
    console.error(`No AI Gateway key. Add ${W}_AI_GATEWAY_API_KEY=... to .env (Vercel → AI Gateway → API keys).`);
    process.exit(2);
  }
  return key;
}
// Media travels inline in the request (base64, +33%): keep each file under this.
export const INLINE_MAX = 14 * 1024 * 1024;

const clients = new Map(); // key -> Promise<{ ai, gw }>, one client per key per process
const client = (key) => { if (!clients.has(key)) clients.set(key, gatewayClient(key)); return clients.get(key); };

// A message part carrying a local file (image, video or audio).
export const filePart = (path, mediaType) => ({ type: 'file', data: readFileSync(path), mediaType });

// One structured JSON reply validated against a JSON Schema, at temperature 0 unless given.
// Retries transient failures (a repeated analysis only costs the same fraction of a cent again).
// A reply that isn't valid JSON (e.g. cut off by a repetition loop) throws NoObjectGeneratedError.
export async function generateJSON(key, { parts, schema, model = ANALYSIS_MODEL, temperature = 0, maxOutputTokens }) {
  const { ai, gw } = await client(key);
  const { output, providerMetadata } = await ai.generateText({
    model: gw(model),
    output: ai.Output.object({ schema: ai.jsonSchema(schema) }),
    messages: [{ role: 'user', content: parts }],
    temperature,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    maxRetries: 4,
  });
  tally(providerMetadata);
  return output;
}

// Word-timestamped transcript of an audio buffer: [{ word, start, end }]. Speakers don't come
// through the Gateway, and custom vocabulary can't be combined with word timestamps (400).
export async function transcribeWords(key, audio) {
  const { ai, gw } = await client(key);
  const r = await (ai.transcribe || ai.experimental_transcribe)({
    model: gw.transcription(WORDS_MODEL), audio, maxRetries: 4,
    providerOptions: { google: { wordTimestamp: true } },
  });
  tally(r.providerMetadata);
  return (r.segments || []).map((s) => ({ word: String(s.text).trim(), start: s.startSecond, end: s.endSecond })).filter((w) => w.word);
}

// ---------- embeddings ----------
// gemini-embedding-2 takes the task as a text prefix, not a parameter.
export const docText = (title, text) => `title: ${title || 'none'} | text: ${text}`;
export const queryText = (q) => `task: search result | query: ${q}`;

export async function embed(key, texts) {
  const { ai, gw } = await client(key);
  const { embeddings } = await ai.embedMany({
    model: gw.embeddingModel(EMBED_MODEL),
    values: texts,
    maxParallelCalls: 4,
    maxRetries: 4,
    providerOptions: { google: { outputDimensionality: EMBED_DIMS } },
  });
  return embeddings.map((v) => Float32Array.from(v));
}

// Vectors travel as base64 float32 inside _catalog/vectors.json (768 dims ≈ 4 KB each).
export const packVec = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
export const unpackVec = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
export function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
