'use client';
// Studio's player for every video and audio; how it looks and behaves: studio/DESIGN.md (Player).
// keys: take Space and ← / → (the viewers). scenes [{ start, description }] mark the progress bar; sprites
// { url, cols, rows, interval, frameW, frameH } show the frame under the pointer; captions [{ start, end, text }].
import { useEffect, useRef, useState } from 'react';
import { isTyping } from '../lib/client/hooks.js';
import { clock } from './BrandPage.js';
import { IcCaptions, IcFull, IcMute, IcPause, IcPlay, IcSound, IcZones } from './icons.js';

// A box over the media's visible picture (object-fit: contain) of width / height ratio r.
export const MediaBox = ({ ratio, children }) => (
  <div className="media-box"><div className="media-box__inner" style={{ '--r': ratio }}>{children}</div></div>
);
const isVertical = (r) => r > 0.5 && r < 0.6; // 9:16, the placements with UI over the picture
const near = (a, b) => Math.abs(a / b - 1) < 0.03;
const CROP = { '4:5': 4 / 5, '1:1': 1 };

// The guides for media of ratio r, in click order: the feed crops it can be cut to, then (9:16) the Reels safe zone.
const zoneModes = (r) => (r > 0 ? [!near(r, CROP['4:5']) && '4:5', !near(r, CROP['1:1']) && '1:1', isVertical(r) && 'Reels'].filter(Boolean) : []);
// [mode or null, next] — each click shows the next guide, then none.
export function useZones(r) {
  const [mode, setMode] = useState(null);
  const modes = zoneModes(r);
  const on = modes.includes(mode) ? mode : null;
  return [on, modes.length ? () => setMode(modes[modes.indexOf(on) + 1] ?? null) : null];
}
export const ZoneButton = ({ mode, onClick, className }) => (
  <button type="button" className={className} aria-pressed={!!mode} aria-label={mode ? `Guide: ${mode}. Click for the next` : 'Show crop and safe-zone guides'} title="Crop and safe-zone guides" onClick={onClick}>
    <IcZones />{mode && <span>{mode}</span>}
  </button>
);

// A crop guide (the centered part a 4:5 or 1:1 cut keeps) or Meta's Reels safe zone (keep text and product
// out of the top 14%, bottom 35% and 6% each side). Shaded where it is lost or covered.
export function SafeZones({ mode, ratio }) {
  let box = { left: 6, right: 6, top: 14, bottom: 35 };
  if (CROP[mode]) {
    const R = CROP[mode];
    const cut = ratio < R ? (1 - ratio / R) * 50 : (1 - R / ratio) * 50; // % trimmed from each side
    box = ratio < R ? { left: 0, right: 0, top: cut, bottom: cut } : { left: cut, right: cut, top: 0, bottom: 0 };
  }
  const pct = (n) => `${n}%`;
  return (
    <div aria-hidden="true">
      <span className="zones__band" style={{ left: 0, right: 0, top: 0, height: pct(box.top) }} />
      <span className="zones__band" style={{ left: 0, right: 0, bottom: 0, height: pct(box.bottom) }} />
      <span className="zones__band" style={{ left: 0, top: pct(box.top), bottom: pct(box.bottom), width: pct(box.left) }} />
      <span className="zones__band" style={{ right: 0, top: pct(box.top), bottom: pct(box.bottom), width: pct(box.right) }} />
      <span className="zones__safe" style={{ left: pct(box.left), right: pct(box.right), top: pct(box.top), bottom: pct(box.bottom) }}>
        <span className="zones__label">{mode === 'Reels' ? 'Reels safe zone' : `${mode} crop`}</span>
      </span>
    </div>
  );
}
const INSET = 14; // px of track padding each side (matches .player__track::before)
const PEEK_W = 160;
const SNAP_PX = 8;

// The sprite-sheet frame at time t (of dur), as background styles for a box of the frame's shape.
// Clamped to the frames the clip filled, so it never lands on an empty cell.
export function spriteCell(sp, t, dur) {
  const frames = Math.max(1, Math.min(sp.cols * sp.rows, Math.round(dur / (sp.interval || 1)) || 1));
  const i = Math.max(0, Math.min(frames - 1, Math.floor(t / (sp.interval || 1))));
  const pos = (k, n) => `${n > 1 ? (k / (n - 1)) * 100 : 0}%`;
  return {
    backgroundImage: `url(${sp.url})`,
    backgroundSize: `${sp.cols * 100}% ${sp.rows * 100}%`,
    backgroundPosition: `${pos(i % sp.cols, sp.cols)} ${pos(Math.floor(i / sp.cols), sp.rows)}`,
  };
}

export default function Player({ src, kind = 'video', poster, autoPlay = false, muted = false, preload = 'metadata', label, onLoadedMetadata, onTimeUpdate, keys = false, scenes = [], sprites = null, captions = [] }) {
  const wrap = useRef(null);
  const media = useRef(null);
  const [paused, setPaused] = useState(!autoPlay);
  const [isMuted, setMuted] = useState(muted);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [hover, setHover] = useState(null); // { x, t } over the progress bar
  const [ratio, setRatio] = useState(0);
  const [showCaptions, setShowCaptions] = useState(true);
  const [zone, nextZone] = useZones(ratio);
  const started = useRef(autoPlay); // played, stepped or scrubbed, and not at the end
  const frame = useRef(1 / 30); // one frame's length, measured while playing
  const marks = scenes.map((s) => s.start).filter((s) => s > 0);

  // Smooth progress while playing; timeupdate alone ticks about 4 times a second.
  useEffect(() => {
    if (paused) return undefined;
    let raf = 0;
    const tick = () => { setT(media.current?.currentTime || 0); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  // Frame length from two consecutive painted frames.
  useEffect(() => {
    const m = media.current;
    if (paused || !m?.requestVideoFrameCallback) return undefined;
    let last = null, id = 0;
    const onFrame = (_, f) => {
      const d = last == null ? 0 : f.mediaTime - last;
      if (d > 0.008 && d < 0.05) frame.current = d;
      last = f.mediaTime;
      id = m.requestVideoFrameCallback(onFrame);
    };
    id = m.requestVideoFrameCallback(onFrame);
    return () => m.cancelVideoFrameCallback(id);
  }, [paused]);

  const toggle = () => { const m = media.current; if (m) (m.paused ? m.play().catch(() => {}) : m.pause()); };
  const jump = (d) => {
    const m = media.current;
    if (!m) return;
    m.pause();
    m.currentTime = Math.max(0, Math.min((m.duration || 0) - frame.current, m.currentTime + d));
    started.current = true;
    setT(m.currentTime);
  };

  // Capture phase, so a key the video takes never reaches the viewer.
  const onKey = useRef(null);
  onKey.current = (e) => {
    if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' && !e.target.closest?.('button')) { e.preventDefault(); toggle(); return; } // a focused button takes Space
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || kind !== 'video' || !started.current) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    jump((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 5 : frame.current));
  };
  useEffect(() => {
    if (!keys) return undefined;
    const h = (e) => onKey.current(e);
    document.addEventListener('keydown', h, true);
    return () => document.removeEventListener('keydown', h, true);
  }, [keys]);
  // Pointer x on the bar → { x within the bar, time }, snapped to a scene mark when close to one.
  const at = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), w = r.width - 2 * INSET;
    const x = Math.max(0, Math.min(w, e.clientX - r.left - INSET));
    const near = marks.find((s) => Math.abs((s / dur) * w - x) <= SNAP_PX);
    const hit = near != null ? { x: (near / dur) * w + INSET, t: near } : { x: x + INSET, t: (x / w) * dur };
    return { ...hit, w: r.width };
  };
  const seekTo = (e) => {
    const m = media.current;
    if (!m || !dur) return;
    m.currentTime = at(e).t;
    started.current = true;
    setT(m.currentTime);
  };
  const line = showCaptions && captions.find((c) => t >= c.start && t <= c.end);
  const scene = hover && [...scenes].reverse().find((s) => s.start <= hover.t + 0.01);
  const props = {
    ref: media, src, preload, autoPlay, muted: isMuted, 'aria-label': label,
    onPlay: () => { started.current = true; setPaused(false); },
    onPause: () => setPaused(true),
    onEnded: () => { started.current = false; setPaused(true); },
    onTimeUpdate: (e) => { setT(e.currentTarget.currentTime); onTimeUpdate?.(e); },
    onLoadedMetadata: (e) => {
      const v = e.currentTarget;
      setDur(v.duration);
      if (v.videoWidth) setRatio(v.videoWidth / v.videoHeight);
      onLoadedMetadata?.(e);
    },
    onVolumeChange: (e) => setMuted(e.currentTarget.muted),
  };

  return (
    <div ref={wrap} className={`player player--${kind}`}>
      {kind === 'video'
        ? <video {...props} poster={poster} playsInline onClick={toggle} />
        : <audio {...props} />}
      {kind === 'video' && ratio > 0 && (line || zone) && (
        <MediaBox ratio={ratio}>
          {zone && <SafeZones mode={zone} ratio={ratio} />}
          {line && <p className="player__caption">{line.text}</p>}
        </MediaBox>
      )}
      <div className="player__bar">
        <button type="button" className="player__btn" aria-label={paused ? 'Play' : 'Pause'} onClick={toggle}>{paused ? <IcPlay /> : <IcPause />}</button>
        <span className="player__time">{clock(t)} / {clock(dur)}</span>
        <div
          className="player__track" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(t)}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); seekTo(e); }}
          onPointerMove={(e) => { if (dur) setHover(at(e)); if (e.buttons) seekTo(e); }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="player__fill" style={{ width: `calc((100% - ${2 * INSET}px) * ${dur ? t / dur : 0})` }} />
          {dur > 0 && marks.map((s) => <span key={s} className="player__mark" style={{ left: `calc(${INSET}px + (100% - ${2 * INSET}px) * ${s / dur})` }} />)}
          {hover && (sprites || scene) && (
            <div className="player__peek" style={{ left: Math.max(PEEK_W / 2, Math.min(hover.w - PEEK_W / 2, hover.x)), width: PEEK_W }}>
              {sprites && <div className="player__peek-frame" style={{ aspectRatio: sprites.frameW / sprites.frameH, ...spriteCell(sprites, hover.t, dur) }} />}
              <div className="player__peek-text"><b>{clock(hover.t)}</b>{scene?.description ? ` ${scene.description}` : ''}</div>
            </div>
          )}
        </div>
        <button type="button" className="player__btn" aria-label={isMuted ? 'Unmute' : 'Mute'} onClick={() => { if (media.current) media.current.muted = !isMuted; }}>{isMuted ? <IcMute /> : <IcSound />}</button>
        {captions.length > 0 && (
          <button type="button" className="player__btn" aria-pressed={showCaptions} aria-label={showCaptions ? 'Hide captions' : 'Show captions'} title={showCaptions ? 'Hide captions' : 'Show captions'} onClick={() => setShowCaptions(!showCaptions)}><IcCaptions /></button>
        )}
        {kind === 'video' && nextZone && <ZoneButton mode={zone} onClick={nextZone} className={`player__btn${zone ? ' player__btn--wide' : ''}`} />}
        {kind === 'video' && <button type="button" className="player__btn" aria-label="Full screen" onClick={() => wrap.current?.requestFullscreen?.()}><IcFull /></button>}
      </div>
    </div>
  );
}
