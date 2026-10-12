'use client';
// Shared brand-page pieces: the tab list, the page frame (top and bottom bars), small marks, and the load-error block.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { brandUrl } from '../lib/client/api.js';
import Switcher from './Switcher.js';

// URL segment → label; the first is the default.
export const TABS = { board: 'Board', media: 'Media', workflow: 'Workflow' };
export const tabOr = (t) => (Object.hasOwn(TABS, t || '') ? t : 'board');

// Folder and record slugs as words: "Burned-Out-Woman" → "Burned Out Woman".
export const words = (s) => String(s || '').replace(/[-_]+/g, ' ').trim();

// An ISO time as a short local date and time; '' when missing or invalid.
export const when = (iso) => { const d = new Date(iso); return iso && !Number.isNaN(+d) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''; };

// Seconds as m:ss, or m:ss.hh with `fine` (the editor); 0:00 when unknown.
export function clock(s, fine = false) {
  const x = Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = Math.floor(x / 60), r = x - m * 60;
  return `${m}:${fine ? (Math.floor(r * 100) / 100).toFixed(2).padStart(5, '0') : String(Math.floor(r)).padStart(2, '0')}`;
}

// Ad statuses in workflow order (stored values: tools/record-ad.mjs) and their labels.
export const STATUSES = { 'in-progress': 'In Progress', 'pending-review': 'Pending Review', approved: 'Approved' };
export const statusOf = (rec) => rec?.status || 'in-progress';
export const statusLabel = (s) => STATUSES[s] || words(s);

export const Badge = ({ status }) => {
  const s = status || 'in-progress';
  return <span className="badge" data-status={s}>{statusLabel(s)}</span>;
};

// A side panel's label / value row; id ties the label to a field in the value.
export const Param = ({ label, id, className = '', children }) => (
  <div className={`param ${className}`}>
    {label && (id ? <label className="eyebrow" htmlFor={id}>{label}</label> : <span className="eyebrow">{label}</span>)}
    <div className="param__v">{children}</div>
  </div>
);

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
  return <span key={at} className="bar__count updated-flash">Updated</span>;
}

// Every brand page's frame: navigation on top; the bottom bar has the count, the page's search (centered)
// and its other controls (children, on the right).
export function Bars({ ws, brand, current, count, updatedAt, search, children }) {
  return (
    <>
      <header className="navbar">
        <div className="navbar__path">
          <Link className="navbar__home" href="/?all=1" title="All brands">Ad Harness</Link>
          <Switcher ws={ws} brand={brand} />
        </div>
        <nav className="tabs" aria-label="Sections">
          {Object.entries(TABS).map(([t, label]) => (
            <Link key={t} className="tabs__tab" aria-current={current === t ? 'page' : undefined} href={brandUrl(ws, brand, t)}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <footer className="controlbar">
        <div className="controlbar__start"><span className="bar__count">{count}</span><UpdatedFlash at={updatedAt} /></div>
        {search || <span />}
        <div className="controlbar__end">{children}</div>
      </footer>
    </>
  );
}

export function LoadError({ what, error, onRetry }) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">Could not load {what}.</p>
      <p><code>{error}</code></p>
      <button type="button" className="btn" onClick={onRetry}>Retry</button>
    </div>
  );
}
