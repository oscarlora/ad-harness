'use client';
// Shared brand-page pieces: the tab list, the toolbar's opening run, and the load-error block.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandUrl } from '../lib/client/api.js';
import Switcher from './Switcher.js';

// URL segment → label; the first is the default.
export const TABS = { board: 'Board', media: 'Media', workflow: 'Workflow' };
export const tabOr = (t) => (Object.hasOwn(TABS, t || '') ? t : 'board');

// Cleared by JS, not CSS, so reduced-motion users aren't left with a stuck label.
function UpdatedFlash({ at }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!at) return undefined;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1900);
    return () => clearTimeout(t);
  }, [at]);
  if (!visible) return null;
  return <span key={at} className="pill-mark updated-flash">Updated</span>;
}

export function ToolbarStart({ ws, brand, current, count, updatedAt }) {
  return (
    <>
      <Link className="toolbar__home" href="/?all=1" title="All brands">Ad Harness</Link>
      <Switcher ws={ws} brand={brand} />
      <nav className="tabs" aria-label="Sections">
        {Object.entries(TABS).map(([t, label]) => (
          <Link key={t} className="tabs__tab" aria-current={current === t ? 'page' : undefined} href={brandUrl(ws, brand, t)}>
            {label}
          </Link>
        ))}
      </nav>
      <span className="toolbar__count">{count}</span>
      <UpdatedFlash at={updatedAt} />
    </>
  );
}

export function LoadError({ what, error, onRetry }) {
  return (
    <div className="empty-state">
      <p style={{ color: 'var(--fg)' }}>Could not load {what}.</p>
      <p><code>{error}</code></p>
      <p style={{ marginTop: '1rem' }}><button type="button" className="btn" onClick={onRetry}>Retry</button></p>
    </div>
  );
}
