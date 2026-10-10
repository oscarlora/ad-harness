'use client';
// Hooks shared by the Board, Media and Workflow pages.
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, getJson } from './api.js';

// Load /api/[ws]/[brand]/<kind> and reload it whenever the brand's SSE watch stream reports a
// `change`. updatedAt bumps after each live update — key an "Updated" flash off it.
export function useBrandData(ws, brand, kind) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(0);

  const load = useCallback(
    () => getJson(`${apiBase(ws, brand)}/${kind}`).then((d) => { setData(d); setError(null); }).catch((e) => setError(String(e.message || e))),
    [ws, brand, kind],
  );
  useEffect(() => { load(); }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const es = new EventSource(`${apiBase(ws, brand)}/watch`);
    es.addEventListener('change', () => loadRef.current().then(() => setUpdatedAt(Date.now())));
    return () => es.close();
  }, [ws, brand]);

  return { data, setData, error, load, updatedAt };
}

// Full-screen viewer keys: Esc closes, arrows step. Ignored while typing in a field.
export function useViewerKeys(onStep, onClose) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onStep(-1);
      if (e.key === 'ArrowRight') onStep(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStep, onClose]);
}

// Copy-to-clipboard with a brief "Copied" state: const [copied, copy] = useCopied().
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  return [copied, copy];
}
