'use client';
// Full-screen media viewer: image (proxy → original swap), video (poster + range-aware
// playback), audio (waveform + synced transcript), plus the Notion-style editable sidebar.
// Edits persist through /api/[ws]/[brand]/record (which shells out to record-media.mjs);
// naming an unknown person also updates _catalog/people.json.
import { useEffect, useRef, useState } from 'react';
import { apiBase, fileUrl, postJson } from '../../lib/client/api.js';
import ViewerShell from '../ViewerShell.js';
import { IcDl, IcFolder, IcInfo, IcLink, IcOpen, IcX } from './icons.js';
import { drawWave, fmtDur, loadPeaks } from './wave.js';

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function ImageStage({ ws, brand, rec }) {
  const proxy = fileUrl(ws, brand, `inputs/media/_catalog/proxies/${rec.id}.jpg`);
  const original = fileUrl(ws, brand, `inputs/media/${rec.file?.name}`);
  const [src, setSrc] = useState(proxy);
  useEffect(() => {
    setSrc(proxy);
    const full = new Image();
    full.onload = () => setSrc(original);
    full.src = original; // placeholder → original swap once it arrives (may 302 to R2)
    return () => { full.onload = null; };
  }, [proxy, original]);
  return <img src={src} alt={rec.file?.name || rec.id} />;
}

function AudioStage({ ws, brand, rec }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const audioRef = useRef(null);
  const peaksRef = useRef([]);
  const [time, setTime] = useState(0);
  const [nowIdx, setNowIdx] = useState(-1);

  const words = rec.audio_transcript?.words || [];
  const segments = rec.audio_transcript?.segments || [];

  useEffect(() => {
    let dead = false;
    const cv = canvasRef.current;
    cv.width = wrapRef.current?.clientWidth || 800;
    cv.height = 160;
    const audio = new Audio(fileUrl(ws, brand, `inputs/media/${rec.file?.name}`));
    audioRef.current = audio;
    loadPeaks(ws, brand, rec.id).then((peaks) => {
      if (dead) return;
      peaksRef.current = peaks;
      drawWave(cv, peaks, { color: '#d4d4d4' });
    });
    const onTime = () => {
      if (dead) return;
      const dur = audio.duration || rec.file?.duration || 1;
      drawWave(cv, peaksRef.current, { color: '#d4d4d4', progress: audio.currentTime / dur });
      setTime(audio.currentTime);
    };
    audio.addEventListener('timeupdate', onTime);
    return () => { dead = true; audio.pause(); audio.removeEventListener('timeupdate', onTime); audioRef.current = null; };
  }, [ws, brand, rec.id]);

  useEffect(() => {
    const list = words.length ? words : segments;
    const idx = list.findIndex((x) => time >= x.start && time <= (x.end ?? x.start + 0.4));
    setNowIdx(idx);
  }, [time, words, segments]);

  const seek = (t) => { const a = audioRef.current; if (a) { a.currentTime = t; a.play().catch(() => {}); } };

  return (
    <div className="wf-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          const a = audioRef.current;
          if (!a) return;
          const rect = e.currentTarget.getBoundingClientRect();
          seek(((e.clientX - rect.left) / rect.width) * (a.duration || rec.file?.duration || 0));
        }}
      />
      <div className="wf-time">{fmtDur(time)} / {fmtDur(rec.file?.duration)}</div>
      {(words.length > 0 || segments.length > 0) && (
        <div className="wf-transcript">
          {words.length
            ? words.map((w, i) => (
                <span key={i} className={i === nowIdx ? 'now' : ''} onClick={() => seek(w.start)}>{w.word} </span>
              ))
            : segments.map((s, i) => (
                <span key={i} className={i === nowIdx ? 'now' : ''} onClick={() => seek(s.start)}>
                  {s.speaker ? `${s.speaker}: ` : ''}{s.text}{' '}
                </span>
              ))}
        </div>
      )}
    </div>
  );
}

function SidePanel({ ws, brand, rec, onSaved, toast }) {
  const [products, setProducts] = useState((rec.products || []).join(', '));
  const [people, setPeople] = useState((rec.people || []).join(', '));
  const [tags, setTags] = useState((rec.tags || []).join(', '));
  const [sourceName, setSourceName] = useState(rec.source?.name || '');
  const [vd, setVd] = useState(rec.visual_description || '');
  const [unkNames, setUnkNames] = useState({});
  const [saving, setSaving] = useState(false);
  const f = rec.file || {};

  const save = async () => {
    setSaving(true);
    try {
      const nextPeople = csv(people);
      const remaining = [];
      const named = [];
      (rec.unknown_people || []).forEach((u, i) => {
        const nm = (unkNames[i] || '').trim();
        if (nm) { nextPeople.push(nm); named.push({ name: nm, description: u.description || '' }); }
        else remaining.push(u);
      });
      const patch = {
        products: csv(products),
        people: [...new Set(nextPeople)],
        unknown_people: remaining,
        tags: csv(tags),
        visual_description: vd,
        source: { ...rec.source, name: sourceName },
      };
      const r = await postJson(`${apiBase(ws, brand)}/record`, { id: rec.id, patch, addPeople: named });
      toast('Saved');
      setUnkNames({});
      onSaved(r.record);
    } catch (e) {
      toast(String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="vw__side rise">
      <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-sans)', fontWeight: 600, overflowWrap: 'anywhere' }}>{f.name || rec.id}</h2>
      <div className="vw__file">
        {[f.type, f.width ? `${f.width}×${f.height}` : '', f.orientation, f.aspect, f.bytes ? `${(f.bytes / 1e6).toFixed(2)} MB` : '', f.duration != null ? fmtDur(f.duration) : ''].filter(Boolean).join(' · ')}
      </div>
      <div className="prop">
        <label className="eyebrow" htmlFor="p-products">Products (comma-sep)</label>
        <input id="p-products" value={products} onChange={(e) => setProducts(e.target.value)} />
      </div>
      <div className="prop">
        <label className="eyebrow" htmlFor="p-people">People (comma-sep)</label>
        <input id="p-people" value={people} onChange={(e) => setPeople(e.target.value)} />
      </div>
      {(rec.unknown_people || []).length > 0 && (
        <div className="prop">
          <label className="eyebrow">Unidentified — name to add</label>
          {(rec.unknown_people || []).map((u, i) => (
            <div className="unk" key={i}>
              <span className="desc">{u.description}</span>
              <input placeholder="name" value={unkNames[i] || ''} onChange={(e) => setUnkNames((m) => ({ ...m, [i]: e.target.value }))} />
            </div>
          ))}
        </div>
      )}
      <div className="prop">
        <label className="eyebrow" htmlFor="p-tags">Tags (comma-sep)</label>
        <input id="p-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </div>
      <div className="prop">
        <label className="eyebrow" htmlFor="p-source">Source name</label>
        <input id="p-source" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
      </div>
      <div className="prop">
        <label className="eyebrow" htmlFor="p-vd">Visual description</label>
        <textarea id="p-vd" rows={5} value={vd} onChange={(e) => setVd(e.target.value)} />
      </div>
      {rec.audio_description && (
        <div className="prop"><label className="eyebrow">Sound</label><div className="ro">{rec.audio_description}</div></div>
      )}
      {rec.text_in_media && (
        <div className="prop"><label className="eyebrow">Text in media</label><div className="ro">{rec.text_in_media}</div></div>
      )}
      <div className="prop"><label className="eyebrow">Source type</label><div className="ro">{rec.source?.type || ''}</div></div>
      <div className="prop"><label className="eyebrow">ID</label><div className="ro">{rec.id}</div></div>
      <div className="prop"><label className="eyebrow">sha256</label><div className="ro">{(rec.sha256 || '').slice(0, 16)}…</div></div>
      <div className="prop" style={{ borderTop: 0 }}>
        <button type="button" className="btn btn--primary" disabled={saving} onClick={save}>{saving ? 'Saving' : 'Save'}</button>
      </div>
    </aside>
  );
}

// actions: Gallery's per-asset actions (useRef, download, open) — shared, not duplicated.
export default function MediaViewer({ ws, brand, rec, hasR2, sideOpen, onToggleSide, onNav, onClose, onSaved, actions, toast }) {
  if (!rec) return null;
  const t = rec.file?.type;
  const originalRel = `inputs/media/${rec.file?.name}`;

  return (
    <ViewerShell
      onStep={onNav}
      onClose={onClose}
      close={<><IcX /> Close</>}
      closeTitle="Close"
      backdrop={false}
      tools={<>
        <button type="button" className="btn" onClick={() => actions.useRef(rec.id)} title={hasR2 ? 'Copy a presigned R2 URL' : 'No R2 creds — copies a local URL'}><IcLink /> Use as reference</button>
        <button type="button" className="btn" onClick={() => actions.download(rec)} title="Download original"><IcDl /> Download</button>
        <button type="button" className="btn" onClick={() => actions.open(rec, 'open')} title="Open original locally"><IcOpen /> Open</button>
        <button type="button" className="btn" onClick={() => actions.open(rec, 'reveal')} title="Reveal in file manager"><IcFolder /> Reveal</button>
        <button type="button" className="btn" onClick={onToggleSide} aria-pressed={sideOpen} title="Details"><IcInfo /> Details</button>
      </>}
      side={sideOpen && <SidePanel key={rec.id} ws={ws} brand={brand} rec={rec} onSaved={onSaved} toast={toast} />}
    >
      {t === 'image' && <ImageStage ws={ws} brand={brand} rec={rec} />}
      {t === 'video' && (
        <video
          controls
          poster={fileUrl(ws, brand, `inputs/media/_catalog/thumbs/${rec.id}.jpg`)}
          src={fileUrl(ws, brand, originalRel)}
        />
      )}
      {t === 'audio' && <AudioStage ws={ws} brand={brand} rec={rec} />}
    </ViewerShell>
  );
}
