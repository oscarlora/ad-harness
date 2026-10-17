'use client';
// Full-screen viewer frame: a top row (close, prev/next, the page's tools), the media below it (a player puts its
// controls in a row under the picture), an optional side panel, viewer keys.
// ratio: an image's width / height, for its crop and safe-zone guides (videos have their own, in Player).
import { useEffect } from 'react';
import { isTyping } from '../lib/client/hooks.js';
import { IcLeft, IcRight, IcX } from './icons.js';
import { MediaBox, SafeZones, useZones, ZoneButton } from './Player.js';

export default function ViewerShell({ onStep, onClose, title, tools, nav = true, ratio = 0, side, children }) {
  // Esc closes; ← / → and ↑ / ↓ step to the previous / next file (a started video takes ← / →); ignored while typing.
  useEffect(() => {
    const onKey = (e) => {
      if (isTyping(e)) return;
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); onStep(-1); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); onStep(1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStep, onClose]);
  const [zone, nextZone] = useZones(ratio);
  return (
    <div className="vw">
      <div className="vw__stage">
        <div className="vw__top">
          <button type="button" className="btn" onClick={onClose} title="Close (Esc)"><IcX /> Close <kbd>Esc</kbd></button>
          {nav && <button type="button" className="btn btn--icon" aria-label="Previous" title="Previous (←)" onClick={() => onStep(-1)}><IcLeft /></button>}
          {nav && <button type="button" className="btn btn--icon" aria-label="Next" title="Next (→)" onClick={() => onStep(1)}><IcRight /></button>}
          {title && <span className="vw__name">{title}</span>}
          <div className="spacer" />
          {nextZone && <ZoneButton mode={zone} onClick={nextZone} className={zone ? 'btn' : 'btn btn--icon'} />}
          {tools}
        </div>
        <div className="vw__media">
          {children}
          {zone && <MediaBox ratio={ratio}><SafeZones mode={zone} ratio={ratio} /></MediaBox>}
        </div>
      </div>
      {side}
    </div>
  );
}
