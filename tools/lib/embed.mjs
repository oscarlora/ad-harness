// embed.mjs — local text embeddings for media search: EmbeddingGemma 2 (text model only, q4, CPU) via
// transformers.js. No key; the model (~210 MB) downloads once to ~/.cache/adpk/huggingface.
// transformers.js loads lazily, so keyword-only search needs no npm deps.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { catalogPaths } from './catalog.mjs';

export const EMBED_MODEL = 'embeddinggemma-2-q4';
const REPO = 'onnx-community/embeddinggemma-2-ONNX';
const CACHE = join(homedir(), '.cache', 'adpk', 'huggingface');

// The model card's task prefixes.
export const docText = (title, text) => `title: ${title || 'none'} | text: ${text}`;
export const queryText = (q) => `task: search result | query: ${q}`;

let loaded = null;
async function load() {
  let T;
  try { T = await import('@huggingface/transformers'); } catch { throw new Error('semantic search needs npm deps — run `npm install` in the repo root'); }
  T.env.cacheDir = CACHE;
  if (!existsSync(join(CACHE, REPO))) console.error('Downloading the search model (~210 MB, once)…');
  const config = await T.AutoConfig.from_pretrained(REPO);
  config.vision_config = config.audio_config = null; // text only: the vision and audio encoders never download
  const [model, tokenizer] = await Promise.all([
    T.AutoModel.from_pretrained(REPO, { config, device: 'cpu', dtype: 'q4' }),
    T.AutoTokenizer.from_pretrained(REPO),
  ]);
  return { model, tokenizer };
}

// → normalized 768-dim Float32Arrays. Batches of similar length waste less time on padding.
export async function embed(texts) {
  const { model, tokenizer } = await (loaded ||= load());
  const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
  const out = new Array(texts.length);
  for (let i = 0; i < order.length; i += 8) {
    const batch = order.slice(i, i + 8);
    const { sentence_embedding: e } = await model(await tokenizer(batch.map((n) => texts[n]), { padding: true, truncation: true }));
    const d = e.dims[1];
    batch.forEach((n, k) => { out[n] = Float32Array.from(e.data.subarray(k * d, (k + 1) * d)); });
  }
  return out;
}

// _catalog/vectors.json ({ model, items }, embed-media.mjs), or null when missing or from another model.
export function readVectors(media) {
  const p = catalogPaths(media).vectors;
  if (!existsSync(p)) return null;
  try { const v = JSON.parse(readFileSync(p, 'utf8')); return v.model === EMBED_MODEL ? v : null; } catch { return null; }
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
