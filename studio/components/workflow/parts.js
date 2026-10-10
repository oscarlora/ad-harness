'use client';
// Small pieces shared by the Workflow page and its storyboard strip.
import { useEffect, useState } from 'react';
import { fileUrl } from '../../lib/client/api.js';
import Markdown from './Markdown.js';

// A brand file's text, fetched while p is set and again when its version (mtime) changes.
// null until it arrives.
function useFileText(ws, brand, p, v) {
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

// Progress dot: done (green) · current (blue) · todo (hollow).
export const Dot = ({ state, title }) => <span className="dot" data-state={state} title={title} role={title ? 'img' : undefined} aria-label={title} />;

// A text file ({ p, v }) behind a collapsed disclosure, fetched on first open.
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

// A markdown file ({ p, v }), rendered.
export function MdFile({ ws, brand, file }) {
  const text = useFileText(ws, brand, file.p, file.v);
  return text == null ? <p className="flow-note">Loading</p> : <Markdown text={text} />;
}
