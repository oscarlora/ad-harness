'use client';
import { useEffect, useState } from 'react';
import { fileUrl } from '../../lib/client/api.js';

// A brand file's text, refetched when its version changes; null until it arrives.
export function useFileText(ws, brand, p, v) {
  const [text, setText] = useState(null);
  useEffect(() => {
    if (!p) return undefined;
    let dead = false;
    fetch(fileUrl(ws, brand, p, v), { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '')
      .then((t) => { if (!dead) setText(t); });
    return () => { dead = true; };
  }, [ws, brand, p, v]);
  return text;
}

export const Dot = ({ state, title }) => <span className="dot" data-state={state} title={title} role={title ? 'img' : undefined} aria-label={title} />;

// Fetched on first open.
export function TextDisclosure({ ws, brand, label, file }) {
  const [open, setOpen] = useState(false);
  const text = useFileText(ws, brand, open ? file.p : null, file.v);
  return (
    <details className="disclosure" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}</summary>
      <div className="disclosure__body">{text ?? 'Loading'}</div>
    </details>
  );
}
