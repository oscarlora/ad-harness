// gateway.mjs — the media catalog's model calls via Vercel AI Gateway: JSON analysis of a file,
// text embeddings, and word-timestamped transcription. Key: <WS>_AI_GATEWAY_API_KEY.
// The AI SDK loads lazily, so keyword-only search needs no npm deps.
import { readFileSync } from 'node:fs';
import { loadEnv, inferWorkspace } from './catalog.mjs';
import { PUBLIC_BUCKETS } from './r2.mjs';
import { gatewayClient } from './providers.mjs';

export const ANALYSIS_MODEL = 'google/gemini-3.1-flash-lite';
export const EMBED_MODEL = 'google/gemini-embedding-2';
const EMBED_DIMS = 768; // requested; the model auto-normalizes truncated dims
export const WORDS_MODEL = 'google/gemini-3.5-transcribe'; // word timestamps only (Flash Lite keeps the text)

// Gateway-reported spend in this process (USD).
export const spend = { usd: 0 };
const tally = (meta) => { const c = +(meta?.gateway?.cost ?? 0); if (c) spend.usd += c; };

// A public workspace (the shared library) borrows any workspace's key when it has none of its own.
export function gatewayKey(anyPath) {
  const ws = inferWorkspace(anyPath);
  const W = ws.toUpperCase();
  const env = { ...loadEnv(), ...process.env };
  const own = (W && env[`${W}_AI_GATEWAY_API_KEY`]) || '';
  if (own || !PUBLIC_BUCKETS[ws]) return own;
  return Object.entries(env).find(([k, v]) => k.endsWith('_AI_GATEWAY_API_KEY') && v)?.[1] || '';
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

const clients = new Map(); // key -> Promise<{ ai, gw }>
const client = (key) => { if (!clients.has(key)) clients.set(key, gatewayClient(key)); return clients.get(key); };

export const filePart = (path, mediaType) => ({ type: 'file', data: readFileSync(path), mediaType });

// Retrying is fine here: a repeated analysis costs a fraction of a cent. Invalid JSON throws
// NoObjectGeneratedError.
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

// → [{ word, start, end }]. No speakers via the Gateway; vocabulary + word timestamps is a 400.
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
