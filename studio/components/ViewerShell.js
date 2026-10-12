'use client';
// Full-screen viewer frame: top bar, prev/next arrows, optional side panel, viewer keys.
// ratio: an image's width / height, for its crop and safe-zone guides (videos have their own, in Player).
import { useViewerKeys } from '../lib/client/hooks.js';
import { IcLeft, IcRight, IcX } from './icons.js';
import { MediaBox, SafeZones, useZones, ZoneButton } from './Player.js';

export default function ViewerShell({ onStep, onClose, title, tools, nav = true, ratio = 0, side, children }) {
  useViewerKeys(onStep, onClose);
  const [zone, nextZone] = useZones(ratio);
  return (
    <div className="vw">
      <div className="vw__stage">
        <div className="vw__top">
          <button type="button" className="btn" onClick={onClose} title="Close (Esc)"><IcX /> Close <kbd>Esc</kbd></button>
          {title && <span className="vw__name">{title}</span>}
          <div className="spacer" />
          {nextZone && <ZoneButton mode={zone} onClick={nextZone} className={zone ? 'btn' : 'btn btn--icon'} />}
          {tools}
        </div>
        {nav && <button type="button" className="btn btn--icon vw__nav vw__nav--prev" aria-label="Previous" title="Previous (←)" onClick={() => onStep(-1)}><IcLeft /></button>}
        {children}
        {zone && <MediaBox ratio={ratio}><SafeZones mode={zone} ratio={ratio} /></MediaBox>}
        {nav && <button type="button" className="btn btn--icon vw__nav vw__nav--next" aria-label="Next" title="Next (→)" onClick={() => onStep(1)}><IcRight /></button>}
      </div>
      {side}
    </div>
  );
}
