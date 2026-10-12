'use client';
// The ads board: records + batch-plan slots not made yet as a masonry grid, with filters, search and a full-screen viewer.
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { fileUrl, openFile, workflowUrl } from '../../lib/client/api.js';
import { masonry, useBrandData, useColumns, useCopied } from '../../lib/client/hooks.js';
import { Badge, Bars, LoadError, Param, STATUSES, statusLabel, statusOf, when, words } from '../BrandPage.js';
import Player from '../Player.js';
import ViewerShell from '../ViewerShell.js';

// Photo- vs graphic-centric: from the record, else photo-centric when a ref is a library photo outside the brand kit.
function imageType(rec) {
  const t = rec?.concept?.imageType;
  if (t) return /photo/i.test(t) ? 'Photo' : 'Graphic';
  const refs = rec?.refs || [];
  const scene = refs.some((r) => /(^|\/)inputs\/media\//.test(r) && !/type_sheet|(^|\/)brand\//i.test(r));
  return scene ? 'Photo' : 'Graphic';
}

// The line that names the ad: its hook, else its first hook variant, else its angle.
const hookOf = (rec) => {
  const c = rec.copy || {};
  return c.hook || Object.entries(c).find(([k]) => /^hook/i.test(k))?.[1] || words(rec.concept?.angle) || '';
};

const sentence = (s) => { const w = words(s); return w.charAt(0).toUpperCase() + w.slice(1); };

const isVideo = (p) => /\.(mp4|mov|webm|m4v)$/i.test(p || '');
// A copyable value; the copy button shows on hover.
function CopyParam({ label, text, className = '' }) {
  const [copied, copy] = useCopied();
  return (
    <Param label={label} className={`param--copy ${className}`}>
      <span>{text}</span>
      <button type="button" className="btn btn--mini" onClick={() => copy(text)}>{copied ? 'Copied' : 'Copy'}</button>
    </Param>
  );
}

function Viewer({ ws, brand, view, index, onStep, onClose }) {
  const rec = view[index];
  const [loaded, setLoaded] = useState({ src: '', ratio: 0 }); // the shown image's width / height
  const src = rec ? fileUrl(ws, brand, rec.img, rec.__v) : '';
  if (!rec) return null;
  const cc = rec.concept || {};
  const pd = rec.personaDetail;
  const gen = rec.generation || null;
  const copyRows = Object.entries(rec.copy || {});
  const openIt = (mode) => openFile(ws, brand, rec.img, mode).catch(() => {});
  const personaHead = pd && [pd.age && pd.gender ? `${pd.age} ${pd.gender}` : pd.age || pd.gender, (pd.awareness || '').toLowerCase()].filter(Boolean).join(', ');

  return (
    <ViewerShell onStep={onStep} onClose={onClose} ratio={!isVideo(rec.img) && loaded.src === src ? loaded.ratio : 0} side={(
      <aside className="vw__side rise">
        <h2>Ad {rec.id}</h2>
        <div className="params">
          <Param label="Status"><Badge status={rec.status} /></Param>
          {rec.sentTo && (
            <Param label="Sent to">
              <span className="param__links">
                {Object.entries(rec.sentTo).map(([dest, url]) => <a key={dest} href={url} target="_blank" rel="noreferrer">{sentence(dest)}</a>)}
              </span>
            </Param>
          )}
          {rec.batch && <Param label="Batch">{rec.batch}</Param>}
          <Param label="Product">{words(cc.product)}</Param>
          <Param label="Format">{words(cc.format)}</Param>
          <Param label="Type">{imageType(rec)}</Param>
        </div>
        <div className="params">
          {cc.persona && <Param label="Persona">{words(cc.persona)}</Param>}
          {personaHead && <Param label="Who">{personaHead}</Param>}
          {pd && [['Pain', pd.pain], ['Feels', pd.feels], ['Wants', pd.wants], ['But', pd.but]].filter(([, v]) => v).map(([k, v]) => <Param key={k} label={k}>{v}</Param>)}
          {cc.angle && <Param label="Angle">{words(cc.angle)}</Param>}
          {rec.angleSource && <Param label="Angle source">{rec.angleSource}</Param>}
        </div>
        <div className="params">
          {copyRows.map(([k, v]) => <CopyParam key={k} label={sentence(k)} text={String(v)} className={k === 'hook' ? 'param--strong' : ''} />)}
          {rec.meta?.headline && <CopyParam label="Meta headline" text={String(rec.meta.headline)} />}
          {rec.meta?.primary_text && <CopyParam label="Meta primary text" text={String(rec.meta.primary_text)} />}
        </div>
        <div className="params">
          {rec.design && <Param label="Design">{rec.design}</Param>}
          {(rec.refs || []).length > 0 && (
            <Param label="References">
              <div className="refstrip">
                {rec.refs.map((r, k) => (
                  <a key={k} href={fileUrl(ws, brand, r)} target="_blank" rel="noreferrer" title={r}>
                    <span className="media-frame"><img loading="lazy" src={fileUrl(ws, brand, r, undefined, 160)} alt="" /></span>
                  </a>
                ))}
              </div>
            </Param>
          )}
          {gen && [['Model', gen.model], ['Resolution', gen.resolution], ['Aspect', gen.aspect], ['Dimensions', /^\d+x\d+$/.test(gen.size || '') && gen.size], ['Generated', when(gen.generatedAt)]].filter(([, v]) => v).map(([k, v]) => <Param key={k} label={k}>{String(v)}</Param>)}
          {rec.prompt && <CopyParam label="Prompt" text={rec.prompt} className="param--long" />}
          {gen?.output && <Param label="File" className="param--long">{gen.output}</Param>}
        </div>
        <div className="vw__actions">
          <button type="button" className="btn" onClick={() => openIt('open')}>Open full</button>
          <button type="button" className="btn" onClick={() => openIt('reveal')}>Reveal</button>
          {rec.folder && <Link className="btn" href={workflowUrl(ws, brand, rec.folder)}>Workflow</Link>}
        </div>
      </aside>
    )}>
      {isVideo(rec.img)
        ? <Player key={rec.id} src={src} autoPlay keys label={`Ad ${rec.id}`} />
        : <img src={src} alt={`Ad ${rec.id}`} onLoad={(e) => setLoaded({ src, ratio: e.target.naturalWidth / e.target.naturalHeight })} />}
    </ViewerShell>
  );
}

// Width / height: the generation's aspect ("4:5") until the render loads, else a 9:16 video or a 4:5 image.
function ratioGuess(rec) {
  const m = String(rec.generation?.aspect || '').match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (m) return m[1] / m[2];
  return isVideo(rec.img) ? 9 / 16 : 4 / 5;
}

// Just the render, as in Media; ID and status show on hover.
function AdCard({ ws, brand, rec, onOpen }) {
  const [ratio, setRatio] = useState(() => ratioGuess(rec));
  const fit = (w, h) => w && h && setRatio(w / h);
  if (!rec.__rendered) {
    return <div className="media-frame media-frame--empty" style={{ aspectRatio: ratio }}>#{rec.id} · {statusLabel(statusOf(rec))}</div>;
  }
  return (
    <button type="button" className="media-frame" style={{ aspectRatio: ratio }} aria-label={`Open ad ${rec.id}`} onClick={onOpen}>
      {isVideo(rec.img)
        // #t= makes the browser paint the video's first frame.
        ? <video src={`${fileUrl(ws, brand, rec.img, rec.__v)}#t=0.1`} muted playsInline preload="metadata" onLoadedMetadata={(e) => fit(e.target.videoWidth, e.target.videoHeight)} />
        : <img src={fileUrl(ws, brand, rec.img, rec.__v, 800)} alt={`Ad ${rec.id}`} loading="lazy" onLoad={(e) => fit(e.target.naturalWidth, e.target.naturalHeight)} />}
      <span className="g-card__meta"><span className="nm">#{rec.id} · {hookOf(rec)}</span><span className="dur">{statusLabel(statusOf(rec))}</span></span>
    </button>
  );
}

function Grid({ ws, brand, view, onOpen }) {
  const n = useColumns();
  const index = new Map(view.map((r, i) => [r.id, i]));
  return (
    <div className="masonry grid-page">
      {masonry(view, n, (r) => 1 / ratioGuess(r)).map((col, ci) => (
        <div className="masonry__col" key={ci}>
          {col.map((rec) => <AdCard key={rec.id} ws={ws} brand={brand} rec={rec} onOpen={() => onOpen(index.get(rec.id))} />)}
        </div>
      ))}
    </div>
  );
}

export default function Board({ ws, brand }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, 'ads');
  const [status, setStatus] = useState('all');
  const [batch, setBatch] = useState('all');
  const [q, setQ] = useState('');
  const [viewerIdx, setViewerIdx] = useState(-1);

  const ads = useMemo(
    () => (data?.ads || []).map((rec) => ({
      ...rec,
      __rendered: !!rec.img,
      __v: rec.imgVersion || rec.generation?.generatedAt || '0',
    })),
    [data],
  );

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ads.filter((r) => {
      if (status !== 'all' && statusOf(r) !== status) return false;
      if (batch !== 'all' && r.batch !== batch) return false;
      if (!needle) return true;
      const hay = [r.id, r.status, r.batch, r.design, r.angleSource, r.concept?.product, r.concept?.persona, r.concept?.angle, r.concept?.format,
        ...Object.values(r.personaDetail || {}), ...Object.values(r.copy || {})].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [ads, status, batch, q]);

  const counts = useMemo(() => {
    const c = {};
    ads.forEach((r) => { const s = statusOf(r); c[s] = (c[s] || 0) + 1; });
    return c;
  }, [ads]);

  const openViewer = (i) => { if (view[i]?.__rendered) setViewerIdx(i); };
  const step = useCallback((d) => {
    setViewerIdx((cur) => {
      let j = cur;
      for (let n = 0; n < view.length; n++) {
        j = (j + d + view.length) % view.length;
        if (view[j].__rendered) return j;
      }
      return cur;
    });
  }, [view]);

  const batches = data?.batches || [];

  return (
    <div>
      <Bars
        ws={ws} brand={brand} current="board" count={data ? `${view.length} of ${ads.length} ads` : 'Loading'} updatedAt={updatedAt}
        search={<input className="input bar__search" placeholder="Search ads" aria-label="Search hook, persona, angle, format" value={q} onChange={(e) => setQ(e.target.value)} />}
      >
        <div className="chips" role="group" aria-label="Status filter">
          <button type="button" className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All<small>{ads.length}</small></button>
          {[...new Set([...Object.keys(STATUSES), ...Object.keys(counts)])].filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {statusLabel(s)}<small>{counts[s]}</small>
            </button>
          ))}
        </div>
        {batches.length > 0 && (
          <select className="select" aria-label="Batch filter" value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="all">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </Bars>

      {error && <LoadError what="ads" error={error} onRetry={load} />}
      {!error && data && view.length === 0 && <div className="empty-state">No ads match.</div>}
      {!error && view.length > 0 && <Grid ws={ws} brand={brand} view={view} onOpen={openViewer} />}

      {viewerIdx >= 0 && (
        <Viewer ws={ws} brand={brand} view={view} index={viewerIdx} onStep={step} onClose={() => setViewerIdx(-1)} />
      )}
    </div>
  );
}
