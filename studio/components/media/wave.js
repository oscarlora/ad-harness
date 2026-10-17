'use client';
// A media file's waveform. Peaks come from _catalog/peaks/<id>.json; a deterministic placeholder draws when absent.
import { useEffect, useReducer, useRef, useState } from 'react';
import { mediaUrl } from '../../lib/client/api.js';

const cache = new Map();

function loadPeaks(ws, brand, id) {
  const key = `${ws}/${brand}/${id}`;
  if (!cache.has(key)) {
    cache.set(key, fetch(mediaUrl(ws, brand, `_catalog/peaks/${id}.json`))
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []));
  }
  return cache.get(key);
}

// Bars in the `color` token, played ones (up to `progress`, 0–1) in --fg; drawn at the canvas's own size.
function draw(canvas, peaks, color, progress) {
  const css = getComputedStyle(canvas);
  const dpr = window.devicePixelRatio || 1;
  const w = (canvas.width = Math.round(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.round(canvas.clientHeight * dpr));
  const ctx = canvas.getContext('2d');
  const n = peaks.length || 60;
  const gap = w / n;
  const bw = Math.max(1, gap * 0.6);
  for (let i = 0; i < n; i++) {
    const a = peaks[i] ?? (0.2 + 0.6 * Math.abs(Math.sin(i)));
    const bh = Math.max(2, a * h * 0.7);
    ctx.fillStyle = css.getPropertyValue(progress >= 0 && i / n <= progress ? '--fg' : color);
    ctx.fillRect(i * gap + (gap - bw) / 2, (h - bh) / 2, bw, bh);
  }
}

export function Wave({ ws, brand, id, color = '--faint', progress = -1, ...props }) {
  const ref = useRef(null);
  const [peaks, setPeaks] = useState(null);
  const [resized, onResize] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    let dead = false;
    loadPeaks(ws, brand, id).then((p) => { if (!dead) setPeaks(p); });
    return () => { dead = true; };
  }, [ws, brand, id]);
  useEffect(() => {
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { if (peaks) draw(ref.current, peaks, color, progress); }, [peaks, resized, color, progress]);
  return <canvas ref={ref} {...props} />;
}
