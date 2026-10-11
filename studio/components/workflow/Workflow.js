'use client';
// The Workflow page: the ad list with current steps (no `ad`), or one ad's step bar and artifacts.
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { brandUrl, fileUrl, workflowUrl } from '../../lib/client/api.js';
import { useBrandData } from '../../lib/client/hooks.js';
import { LoadError, ToolbarStart } from '../BrandPage.js';
import Editor from '../edit/Editor.js';
import ViewerShell from '../ViewerShell.js';
import { Dot, MdFile, TextDisclosure } from './parts.js';
import Markdown from './Markdown.js';
import Storyboard from './Storyboard.js';

const words = (s) => String(s || '').replace(/-/g, ' ');
const baseName = (n) => n.split('/').pop();
const STATE = { done: 'Done', current: 'Current', todo: 'Not started' };

function Lightbox({ ws, brand, images, index, onStep, onClose }) {
  const f = images[index];
  return (
    <ViewerShell onStep={onStep} onClose={onClose} backdrop="stage" nav={images.length > 1} tools={<span className="toolbar__count">{baseName(f.name)}</span>}>
      <img src={fileUrl(ws, brand, f.p, f.v)} alt={f.name} />
    </ViewerShell>
  );
}

// A step's files, rendered by kind.
function Files({ ws, brand, files }) {
  const [zoom, setZoom] = useState(-1);
  const images = files.filter((f) => f.type === 'image');
  const videos = files.filter((f) => f.type === 'video');
  const step = useCallback((d) => setZoom((i) => (i + d + images.length) % images.length), [images.length]);
  const close = useCallback(() => setZoom(-1), []);
  const name = (f) => <figcaption>{baseName(f.name)}</figcaption>;
  return (
    <div className="flow-files">
      {files.filter((f) => f.type === 'md').map((f) => (
        <section key={f.p}>
          {files.length > 1 && <div className="eyebrow">{baseName(f.name)}</div>}
          <MdFile ws={ws} brand={brand} file={f} />
        </section>
      ))}
      {images.length > 0 && (
        <div className="flow-grid">
          {images.map((f, i) => (
            <figure key={f.p} className="flow-tile">
              <img src={fileUrl(ws, brand, f.p, f.v)} alt={f.name} loading="lazy" onClick={() => setZoom(i)} />
              {name(f)}
              {f.prompt && <TextDisclosure ws={ws} brand={brand} label="Prompt" file={f.prompt} />}
            </figure>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flow-grid flow-grid--video">
          {videos.map((f) => (
            <figure key={f.p} className="flow-tile">
              <video src={fileUrl(ws, brand, f.p, f.v)} controls playsInline preload={videos.length > 4 ? 'none' : 'metadata'} />
              {name(f)}
            </figure>
          ))}
        </div>
      )}
      {files.filter((f) => f.type === 'audio').map((f) => (
        <figure key={f.p} className="flow-audio">
          {name(f)}
          <audio src={fileUrl(ws, brand, f.p, f.v)} controls preload="none" />
        </figure>
      ))}
      {files.filter((f) => f.type === 'txt').map((f) => <TextDisclosure key={f.p} ws={ws} brand={brand} label={baseName(f.name)} file={f} />)}
      {files.filter((f) => f.type === 'pdf' || f.type === 'other').map((f) => (
        <a key={f.p} className="flow-link" href={fileUrl(ws, brand, f.p, f.v)} target="_blank" rel="noreferrer">{baseName(f.name)}</a>
      ))}
      {zoom >= 0 && images[zoom] && <Lightbox ws={ws} brand={brand} images={images} index={zoom} onStep={step} onClose={close} />}
    </div>
  );
}

function Panel({ ws, brand, step, data }) {
  const pn = step.panel || {};
  const { storyboard } = data;
  if (pn.editor) return <section className="flow-panel"><Editor ws={ws} brand={brand} ad={data.folder} edit={data.edit} /></section>;
  const has = pn.note || pn.md || pn.fields || pn.files || (pn.storyboard && storyboard);
  return (
    <section className="flow-panel">
      {!has && <p className="flow-note">{step.done ? 'Nothing to show for this step.' : 'Not started.'}</p>}
      {pn.note && <p className="flow-note">{pn.note}</p>}
      {pn.md && <Markdown text={pn.md} />}
      {pn.fields && pn.fields.map(([k, v]) => (
        <div key={k} className="kv">
          {pn.fields.length > 1 && <div className="k eyebrow">{k}</div>}
          <div className="v v--pre">{v}</div>
        </div>
      ))}
      {pn.files && <Files ws={ws} brand={brand} files={pn.files} />}
      {pn.storyboard && storyboard && <Storyboard ws={ws} brand={brand} sb={storyboard} />}
    </section>
  );
}

// Opens on the edit when there is one, else the storyboard, else the step in progress, else the last one done.
const defaultStep = (d) => d.steps.find((s) => s.panel?.editor)?.key
  || (d.storyboard && 'storyboard')
  || d.steps.find((s) => s.state === 'current')?.key
  || [...d.steps].reverse().find((s) => s.done)?.key
  || d.steps[0]?.key;

function Detail({ ws, brand, ad }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, `workflow?ad=${encodeURIComponent(ad)}`);
  const [sel, setSel] = useState(null);
  const steps = data?.steps || [];
  const step = steps.find((s) => s.key === sel) || (data && steps.find((s) => s.key === defaultStep(data)));

  return (
    <div>
      <div className="toolbar">
        <ToolbarStart ws={ws} brand={brand} current="workflow" count={data ? `Ad ${data.id}` : 'Loading'} updatedAt={updatedAt} />
        <div className="toolbar__spacer" />
        <button type="button" className="btn" title="Reload" onClick={load}>↻</button>
      </div>
      {error && <LoadError what="this ad" error={error} onRetry={load} />}
      {!error && data && (
        <div className="flow-page rise">
          <header className="flow-head">
            <Link className="flow-back" href={brandUrl(ws, brand, 'workflow')}>‹ All ads</Link>
            <h1>{words(data.concept)}</h1>
            <div className="flow-head__sub">
              {[data.format, data.persona, data.angle, data.product].filter(Boolean).map(words).join(' · ')}
              {data.status && <span className="badge" data-status={data.status.toLowerCase()}>{data.status}</span>}
            </div>
          </header>
          <nav className="flow-steps" aria-label="Steps">
            {steps.map((s) => (
              <button key={s.key} type="button" className="flow-step" data-state={s.state} aria-pressed={s === step} title={STATE[s.state]} onClick={() => setSel(s.key)}>
                <Dot state={s.state} />{s.label}{s.count && <small>{s.count}</small>}
              </button>
            ))}
          </nav>
          {step && <Panel ws={ws} brand={brand} step={step} data={data} />}
        </div>
      )}
    </div>
  );
}

function List({ ws, brand }) {
  const { data, error, load, updatedAt } = useBrandData(ws, brand, 'workflow');
  const ads = data?.ads || [];
  return (
    <div>
      <div className="toolbar">
        <ToolbarStart ws={ws} brand={brand} current="workflow" count={data ? `${ads.length} ads` : 'Loading'} updatedAt={updatedAt} />
        <div className="toolbar__spacer" />
        <button type="button" className="btn" title="Reload" onClick={load}>↻</button>
      </div>
      {error && <LoadError what="ads" error={error} onRetry={load} />}
      {!error && data && ads.length === 0 && <div className="empty-state">No ad folders in <code>outputs/</code> yet.</div>}
      {!error && ads.length > 0 && (
        <ul className="flow-list rise">
          {ads.map((a) => (
            <li key={a.folder}>
              <Link className="flow-row" href={workflowUrl(ws, brand, a.folder)}>
                <span className="cell-id">{a.id}</span>
                <span className="flow-row__concept">{words(a.concept)}</span>
                <span className="pill-mark">{words(a.format) || '—'}</span>
                <span className="flow-row__dots" aria-hidden="true">{a.states.map((st, i) => <Dot key={i} state={st} />)}</span>
                <span className="flow-row__step">{a.step ? <>{a.step.label}{a.step.count && <small>{a.step.count}</small>}</> : 'Done'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Workflow({ ws, brand, ad }) {
  return ad ? <Detail ws={ws} brand={brand} ad={ad} /> : <List ws={ws} brand={brand} />;
}
