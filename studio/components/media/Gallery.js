'use client';
// The media library: true-aspect justified grid, floating filter bar (type · source · person · ratio · sort + keyword search), hover pills,
// multi-select actions, sprite-strip scrub on video, waveform cards for audio, and the
// full-screen viewer with the editable sidebar. Live-refreshes over SSE.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase, fileUrl, getJson, openFile } from '../../lib/client/api.js';
import { useBrandData } from '../../lib/client/hooks.js';
import { LoadError, ToolbarStart } from '../BrandPage.js';
import { IcCopy, IcDl, IcFolder, IcFull, IcInfo, IcLink } from './icons.js';
import MediaViewer from './MediaViewer.js';
import { drawWave, fmtDur, loadPeaks } from './wave.js';

const TARGET_H = 210;
const GAP = 8;

const aspectOf = (r) => {
  if (r.file?.type === 'audio') return 1.5;
  const w = r.file?.width, h = r.file?.height;
  return w && h ? w / h : 1;
};

function matches(r, filters) {
  if (filters.type && r.file?.type !== filters.type) return false;
  if (filters.source && r.source?.type !== filters.source) return false;
  if (filters.orientation && r.file?.orientation !== filters.orientation) return false;
  if (filters.person === '?' ? !(r.unknown_people || []).length : (filters.person && !(r.people || []).includes(filters.person))) return false;
  if (filters.q) {
    const q = filters.q.toLowerCase();
    const hay = [
      r.file?.name,
      (r.products || []).join(' '),
      (r.people || []).join(' '),
      (r.tags || []).join(' '),
      r.text_in_media,
      r.visual_description,
      (r.scenes || []).map((s) => s.description).join(' '),
      r.audio_description,
      r.audio_transcript?.text,
      (r.unknown_people || []).map((u) => u.description).join(' '),
    ].join(' ').toLowerCase();
    if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
  }
  return true;
}

function AudioCard({ ws, brand, rec, w, h }) {
  const ref = useRef(null);
  useEffect(() => {
    let dead = false;
    const cv = ref.current;
    cv.width = w;
    cv.height = h;
    loadPeaks(ws, brand, rec.id).then((peaks) => { if (!dead && ref.current) drawWave(ref.current, peaks, { color: '#a3a3a3' }); });
    return () => { dead = true; };
  }, [ws, brand, rec.id, w, h]);
  return <canvas ref={ref} />;
}

function Scrub({ ws, brand, rec, w, cardRef }) {
  const sp = rec.sprites;
  const scale = w / sp.frameW;
  const [pos, setPos] = useState('0px 0px');
  // The sheet only holds as many frames as the clip has at this interval — clamp so we never
  // land on empty cells.
  const frames = Math.max(1, Math.min(sp.cols * sp.rows, Math.round((rec.file?.duration || 0) / (sp.interval || 1)) || 1));

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return undefined;
    const onMove = (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const idx = Math.max(0, Math.min(frames - 1, Math.floor(Math.max(0, Math.min(0.999, x)) * frames)));
      setPos(`-${(idx % sp.cols) * sp.frameW * scale}px -${Math.floor(idx / sp.cols) * sp.frameH * scale}px`);
    };
    el.addEventListener('mousemove', onMove);
    return () => el.removeEventListener('mousemove', onMove);
  }, [cardRef, frames, scale, sp.cols, sp.frameW, sp.frameH]);

  return (
    <div
      className="scrub"
      style={{
        backgroundImage: `url(${fileUrl(ws, brand, `inputs/media/${sp.sheet}`)})`,
        backgroundSize: `${sp.cols * sp.frameW * scale}px ${sp.rows * sp.frameH * scale}px`,
        backgroundPosition: pos,
      }}
    />
  );
}

function Card({ ws, brand, rec, w, h, selected, onToggleSel, onOpen, actions }) {
  const cardRef = useRef(null);
  const t = rec.file?.type;
  const pills = [
    ['Open full screen', IcFull, () => onOpen(false)],
    ['Use as reference', IcLink, () => actions.useRef(rec.id)],
    ['Download', IcDl, () => actions.download(rec)],
    ['Copy file name', IcCopy, () => actions.copyName(rec)],
    ['Reveal', IcFolder, () => actions.open(rec, 'reveal')],
    ['Details', IcInfo, () => onOpen(true)],
  ];
  return (
    <div
      ref={cardRef}
      className={`g-card${selected ? ' sel' : ''}`}
      style={{ width: w, height: h }}
      onClick={() => onOpen(false)}
    >
      {t === 'audio'
        ? <AudioCard ws={ws} brand={brand} rec={rec} w={w} h={h} />
        : <img className="ph" loading="lazy" src={fileUrl(ws, brand, `inputs/media/_catalog/thumbs/${rec.id}.jpg`)} alt={rec.file?.name || rec.id} />}
      {t === 'video' && rec.sprites && <Scrub ws={ws} brand={brand} rec={rec} w={w} cardRef={cardRef} />}
      <div
        className={`g-check${selected ? ' on' : ''}`}
        role="checkbox"
        aria-checked={selected}
        aria-label="Select"
        onClick={(e) => { e.stopPropagation(); onToggleSel(rec.id); }}
      />
      <div className="g-card__pills">
        {pills.map(([title, Icon, fn]) => (
          <div key={title} className="g-pill" title={title} onClick={(e) => { e.stopPropagation(); fn(); }}><Icon /></div>
        ))}
      </div>
      <div className="g-card__meta">
        <span className="nm">{rec.file?.name || ''}</span>
        {rec.file?.duration != null && <span className="dur">{fmtDur(rec.file.duration)}</span>}
      </div>
    </div>
  );
}

export default function Gallery({ ws, brand }) {
  const { data, setData, error, load, updatedAt } = useBrandData(ws, brand, 'media');
  const [filters, setFilters] = useState({ q: '', type: '', source: '', person: '', orientation: '', sort: 'new' });
  const [sel, setSel] = useState(() => new Set());
  const [viewerId, setViewerId] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [gridW, setGridW] = useState(0);
  const gridRef = useRef(null);
  const toastTimer = useRef(null);

  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1800);
  }, []);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return undefined;
    const measure = () => {
      const cs = getComputedStyle(el);
      setGridW(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const records = data?.records || [];
  const view = useMemo(() => {
    const v = records.filter((r) => matches(r, filters));
    v.sort((a, b) => (filters.sort === 'old' ? String(a.id).localeCompare(String(b.id)) : String(b.id).localeCompare(String(a.id))));
    return v;
  }, [records, filters]);

  const persons = useMemo(() => {
    const s = new Set();
    records.forEach((r) => (r.people || []).forEach((p) => s.add(p)));
    return [...s].sort();
  }, [records]);

  const rows = useMemo(() => {
    if (!gridW) return [];
    const out = [];
    let row = [], sum = 0;
    for (const r of view) {
      row.push(r);
      sum += aspectOf(r);
      if (sum * TARGET_H + GAP * (row.length - 1) >= gridW) {
        out.push({ items: row, h: (gridW - GAP * (row.length - 1)) / sum });
        row = []; sum = 0;
      }
    }
    if (row.length) out.push({ items: row, h: TARGET_H });
    return out;
  }, [view, gridW]);

  const actions = useMemo(() => ({
    useRef: async (id) => {
      try {
        const r = await getJson(`${apiBase(ws, brand)}/presign?id=${encodeURIComponent(id)}`);
        const url = r.url.startsWith('http') ? r.url : window.location.origin + r.url;
        await navigator.clipboard.writeText(url);
        toast(r.local ? (r.message || 'No R2 creds — copied a local URL') : 'Copied presigned reference URL');
      } catch (e) { toast(String(e.message || e)); }
    },
    download: (rec) => {
      const a = document.createElement('a');
      a.href = fileUrl(ws, brand, `inputs/media/${rec.file?.name}`);
      a.download = rec.file?.name || '';
      a.click();
    },
    copyName: async (rec) => {
      try { await navigator.clipboard.writeText(rec.file?.name || ''); toast('Copied file name'); } catch {}
    },
    open: (rec, mode) =>
      openFile(ws, brand, `inputs/media/${rec.file?.name}`, mode)
        .then(() => toast(mode === 'open' ? 'Opened' : 'Revealed'))
        .catch((e) => toast(String(e.message || e))),
  }), [ws, brand, toast]);

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openViewer = (id, withSide) => { setViewerId(id); if (withSide) setSideOpen(true); };
  const nav = useCallback((d) => {
    setViewerId((cur) => {
      const i = view.findIndex((r) => r.id === cur);
      const j = i + d;
      return j >= 0 && j < view.length ? view[j].id : cur;
    });
  }, [view]);

  const onSaved = (rec) => {
    if (!rec) return;
    setData((d) => (d ? { ...d, records: d.records.map((r) => (r.id === rec.id ? rec : r)) } : d));
  };

  const setF = (k, v) => setFilters((f) => ({ ...f, [k]: v }));
  const viewerRec = viewerId != null ? records.find((r) => r.id === viewerId) : null;

  return (
    <div>
      <div className="toolbar">
        <ToolbarStart ws={ws} brand={brand} current="media" count={data ? `${view.length} of ${records.length} assets` : 'Loading'} updatedAt={updatedAt} />
        <div className="toolbar__spacer" />
        {sel.size > 0 ? (
          <>
            <span className="toolbar__count">{sel.size} selected</span>
            <button type="button" className="btn" onClick={() => [...sel].forEach((id) => actions.useRef(id))}>Use</button>
            <button type="button" className="btn" onClick={() => [...sel].forEach((id) => { const r = records.find((x) => x.id === id); if (r) actions.download(r); })}>Download</button>
            <button type="button" className="btn" onClick={() => [...sel].forEach((id) => { const r = records.find((x) => x.id === id); if (r) actions.open(r, 'reveal'); })}>Reveal</button>
            <button type="button" className="btn" onClick={() => setSel(new Set())}>Clear</button>
          </>
        ) : (
          <>
            <input className="input toolbar__search" placeholder="Search media" value={filters.q} onChange={(e) => setF('q', e.target.value)} />
            <select className="select" aria-label="Type" value={filters.type} onChange={(e) => setF('type', e.target.value)}>
              <option value="">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="audio">Audio</option>
            </select>
            <select className="select" aria-label="Source" value={filters.source} onChange={(e) => setF('source', e.target.value)}>
              <option value="">Any source</option><option value="brand">Brand</option><option value="generated">Generated</option><option value="external">External</option>
            </select>
            <select className="select" aria-label="Person" value={filters.person} onChange={(e) => setF('person', e.target.value)}>
              <option value="">Anyone</option><option value="?">Unidentified</option>
              {persons.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="select" aria-label="Orientation" value={filters.orientation} onChange={(e) => setF('orientation', e.target.value)}>
              <option value="">Any ratio</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option><option value="square">Square</option>
            </select>
            <select className="select" aria-label="Sort" value={filters.sort} onChange={(e) => setF('sort', e.target.value)}>
              <option value="new">Newest</option><option value="old">Oldest</option>
            </select>
          </>
        )}
      </div>

      {error && <LoadError what="the media catalog" error={error} onRetry={load} />}

      <div className="g-page" ref={gridRef}>
        {!error && data && view.length === 0 && <div className="empty-state">No media matches these filters.</div>}
        {rows.map((row, ri) => (
          <div className="g-row" key={ri}>
            {row.items.map((r) => (
              <Card
                key={r.id}
                ws={ws} brand={brand} rec={r}
                w={Math.floor(aspectOf(r) * row.h)} h={Math.floor(row.h)}
                selected={sel.has(r.id)}
                onToggleSel={toggleSel}
                onOpen={(withSide) => openViewer(r.id, withSide)}
                actions={actions}
              />
            ))}
          </div>
        ))}
      </div>

      {viewerRec && (
        <MediaViewer
          ws={ws} brand={brand} rec={viewerRec}
          hasR2={!!data?.hasR2}
          sideOpen={sideOpen}
          onToggleSide={() => setSideOpen((o) => !o)}
          onNav={nav}
          onClose={() => setViewerId(null)}
          onSaved={onSaved}
          actions={actions}
          toast={toast}
        />
      )}

      <div className={`toast${toastMsg ? ' show' : ''}`}>{toastMsg}</div>
    </div>
  );
}
