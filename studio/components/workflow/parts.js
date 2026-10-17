'use client';
import { useEffect, useState } from 'react';
import { fileUrl } from '../../lib/client/api.js';
import { IcCheck, IcPlay, IcX } from '../icons.js';

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

// A note field: Enter sends its text (onSend, when there is any) and closes it, Shift+Enter is a line break, Esc
// closes it; with sendOnBlur, leaving it sends too. ref reaches the textarea; other props go to its box.
export function Compose({ value, onChange, onSend, onClose, sendOnBlur, placeholder, ref, className = '', ...rest }) {
  const send = () => { if (value.trim()) onSend(value.trim()); onClose(); };
  return (
    <div className={`ed__compose ${className}`.trim()} {...rest}>
      <textarea
        ref={ref} autoFocus rows={2} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} onBlur={sendOnBlur ? send : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
        }}
      />
    </div>
  );
}

const STATUS = { open: ['todo', 'Waiting'], seen: ['current', 'Seen'], done: ['done', 'Done: review it'], approved: ['done', 'Approved'] };

// Pending notes, done ones first (to review and approve); approved ones only in the history. Notes come in order;
// lead(n) shows what a note is on (its moment, or the text it quotes); onReview (optional) plays a done one's change.
export function Notes({ notes, focus, onPick, onReview, onAction, lead, hint }) {
  const [history, setHistory] = useState(false);
  const approved = notes.filter((n) => n.status === 'approved');
  const order = { done: 0, seen: 1, open: 1 };
  const list = history ? approved
    : notes.filter((n) => n.status !== 'approved').sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  return (
    <section className="ed__notes">
      <div className="ed__notes-head">
        <span className="eyebrow">{history ? 'Approved' : 'Notes'}</span>
        <div className="spacer" />
        {!history && list.length > 0 && (
          <button type="button" className="ed__history" title="Move every note to the history" onClick={() => list.forEach((n) => onAction({ approve: n.id }))}>Archive all</button>
        )}
        {(approved.length > 0 || history) && (
          <button type="button" className="ed__history" onClick={() => setHistory(!history)}>{history ? 'Back to notes' : `History (${approved.length})`}</button>
        )}
      </div>
      {!list.length && <p className="flow-note">{history ? 'Nothing approved yet.' : hint}</p>}
      <ul>
        {list.map((n) => {
          const [state, label] = STATUS[n.status] || STATUS.open;
          return (
            <li key={n.id} className="ed-note" data-status={n.status} aria-current={n.id === focus || undefined}>
              <button type="button" className="ed-note__main" onClick={() => onPick(n)}>
                {lead(n)}
                <span className="ed-note__text">{n.text}</span>
              </button>
              <div className="ed-note__acts">
                {onReview && (n.status === 'done' || n.status === 'approved') && (
                  <button type="button" className="ed-note__act" title="Watch the change" aria-label="Watch the change" onClick={() => onReview(n)}><IcPlay /></button>
                )}
                {n.status === 'done' && (
                  <button type="button" className="ed-note__act ed-note__act--ok" title="Approve" aria-label="Approve" onClick={() => onAction({ approve: n.id })}><IcCheck /></button>
                )}
                {n.status !== 'approved' && (
                  <button type="button" className="ed-note__act" title="Delete note" aria-label="Delete note" onClick={() => onAction({ remove: n.id })}><IcX /></button>
                )}
                <Dot state={state} title={label} />
              </div>
              {n.reply && <p className="ed-note__reply">{n.reply}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
