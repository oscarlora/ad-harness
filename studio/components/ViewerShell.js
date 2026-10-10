'use client';
// The full-screen viewer frame shared by the Board, Media and Workflow pages: a stage with a top
// bar (Close, then `tools` on the right), prev/next arrows around the content, an optional side
// panel, and the viewer keys (Esc closes, arrows step).
// backdrop: clicking empty space closes — 'outer' (the frame), 'stage' (the stage too), or false.
import { useViewerKeys } from '../lib/client/hooks.js';

export default function ViewerShell({ onStep, onClose, close = 'Esc · Close', closeTitle, tools, nav = true, backdrop = 'outer', side, children }) {
  useViewerKeys(onStep, onClose);
  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };
  return (
    <div className="vw" onClick={backdrop ? onBackdrop : undefined}>
      <div className="vw__stage" onClick={backdrop === 'stage' ? onBackdrop : undefined}>
        <div className="vw__top">
          <button type="button" className="btn" onClick={onClose} title={closeTitle}>{close}</button>
          <div className="vw__top-spacer" />
          {tools}
        </div>
        {nav && <button type="button" className="vw__nav vw__nav--prev" aria-label="Previous" onClick={() => onStep(-1)}>‹</button>}
        {children}
        {nav && <button type="button" className="vw__nav vw__nav--next" aria-label="Next" onClick={() => onStep(1)}>›</button>}
      </div>
      {side}
    </div>
  );
}
