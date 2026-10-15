'use client';
// The edit's tracks over time: clips, cuts with transitions, caption lines, volume moves, keyframes and notes.
// Click or drag anywhere to move the playhead; clicking a media clip (no drag) opens its trim panel. Each track's
// button turns it off in the preview only (a sound-only track mutes, any other hides and mutes).
import { memo, useRef } from 'react';
import { keyed, tin } from '../../engine/doc.js';
import { clock } from '../BrandPage.js';
import { IcEye, IcEyeOff, IcMute, IcQuote, IcSound } from '../icons.js';

const pct = (x, dur) => `${(x / dur) * 100}%`;
const base = (src) => String(src).split('/').pop().replace(/\.[^.]+$/, '');
const labelOf = (c) => c.name || (c.src ? base(c.src) : c.type === 'text' ? String(c.text).replace(/[{}]/g, '').split('\n')[0] : c.type);
const KEYED = ['x', 'y', 'w', 'h', 'scale', 'rotate', 'opacity', 'blur'];

// Keyframe times of a clip's visual properties and grade.
function keyTimes(c) {
  const ts = new Set();
  for (const v of [...KEYED.map((k) => c[k]), ...Object.values(c.grade || {})]) if (keyed(v)) for (const [k] of v) ts.add(k);
  return [...ts];
}

// A track's volume (dB) as a line over the lane: 0 dB at the top, -30 dB at the bottom.
function Volume({ keys, dur }) {
  const y = (v) => Math.min(100, Math.max(0, (-v / 30) * 100));
  const pts = [[0, keys[0][1]], ...keys.map(([k, v]) => [k, v]), [dur, keys[keys.length - 1][1]]];
  return (
    <svg className="tl-vol" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts.map(([k, v]) => `${(k / dur) * 100},${y(v)}`).join(' ')} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const Track = memo(function Track({ tr, dur, off, onToggle }) {
  const sound = tr.clips.length > 0 && tr.clips.every((c) => c.type === 'audio');
  const label = `${off ? 'Turn on' : 'Turn off'} ${tr.name} (preview only)`;
  return (
    <div className="tl-track">
      <div className="tl-name" title={tr.name}>
        <button type="button" className="tl-toggle" aria-pressed={!off} aria-label={label} title={label} onClick={() => onToggle(tr.name)}>
          {sound ? (off ? <IcMute /> : <IcSound />) : (off ? <IcEyeOff /> : <IcEye />)}
        </button>
        {tr.name}
      </div>
      <div className="tl-lane" data-muted={tr.mute || tr.hidden || undefined}>
        {tr.clips.map((c) => (
          <div key={c.id} className="tl-clip" data-type={c.type} data-id={c.src ? c.id : undefined} style={{ left: pct(c.at, dur), width: pct(c.end - c.at, dur) }} title={`${labelOf(c)} · ${clock(c.at, true)}–${clock(c.end, true)}`}>
            {c.type === 'captions'
              ? (c.lines || []).map((l, i) => <span key={i} className="tl-line" style={{ left: pct(l.at - c.at, c.end - c.at), width: pct(l.end - l.at, c.end - c.at) }} />)
              : <span className="tl-label">{labelOf(c)}</span>}
            {tin(c) > 0 && <span className="tl-tr" title={c.transition.type} />}
            {keyTimes(c).map((k) => <span key={k} className="tl-key" style={{ left: pct(k - c.at, c.end - c.at) }} />)}
            {keyed(c.volume) && <Volume keys={c.volume.map(([k, v]) => [k - c.at, v])} dur={c.end - c.at} />}
          </div>
        ))}
        {keyed(tr.volume) && <Volume keys={tr.volume} dur={dur} />}
        {keyTimes({ ...tr.transform, grade: tr.grade }).map((k) => <span key={k} className="tl-key" style={{ left: pct(k, dur) }} />)}
      </div>
    </div>
  );
});

const rulerStep = (dur) => (dur > 120 ? 30 : dur > 40 ? 10 : dur > 15 ? 5 : 1);
function Ruler({ dur }) {
  const step = rulerStep(dur), marks = [];
  for (let s = 0; s < dur; s += step) marks.push(s);
  return (
    <div className="tl-ruler">
      {marks.map((s) => <span key={s} style={{ left: pct(s, dur) }}>{clock(s)}</span>)}
      {Array.from({ length: Math.ceil(dur) }, (_, s) => (s % step ? <i key={s} className="tl-tick" style={{ left: pct(s, dur) }} /> : null))}
    </div>
  );
}

// children: the transport (play and time), in the corner above the track names.
export default function Timeline({ doc, t, notes, onSeek, onPick, off, onToggle, onClip, children }) {
  const dur = doc.duration || 1;
  const down = useRef(null);
  const clipAt = (e) => { // the media clip under the pointer, through the seek layer on top
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => x.classList?.contains('tl-clip') && x.dataset.id);
    return el?.dataset.id;
  };
  const seekAt = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
  };
  return (
    <div className="tl">
      <div className="tl-track tl-track--head">
        <div className="tl-name tl-transport">{children}</div>
        <div className="tl-lane tl-lane--head">
          <Ruler dur={dur} />
          {notes.map((n) => (
            <button key={n.id} type="button" className="tl-note" data-status={n.status} style={{ left: pct(n.t, dur) }} title={n.text} onClick={() => onPick(n)}><IcQuote /></button>
          ))}
        </div>
      </div>
      {doc.tracks.map((tr, i) => <Track key={i} tr={tr} dur={dur} off={off.has(tr.name)} onToggle={onToggle} />)}
      <div
        className="tl-hit"
        onPointerDown={(e) => { if (e.button === 0) { down.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId); seekAt(e); } }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekAt(e); }}
        onPointerUp={(e) => { if (down.current != null && Math.abs(e.clientX - down.current) < 4) { const id = clipAt(e); if (id) onClip(id); } down.current = null; }}
      >
        <div className="tl-head" style={{ left: pct(t, dur) }} />
      </div>
    </div>
  );
}
