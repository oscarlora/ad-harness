'use client';
// The media library: masonry grid, filter bar, multi-select actions, video scrub, audio waves, and the viewer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiBase, fileUrl, getJson, mediaPath, openFile } from '../../lib/client/api.js';
import { masonry, useBrandData, useColumns } from '../../lib/client/hooks.js';
import { Bars, clock, LoadError } from '../BrandPage.js';
import { IcCopy, IcDl, IcFolder, IcFull, IcLink } from '../icons.js';
import { spriteCell } from '../Player.js';
import MediaViewer from './MediaViewer.js';
import { Wave } from './wave.js';

// A card's width / height: the file's, kept between 1:2 and 2:1; audio is a wide strip.
const ratioOf = (r) => {
  if (r.file?.type === 'audio') return 1.5;
  const w = r.file?.width, h = r.file?.height;
  return w && h ? Math.min(2, Math.max(0.5, w / h)) : 1;
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

function Card({ ws, brand, rec, selected, onToggleSel, onOpen, actions }) {
  const t = rec.file?.type;
  const sprites = t === 'video' && rec.sprites && { ...rec.sprites, url: fileUrl(ws, brand, mediaPath(rec.sprites.sheet)) };
  const [x, setX] = useState(0); // the pointer across the card, 0–1, picks the scrub frame
  const pills = [
    ['Open full screen', IcFull, onOpen],
    ['Use as reference', IcLink, () => actions.copyRef([rec.id])],
    ['Download', IcDl, () => actions.download(rec)],
    ['Copy file name', IcCopy, () => actions.copyName(rec)],
    ['Reveal', IcFolder, () => actions.open(rec, 'reveal')],
  ];
  return (
    <div className={`media-frame g-card${selected ? ' sel' : ''}`} style={{ aspectRatio: ratioOf(rec) }}>
      <button
        type="button" className="g-card__open" aria-label={`Open ${rec.file?.name || rec.id}`} onClick={onOpen}
        onPointerMove={sprites ? (e) => { const r = e.currentTarget.getBoundingClientRect(); setX(Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width))); } : undefined}
      >
        {t === 'audio'
          ? <Wave ws={ws} brand={brand} id={rec.id} />
          : <img loading="lazy" src={fileUrl(ws, brand, mediaPath(`_catalog/thumbs/${rec.id}.jpg`))} alt="" />}
        {sprites && <span className="g-card__scrub" style={spriteCell(sprites, x * (rec.file.duration || 0), rec.file.duration || 0)} />}
        <span className="g-card__meta">
          <span className="nm">{rec.file?.name || ''}</span>
          {rec.file?.duration != null && <span className="dur">{clock(rec.file.duration)}</span>}
        </span>
      </button>
      <button type="button" className="g-check" aria-pressed={selected} aria-label="Select" onClick={() => onToggleSel(rec.id)} />
      <div className="g-card__pills">
        {pills.map(([title, Icon, fn]) => (
          <button key={title} type="button" className="g-pill" title={title} aria-label={title} onClick={fn}><Icon /></button>
        ))}
      </div>
    </div>
  );
}

export default function Gallery({ ws, brand }) {
  const { data, setData, error, load, updatedAt } = useBrandData(ws, brand, 'media');
  const [filters, setFilters] = useState({ q: '', type: '', source: '', person: '', orientation: '', sort: 'new' });
  const [sel, setSel] = useState(() => new Set());
  const [viewerId, setViewerId] = useState(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  const toast = useCallback((m) => {
    setToastMsg(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1800);
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

  const n = useColumns();
  const columns = useMemo(() => masonry(view, n, (r) => 1 / ratioOf(r)), [view, n]);

  const actions = useMemo(() => ({
    // Each file's reference link, all copied at once (one per line).
    copyRef: async (ids) => {
      try {
        const rs = await Promise.all(ids.map((id) => getJson(`${apiBase(ws, brand)}/presign?id=${encodeURIComponent(id)}`)));
        await navigator.clipboard.writeText(rs.map((r) => new URL(r.url, window.location.origin).href).join('\n'));
        toast(rs[0].local ? rs[0].message : ids.length > 1 ? `Copied ${ids.length} reference links` : 'Copied reference link');
      } catch (e) { toast(String(e.message || e)); }
    },
    download: (rec) => {
      const a = document.createElement('a');
      a.href = fileUrl(ws, brand, mediaPath(rec.file?.name));
      a.download = rec.file?.name || '';
      a.click();
    },
    copyName: async (rec) => {
      try { await navigator.clipboard.writeText(rec.file?.name || ''); toast('Copied file name'); } catch {}
    },
    open: (rec, mode) =>
      openFile(ws, brand, mediaPath(rec.file?.name), mode)
        .then(() => toast(mode === 'open' ? 'Opened' : 'Revealed'))
        .catch((e) => toast(String(e.message || e))),
  }), [ws, brand, toast]);

  const toggleSel = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const nav = useCallback((d) => {
    setViewerId((cur) => {
      const i = view.findIndex((r) => r.id === cur);
      return i < 0 ? cur : view[(i + d + view.length) % view.length].id;
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
      <Bars
        ws={ws} brand={brand} current="media" count={data ? `${view.length} of ${records.length} assets` : 'Loading'} updatedAt={updatedAt}
        search={sel.size === 0 && <input className="input bar__search" placeholder="Search media" aria-label="Search media" value={filters.q} onChange={(e) => setF('q', e.target.value)} />}
      >
        {sel.size > 0 ? (
          <>
            <span className="bar__count">{sel.size} selected</span>
            <button type="button" className="btn" onClick={() => actions.copyRef([...sel])}>Use</button>
            <button type="button" className="btn" onClick={() => [...sel].forEach((id) => { const r = records.find((x) => x.id === id); if (r) actions.download(r); })}>Download</button>
            <button type="button" className="btn" onClick={() => [...sel].forEach((id) => { const r = records.find((x) => x.id === id); if (r) actions.open(r, 'reveal'); })}>Reveal</button>
            <button type="button" className="btn" onClick={() => setSel(new Set())}>Clear</button>
          </>
        ) : (
          <>
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
      </Bars>

      {error && <LoadError what="the media catalog" error={error} onRetry={load} />}

      <div className="grid-page">
        {!error && data && view.length === 0 && <div className="empty-state">No media matches these filters.</div>}
        <div className="masonry">
          {columns.map((col, ci) => (
            <div className="masonry__col" key={ci}>
              {col.map((r) => (
                <Card
                  key={r.id}
                  ws={ws} brand={brand} rec={r}
                  selected={sel.has(r.id)}
                  onToggleSel={toggleSel}
                  onOpen={() => setViewerId(r.id)}
                  actions={actions}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {viewerRec && (
        <MediaViewer
          ws={ws} brand={brand} rec={viewerRec}
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
