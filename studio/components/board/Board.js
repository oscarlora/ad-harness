'use client';
// The ads board: records + planned slots in one table (thumbnail · status · batch · concept ·
// type · refs · copy · design · prompt), status/batch filters, text search, and a full-screen
// viewer. Data refreshes live over SSE.
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { fileUrl, openFile, workflowUrl } from '../../lib/client/api.js';
import { useBrandData, useCopied } from '../../lib/client/hooks.js';
import { LoadError, ToolbarStart } from '../BrandPage.js';
import ViewerShell from '../ViewerShell.js';

const STATUS_ORDER = ['planned', 'generated', 'draft', 'revision', 'approved', 'synced'];

// Photo- vs graphic-centric: stored if the record says so, else inferred from the refs — a real
// library photo that is not brand-kit material (the type sheet, inputs/media/brand/) means photo-centric.
function imageType(rec) {
  const t = rec?.concept?.imageType;
  if (t) return /photo/i.test(t) ? 'Photo' : 'Graphic';
  const refs = rec?.refs || [];
  const scene = refs.some((r) => /(^|\/)inputs\/media\//.test(r) && !/type_sheet|(^|\/)brand\//i.test(r));
  return scene ? 'Photo' : 'Graphic';
}

// A render is an image or a video ad; videos show their first frame as the thumbnail.
const isVideo = (p) => /\.(mp4|mov|webm|m4v)$/i.test(p || '');
function Render({ video, src, alt, ...props }) {
  return video
    ? <video src={src} muted playsInline preload="metadata" aria-label={alt} {...props} />
    : <img src={src} alt={alt} loading="lazy" {...props} />;
}

function Clamp({ className = '', children }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`clamp${open ? ' open' : ''} ${className}`}
      title="Click to expand/collapse"
      onClick={() => setOpen((o) => !o)}
    >
      {children}
    </div>
  );
}

const Badge = ({ status }) => {
  const s = (status || 'planned').toLowerCase();
  return <span className="badge" data-status={s}>{s}</span>;
};

function PersonaCell({ rec }) {
  const slug = rec?.concept?.persona || '';
  const pd = rec?.personaDetail;
  if (!pd) return slug;
  const head = [pd.age && pd.gender ? `${pd.age} ${pd.gender}` : pd.age || pd.gender, (pd.awareness || '').toLowerCase()].filter(Boolean).join(' · ');
  const lines = [['pain', pd.pain], ['feels', pd.feels], ['wants', pd.wants], ['but', pd.but]].filter(([, v]) => v);
  return (
    <Clamp>
      {slug}
      {head && <div className="persona-detail">{head}</div>}
      {lines.map(([k, v]) => <div key={k} className="persona-detail"><em>{k}</em> {v}</div>)}
    </Clamp>
  );
}

function CopyCell({ copy }) {
  const c = copy || {};
  const extras = Object.entries(c).filter(([k]) => k !== 'hook');
  return (
    <>
      {c.hook ? <div className="hook">{c.hook}</div> : <div className="subcopy"><em>—</em></div>}
      {extras.map(([k, v]) => <div key={k} className="subcopy"><em>{k}:</em> {String(v)}</div>)}
    </>
  );
}

function PromptCell({ prompt }) {
  const [copied, copy] = useCopied();
  if (!prompt) return <span className="subcopy"><em>no prompt (creator-delivered)</em></span>;
  return (
    <>
      <Clamp className="prompt-text">{prompt}</Clamp>
      <button
        type="button"
        className="btn btn--mini"
        style={{ marginTop: '0.35rem' }}
        onClick={() => copy(prompt)}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </>
  );
}

// A copyable text field in the viewer: label + Copy button, then the text.
function CopyField({ label, text, className = '' }) {
  const [copied, copy] = useCopied();
  return (
    <div className="kv">
      <div className="k kv__head">
        <span className="eyebrow">{label}</span>
        <button type="button" className="btn btn--mini" onClick={() => copy(text)}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div className={`v ${className}`}>{text}</div>
    </div>
  );
}

function Viewer({ ws, brand, view, index, onStep, onClose }) {
  const rec = view[index];
  if (!rec) return null;
  const cc = rec.concept || {};
  const gen = rec.generation || null;
  const copyRows = Object.entries(rec.copy || {});
  const openIt = (mode) => openFile(ws, brand, rec.img, mode).catch(() => {});

  return (
    <ViewerShell onStep={onStep} onClose={onClose} side={(
      <aside className="vw__side rise">
        <h2>Ad {rec.id} <Badge status={rec.status} /> {rec.batch && <span className="pill-mark batch-mark">{rec.batch}</span>}</h2>
        <div className="vw__file">{gen?.output || ''}</div>
        <div className="kv">
          <div className="k eyebrow">Concept</div>
          <div className="v"><strong style={{ color: 'var(--fg)' }}>{cc.product || ''}</strong><br />
            {[cc.persona, cc.angle, cc.format, imageType(rec)].filter(Boolean).join(' · ')}</div>
        </div>
        {copyRows.map(([k, v]) => <CopyField key={k} label={k} text={String(v)} className={k === 'hook' ? 'v--big' : ''} />)}
        {rec.meta?.headline && <CopyField label="Meta headline" text={String(rec.meta.headline)} />}
        {rec.meta?.primary_text && <CopyField label="Meta primary text" text={String(rec.meta.primary_text)} className="v--pre" />}
        {rec.design && (
          <div className="kv">
            <div className="k eyebrow">Design</div>
            <div className="v">{rec.design}</div>
          </div>
        )}
        {gen && (
          <div className="kv">
            <div className="k eyebrow">Generation</div>
            <div className="v">{[gen.model, gen.resolution, gen.aspect, gen.size, gen.generatedAt].filter(Boolean).join(' · ')}</div>
          </div>
        )}
        {rec.prompt && (
          <div className="kv">
            <div className="k eyebrow">Prompt</div>
            <div className="v v--mono">{rec.prompt}</div>
          </div>
        )}
        <div className="vw__actions">
          <button type="button" className="btn" onClick={() => openIt('open')}>Open full</button>
          <button type="button" className="btn" onClick={() => openIt('reveal')}>Reveal</button>
          {rec.folder && <Link className="btn" href={workflowUrl(ws, brand, rec.folder)}>Workflow</Link>}
        </div>
      </aside>
    )}>
      {isVideo(rec.img)
        ? <video src={fileUrl(ws, brand, rec.img, rec.__v)} controls autoPlay playsInline aria-label={`Ad ${rec.id}`} />
        : <img src={fileUrl(ws, brand, rec.img, rec.__v)} alt={`Ad ${rec.id}`} />}
    </ViewerShell>
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
      if (status !== 'all' && (r.status || 'planned').toLowerCase() !== status) return false;
      if (batch !== 'all' && r.batch !== batch) return false;
      if (!needle) return true;
      const hay = [r.id, r.status, r.batch, r.design, r.angleSource, r.concept?.product, r.concept?.persona, r.concept?.angle, r.concept?.format,
        ...Object.values(r.personaDetail || {}), ...Object.values(r.copy || {})].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [ads, status, batch, q]);

  const counts = useMemo(() => {
    const c = {};
    ads.forEach((r) => { const s = (r.status || 'planned').toLowerCase(); c[s] = (c[s] || 0) + 1; });
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
      <div className="toolbar">
        <ToolbarStart ws={ws} brand={brand} current="board" count={data ? `${view.length} of ${ads.length} ads` : 'Loading'} updatedAt={updatedAt} />
        <div className="toolbar__spacer" />
        <div className="chips" role="group" aria-label="Status filter">
          <button type="button" className="chip" aria-pressed={status === 'all'} onClick={() => setStatus('all')}>All<small>{ads.length}</small></button>
          {STATUS_ORDER.filter((s) => counts[s]).map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {s}<small>{counts[s]}</small>
            </button>
          ))}
        </div>
        {batches.length > 0 && (
          <select className="select" aria-label="Batch filter" value={batch} onChange={(e) => setBatch(e.target.value)}>
            <option value="all">All batches</option>
            {batches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <input
          className="input toolbar__search"
          placeholder="Search hook, persona, angle, format"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn" title="Reload records" onClick={load}>↻</button>
      </div>

      {error && <LoadError what="ads" error={error} onRetry={load} />}
      {!error && data && view.length === 0 && <div className="empty-state">No ads match.</div>}
      {!error && view.length > 0 && (
        <div className="board-wrap">
          <table className="board-table">
            <colgroup>
              <col style={{ width: 116 }} /><col style={{ width: 50 }} /><col style={{ width: 110 }} /><col style={{ width: 150 }} /><col style={{ width: 118 }} />
              <col style={{ width: 130 }} /><col style={{ width: 150 }} /><col style={{ width: 150 }} /><col style={{ width: 88 }} /><col style={{ width: 132 }} /><col style={{ width: 260 }} /><col style={{ width: 260 }} /><col />
            </colgroup>
            <thead>
              <tr>
                <th className="col-prev eyebrow">Ad</th><th className="eyebrow">ID</th><th className="eyebrow">Status</th><th className="eyebrow">Batch</th><th className="eyebrow">Product</th>
                <th className="eyebrow">Persona</th><th className="eyebrow">Angle</th><th className="eyebrow">Format</th><th className="eyebrow">Type</th><th className="eyebrow">Refs</th><th className="eyebrow">Copy</th><th className="eyebrow">Design</th><th className="eyebrow">Prompt</th>
              </tr>
            </thead>
            <tbody>
              {view.map((rec, i) => (
                <tr key={rec.id}>
                  <td className="col-prev">
                    {rec.__rendered ? (
                      <Render video={isVideo(rec.img)} className="thumb" src={fileUrl(ws, brand, rec.img, rec.__v)} alt={`ad ${rec.id}`} onClick={() => openViewer(i)} />
                    ) : (
                      <div className="thumb thumb--empty">{rec.status === 'planned' ? 'planned' : 'not generated'}</div>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {rec.folder
                      ? <Link className="cell-id" href={workflowUrl(ws, brand, rec.folder)} title="Workflow">{rec.id}</Link>
                      : <span className="cell-id">{rec.id}</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}><Badge status={rec.status} /></td>
                  <td>{rec.batch ? <span className="pill-mark batch-mark">{rec.batch}</span> : null}</td>
                  <td className="cell-product">{rec.concept?.product || ''}</td>
                  <td><PersonaCell rec={rec} /></td>
                  <td>{rec.concept?.angle || ''}{rec.angleSource ? <div className="angle-src">{rec.angleSource}</div> : null}</td>
                  <td>{rec.concept?.format || ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}><span className="pill-mark type-mark">{imageType(rec)}</span></td>
                  <td>
                    {(rec.refs || []).length ? (
                      <div className="refstrip">
                        {rec.refs.map((r, k) => (
                          <a key={k} href={fileUrl(ws, brand, r)} target="_blank" rel="noreferrer" title={r}>
                            <img loading="lazy" src={fileUrl(ws, brand, r)} alt="" />
                          </a>
                        ))}
                      </div>
                    ) : <span className="subcopy"><em>—</em></span>}
                  </td>
                  <td><CopyCell copy={rec.copy} /></td>
                  <td><Clamp className="subcopy">{rec.design || ''}</Clamp></td>
                  <td><PromptCell prompt={rec.prompt} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewerIdx >= 0 && (
        <Viewer ws={ws} brand={brand} view={view} index={viewerIdx} onStep={step} onClose={() => setViewerIdx(-1)} />
      )}
    </div>
  );
}
