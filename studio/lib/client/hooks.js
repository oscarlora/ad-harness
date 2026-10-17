'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiBase, getJson } from './api.js';

// Load /api/[ws]/[brand]/<kind>; reload on each `change` from the watch stream (updatedAt bumps then),
// and once when the stream reconnects after a drop (a Studio restart), since changes in between were missed.
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
    let es = null, timer = 0, dropped = false, dead = false;
    // The browser retries a dropped stream itself, but gives up for good on an error reply
    // (Studio still starting); then reconnect by hand.
    const connect = () => {
      es = new EventSource(`${apiBase(ws, brand)}/watch`);
      es.addEventListener('change', () => loadRef.current().then(() => setUpdatedAt(Date.now())));
      es.addEventListener('open', () => { if (dropped) { dropped = false; loadRef.current(); } });
      es.addEventListener('error', () => {
        dropped = true;
        if (es.readyState === EventSource.CLOSED && !dead) timer = setTimeout(connect, 2000);
      });
    };
    connect();
    return () => { dead = true; clearTimeout(timer); es.close(); };
  }, [ws, brand]);

  return { data, setData, error, load, updatedAt };
}

// A key pressed in a text field or select, which keeps it.
export const isTyping = (e) => !!e.target?.closest?.('input, textarea, select, [contenteditable]');

// Undo / redo (⌘Z / ⌘⇧Z; Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) of the changes made in the last place the user changed
// something; a field being typed in keeps its own. record(entry) after each change; apply(entry, redo) reverts it
// (redo false) or makes it again.
let undoActive = null;
export function useUndo(apply) {
  const stacks = useRef({ past: [], future: [] });
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const record = useCallback((entry) => {
    const s = stacks.current;
    s.past = [...s.past.slice(-99), entry];
    s.future = [];
    undoActive = stacks;
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (undoActive !== stacks || !(e.metaKey || e.ctrlKey) || e.altKey || isTyping(e)) return;
      const k = e.key.toLowerCase(), redo = (k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey);
      if (k !== 'z' && !redo) return;
      const s = stacks.current, from = redo ? s.future : s.past, to = redo ? s.past : s.future;
      if (!from.length) return;
      e.preventDefault();
      const entry = from.pop();
      to.push(entry);
      applyRef.current(entry, redo);
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (undoActive === stacks) undoActive = null; };
  }, []);
  return record;
}

// const [copied, copy] = useCopied()
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copy = (text) => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {});
  return [copied, copy];
}

// Masonry columns step down with the screen width: 4 > 3 > 2 > 1.
const columnsFor = (vw) => (vw < 640 ? 1 : vw < 900 ? 2 : vw < 1200 ? 3 : 4);
export function useColumns() {
  const [n, setN] = useState(4);
  useEffect(() => {
    const on = () => setN(columnsFor(window.innerWidth));
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return n;
}

// Deal items into n columns, each to the shortest so far, so the order still reads left to right.
// heightOf: an item's height per unit of width (1 / its ratio); CSS sizes the cards.
export function masonry(items, n, heightOf) {
  const cols = Array.from({ length: n }, () => ({ items: [], h: 0 }));
  for (const item of items) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a));
    col.items.push(item);
    col.h += heightOf(item);
  }
  return cols.map((c) => c.items);
}
