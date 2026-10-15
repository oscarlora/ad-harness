'use client';
// An ad's edit: the live preview (Studio's engine, the same one the export runs), its timeline, and review notes
// pinned to a moment and a spot on the frame. The agent edits the document; the preview follows the file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase, fileUrl, openFile, postJson } from '../../lib/client/api.js';
import { isTyping } from '../../lib/client/hooks.js';
import { compose } from '../../engine/doc.js';
import { clock } from '../BrandPage.js';
import { IcCheck, IcPause, IcPlay, IcX } from '../icons.js';
import { Dot } from '../workflow/parts.js';
import { SafeZones, useZones, ZoneButton } from '../Player.js';
import Timeline from './Timeline.js';
import Trim from './Trim.js';

// A doc path (relative to the ad folder, may climb with ../) as a brand-relative path; climbing past the
// brand keeps its ../ (the shared library).
function brandPath(ad, src) {
  const out = ['outputs', ad];
  for (const part of String(src).split('/')) {
    if (part === '..' && out.length && out.at(-1) !== '..') out.pop(); else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

const STATUS = { open: ['todo', 'Waiting'], seen: ['current', 'Seen'], done: ['done', 'Done: review it'], approved: ['done', 'Approved'] };

export default function Editor({ ws, brand, ad, edit }) {
  const [planFile, setPlanFile] = useState(edit.plans[0].file);
  const plan = edit.plans.find((p) => p.file === planFile) || edit.plans[0];
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [doc, setDoc] = useState(null); // the engine's normalized doc
  const [error, setError] = useState('');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState(null); // a note being written: { t, from (drag start), box, text }
  const [focus, setFocus] = useState(null); // note id
  const [off, setOff] = useState(() => new Set()); // track names turned off in the preview (never written to the doc)
  const [trimId, setTrimId] = useState(null); // the clip open in the trim panel
  const rootRef = useRef(null), tlRef = useRef(null);
  useEffect(() => { // the fixed timeline's height sizes the preview above it
    const el = tlRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => rootRef.current?.style.setProperty('--tl-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!doc]); // eslint-disable-line react-hooks/exhaustive-deps -- tlRef exists once the doc has loaded
  const toggleTrack = useCallback((name) => setOff((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; }), []);
  const live = useRef({ t: 0, busy: false, pending: null, stop: null, until: null, starting: false, actx: null, c0: 0, t0: 0, raf: 0 });

  const versions = useRef({}); // src -> mtime, so a replaced file gets a new URL
  versions.current = plan.media || {};
  const url = useCallback((src) => fileUrl(ws, brand, brandPath(ad, src), versions.current[src]), [ws, brand, ad]);

  // The canvas draws at the size it shows on screen (device pixels), up to the doc's own size.
  const stageRef = useRef(null);
  const fitCanvas = useCallback(([w, h]) => {
    const cv = canvasRef.current, box = stageRef.current?.getBoundingClientRect();
    if (!cv || !box?.width) return false;
    const cw = Math.min(w, 2 * Math.round((box.width * (window.devicePixelRatio || 1)) / 2));
    const ch = Math.round((cw * h) / w);
    if (cv.width === cw && cv.height === ch) return false;
    cv.width = cw;
    cv.height = ch;
    return true;
  }, []);

  // Draw the newest requested time; requests made while drawing collapse into one.
  const draw = useCallback(async (time) => {
    const L = live.current, eng = engineRef.current;
    L.pending = time;
    if (L.busy || !eng?.doc) return;
    L.busy = true;
    try {
      while (L.pending != null) { const x = L.pending; L.pending = null; await eng.render(x, L.stop ? 1 : 0); }
    } catch (e) { setError(String(e.message || e)); } finally { L.busy = false; }
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const d = engineRef.current?.doc;
      if (d && fitCanvas([d.W, d.H])) { engineRef.current.resize(); draw(live.current.t); }
    });
    ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [fitCanvas, draw]);

  const pause = useCallback(() => {
    const L = live.current;
    cancelAnimationFrame(L.raf);
    L.stop?.();
    L.stop = null;
    setPlaying(false);
  }, []);

  const seek = useCallback((time) => {
    const d = engineRef.current?.doc;
    const x = Math.max(0, Math.min(d ? d.duration - 1 / d.fps : 0, time));
    live.current.t = x;
    setT(x);
    if (live.current.stop) { pause(); }
    draw(x);
  }, [draw, pause]);

  // Plays from the playhead; with `until`, stops there (a note's review).
  const play = useCallback(async (until = null) => {
    const L = live.current, eng = engineRef.current;
    if (!eng?.doc || L.stop || L.starting) return;
    L.starting = true;
    L.until = until;
    if (L.t >= eng.doc.duration - 0.05) L.t = 0;
    L.actx ??= new AudioContext({ latencyHint: 'playback' });
    await L.actx.resume();
    const { at, stop } = await eng.play(L.actx, L.t).finally(() => { L.starting = false; });
    L.stop = stop;
    L.c0 = at;
    L.t0 = L.t;
    setPlaying(true);
    setDraft(null);
    const tick = () => {
      if (!L.stop) return;
      const now = L.t0 + Math.max(0, L.actx.currentTime - L.c0);
      const end = Math.min(eng.doc.duration - 1 / eng.doc.fps, L.until ?? Infinity);
      if (now >= end) { L.t = end; setT(end); pause(); return; }
      L.t = now;
      setT(now);
      draw(now);
      L.raf = requestAnimationFrame(tick);
    };
    L.raf = requestAnimationFrame(tick);
  }, [draw, pause]);

  // One engine per mount; the AudioContext lives as long as the editor.
  const [engine, setEngine] = useState(null);
  useEffect(() => {
    let dead = false, eng = null;
    import('../../engine/index.js').then(async ({ createEngine }) => {
      eng = await createEngine({ canvas: canvasRef.current, url });
      if (dead) { eng.close(); return; }
      engineRef.current = eng;
      setEngine(eng);
    }).catch((e) => setError(String(e.message || e)));
    return () => { dead = true; pause(); eng?.close(); engineRef.current = null; };
  }, [url, pause]);
  useEffect(() => () => { const a = live.current.actx; live.current.actx = null; a?.close().catch(() => {}); }, []);

  // (Re)load the document whenever its file changes on disk.
  useEffect(() => {
    if (!engine) return undefined;
    let dead = false;
    (async () => {
      // A file caught mid-write reads as broken JSON: read it again before calling it an error.
      const get = (p) => fetch(fileUrl(ws, brand, p, plan.v), { cache: 'no-store' }).then((r) => r.json());
      const read = async () => { const own = await get(plan.p); return own.base ? compose(own, await get(plan.p.replace(/[^/]+$/, own.base))) : own; };
      const raw = await read().catch(() => new Promise((r) => setTimeout(r, 250)).then(read));
      const wasPlaying = !!live.current.stop;
      if (wasPlaying) pause();
      fitCanvas(raw.size || [1080, 1920]);
      const shown = { ...raw, tracks: (raw.tracks || []).map((tr) => (off.has(tr.name) ? { ...tr, hidden: true, mute: true } : tr)) };
      const d = await engine.load(shown, raw.fx ? `${url(raw.fx)}&v=${Date.now()}` : null); // fx.js re-imported fresh
      if (dead) return;
      setDoc(d);
      setError('');
      await draw(Math.min(live.current.t, d.duration - 1 / d.fps));
      if (wasPlaying) play(live.current.until);
    })().catch((e) => { if (!dead) setError(`${plan.file}: ${e.message || e}`); });
    return () => { dead = true; };
  }, [engine, ws, brand, plan.p, plan.v, plan.file, off, url, draw, pause, play, fitCanvas]);

  // Space plays, arrows step a frame (with Shift, a second).
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e) || !doc) return;
      if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); live.current.stop ? pause() : play(); } // a focused button takes Space
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        seek(live.current.t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 1 / doc.fps));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [doc, play, pause, seek]);

  // Drag on the frame to mark a spot (a click marks the moment), then write the note.
  const at = (e) => {
    const r = stageRef.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const onPointerDown = (e) => {
    if (!doc || e.button !== 0) return;
    pause();
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    setFocus(null);
    setDraft({ t: live.current.t, from: [x, y], box: [x, y, 0, 0], text: '' });
  };
  const onPointerMove = (e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const [x1, y1] = at(e);
    setDraft((d) => d && { ...d, box: [Math.min(d.from[0], x1), Math.min(d.from[1], y1), Math.abs(x1 - d.from[0]), Math.abs(y1 - d.from[1])] });
  };
  // The click itself takes focus off the new field.
  const onPointerUp = () => requestAnimationFrame(() => composeRef.current?.focus());

  // Esc or a click anywhere else discards the note being written.
  const composeRef = useRef(null);
  const drafting = !!draft;
  useEffect(() => {
    if (!drafting) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setDraft(null); };
    const onDown = (e) => { if (!stageRef.current?.contains(e.target)) setDraft(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [drafting]);

  const saveDraft = async () => {
    const d = draft;
    if (!d?.text.trim()) return setDraft(null);
    const box = d.box[2] > 0.01 || d.box[3] > 0.01 ? d.box : null;
    setDraft(null);
    await postJson(`${apiBase(ws, brand)}/edit`, { ad, note: { t: d.t, box, text: d.text, plan: plan.file } }).catch((e) => setError(e.message));
  };
  const noteAction = (body) => postJson(`${apiBase(ws, brand)}/edit`, { ad, ...body }).catch((e) => setError(e.message));
  const pick = (n) => { setFocus(n.id); seek(n.t); };
  // Plays what changed for a note: its changed stretch (or its moment), with a second either side.
  const review = (n) => {
    const [a, b] = n.span || [n.t, n.t + 1];
    setFocus(n.id);
    seek(Math.max(0, a - 1));
    play(b + 1);
  };

  const notes = useMemo(() => edit.notes.filter((n) => (n.plan || 'edit.json') === plan.file), [edit.notes, plan.file]);
  const pending = useMemo(() => notes.filter((n) => n.status !== 'approved'), [notes]);
  const shown = notes.filter((n) => n.box && (n.id === focus || (!playing && n.status !== 'done' && n.status !== 'approved' && Math.abs(n.t - t) < 0.2)));
  const exp = edit.export?.plan === plan.file ? edit.export : null;
  const W = doc?.W || 1080, H = doc?.H || 1920;
  const [zone, nextZone] = useZones(W / H);
  const trimClip = trimId && doc?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === trimId);
  const applyTrim = (cut) => postJson(`${apiBase(ws, brand)}/edit`, { ad, trim: { plan: plan.file, id: trimId, ...cut } })
    .then(() => setTrimId(null)).catch((e) => setError(e.message));

  return (
    <div className="ed" ref={rootRef}>
      <div className="ed__main">
        <div className="ed__stage" ref={stageRef} style={{ aspectRatio: `${W} / ${H}` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} role="img" aria-label="Preview: click or drag to leave a note">
          <canvas ref={canvasRef} />
          {zone && <div className="ed__zones"><SafeZones mode={zone} ratio={W / H} /></div>}
          {shown.map((n) => (
            <div key={n.id} className="ed__box" data-status={n.status} style={boxStyle(n.box)} />
          ))}
          {draft && (
            <>
              {(draft.box[2] > 0.01 || draft.box[3] > 0.01) && <div className="ed__box ed__box--draft" style={boxStyle(draft.box)} />}
              <form className="ed__compose" style={composeStyle(draft.box)} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); saveDraft(); }}>
                <textarea
                  ref={composeRef} autoFocus rows={2} value={draft.text} placeholder={`Note at ${clock(draft.t, true)}`}
                  onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDraft(); }
                  }}
                />
              </form>
            </>
          )}
          {!doc && !error && <div className="ed__wait">Loading</div>}
        </div>
      </div>
      <aside className="ed__side">
        <div className="ed__head">
          {edit.plans.length > 1 && (
            <div className="chips">
              {edit.plans.map((p) => (
                <button key={p.file} type="button" className="chip" aria-pressed={p.file === plan.file} onClick={() => { pause(); setPlanFile(p.file); }}>{p.label}</button>
              ))}
            </div>
          )}
          <div className="spacer" />
          {nextZone && <ZoneButton mode={zone} onClick={nextZone} className={zone ? 'btn' : 'btn btn--icon'} />}
          <Export ws={ws} brand={brand} ad={ad} plan={plan} exp={exp} onError={setError} />
        </div>
        {error && <p className="ed__error">{error}</p>}
        <Notes notes={notes} focus={focus} onPick={pick} onReview={review} onAction={noteAction} lead={(n) => <span className="ed-note__time">{clock(n.t, true)}</span>} hint="Click or drag on the video to leave a note." />
      </aside>
      {doc && (
        <div className="ed__tl" ref={tlRef}>
        <Timeline doc={doc} t={t} notes={pending} onSeek={seek} onPick={pick} off={off} onToggle={toggleTrack} onClip={(id) => { pause(); setTrimId(id); }}>
          <button type="button" className="ed__play" onClick={() => (playing ? pause() : play())} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <IcPause /> : <IcPlay />}
          </button>
          <span className="ed__clock">{clock(t, true)}<span> / {clock(doc.duration, true)}</span></span>
        </Timeline>
        </div>
      )}
      {trimClip && <Trim key={trimClip.id} clip={trimClip} src={url(trimClip.src)} onApply={applyTrim} onClose={() => setTrimId(null)} />}
    </div>
  );
}

const pct = (x) => `${x * 100}%`;
const boxStyle = ([x, y, w, h]) => ({ left: pct(x), top: pct(y), width: pct(w), height: pct(h) });
// The note field sits under the marked spot, or above it near the bottom.
const composeStyle = ([x, y, w, h]) => (y + h > 0.75 ? { left: pct(Math.min(x, 0.45)), bottom: pct(1 - y + 0.01) } : { left: pct(Math.min(x, 0.45)), top: pct(y + h + 0.01) });

function Export({ ws, brand, ad, plan, exp, onError }) {
  const running = exp?.state === 'running';
  const start = () => postJson(`${apiBase(ws, brand)}/edit`, { ad, export: plan.file }).catch((e) => onError(e.message));
  return (
    <div className="ed__export">
      {exp?.state === 'done' && exp.out && (
        <button type="button" className="btn" onClick={() => openFile(ws, brand, brandPath(ad, exp.out)).catch((e) => onError(e.message))} title={exp.out}>Open video</button>
      )}
      {exp?.state === 'failed' && <span className="ed__fail" title={exp.error}>Export failed</span>}
      <button type="button" className="btn btn--primary" onClick={start} disabled={running}>
        {running ? `Exporting ${Math.round((exp.progress || 0) * 100)}%` : 'Export'}
      </button>
    </div>
  );
}

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
