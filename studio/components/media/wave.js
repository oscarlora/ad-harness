'use client';
// Waveform helpers. Peaks come from _catalog/peaks/<id>.json; a deterministic placeholder draws when absent.
import { fileUrl } from '../../lib/client/api.js';

const cache = new Map();

export async function loadPeaks(ws, brand, id) {
  const key = `${ws}/${brand}/${id}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(fileUrl(ws, brand, `inputs/media/_catalog/peaks/${id}.json`))
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []));
  }
  return cache.get(key);
}

export function drawWave(canvas, peaks, { color = '#a3a3a3', progress = -1, playedColor = '#000000' } = {}) {
  if (!canvas) return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const n = peaks.length || 60;
  const gap = w / n;
  const bw = Math.max(1, gap * 0.6);
  for (let i = 0; i < n; i++) {
    const a = peaks[i] ?? (0.2 + 0.6 * Math.abs(Math.sin(i)));
    const bh = Math.max(2, a * h * 0.7);
    ctx.fillStyle = progress >= 0 && i / n <= progress ? playedColor : color;
    ctx.fillRect(i * gap + (gap - bw) / 2, (h - bh) / 2, bw, bh);
  }
}

export const fmtDur = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
