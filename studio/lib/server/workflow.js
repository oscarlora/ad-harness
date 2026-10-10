// Workflow data layer: where each ad (one folder in outputs/, named by the write-prompt filename
// convention) stands in its format's workflow, inferred from the files on disk plus its record
// (outputs/json/<id>.json) when there is one. Step lists follow the workflow skills; animation
// (make-ai-animation) also gets its storyboard.md parsed into shots matched to frames and clips.
// All paths returned to the client are brand-relative (POSIX), for the /file route.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSeparator, tableCells } from '../../components/workflow/Markdown.js';
import { adFolders, displayText } from './ads.js';
import { readJson } from './brands.js';

const IMG = /\.(png|jpe?g|webp|gif|avif)$/i;
const VID = /\.(mp4|mov|m4v|webm)$/i;
const AUD = /\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i;
const typeOf = (rel) => (IMG.test(rel) ? 'image' : VID.test(rel) ? 'video' : AUD.test(rel) ? 'audio'
  : /\.md$/i.test(rel) ? 'md' : /\.txt$/i.test(rel) ? 'txt' : /\.pdf$/i.test(rel) ? 'pdf' : 'other');

// An ad folder name as the client sends it: "<id>_…", one path segment.
const isAdFolder = (s) => typeof s === 'string' && /^\d+_[^/\\\0]+$/.test(s);

// `<id>_<Concept>_<Format>_<Persona>_<Angle>_<Product>`; older folders carry fewer parts.
function parseFolder(folder) {
  const [id, concept = '', format = '', persona = '', angle = '', ...rest] = folder.split('_');
  return { folder, id: Number(id), concept, format, persona, angle, product: rest.join('_') };
}

// Every file under the ad folder (dot-entries skipped), as { rel, p, v, type }.
function inventory(brandDirAbs, folder) {
  const base = join(brandDirAbs, 'outputs', folder);
  const out = [];
  const walk = (dir, rel, depth) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 3) walk(join(dir, e.name), r, depth + 1); continue; }
      let v = 0;
      try { v = Math.round(statSync(join(dir, e.name)).mtimeMs); } catch { continue; }
      out.push({ rel: r, p: `outputs/${folder}/${r}`, v, type: typeOf(r) });
    }
  };
  walk(base, '', 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
}

const readRecord = (brandDirAbs, id) => readJson(join(brandDirAbs, 'outputs', 'json', `${id}.json`), null);

const readText = (brandDirAbs, p) => { try { return readFileSync(join(brandDirAbs, p), 'utf8'); } catch { return ''; } };

// Strip a file entry to what the client renders; a same-stem .txt beside an image is its prompt.
function present(files, all) {
  const byRel = new Map(all.map((f) => [f.rel, f]));
  const prompts = new Set();
  const list = files.map((f) => {
    const txt = f.type === 'image' && byRel.get(f.rel.replace(IMG, '.txt'));
    if (txt) prompts.add(txt.rel);
    return { name: f.rel, p: f.p, v: f.v, type: f.type, ...(txt ? { prompt: { p: txt.p, v: txt.v } } : {}) };
  });
  return list.filter((f) => !prompts.has(f.name));
}

// ---- storyboard.md (make-ai-animation step 4) ----
// A header, an optional **Blocking** section, then one markdown table: # | Setting | On screen |
// What we see | Line(s) | s (and optional Start | End in seconds, What moves, What we hear, Camera, Transition), with bold scene-divider rows ("| **Scene 1 — The open** |||||").
const COLS = { '#': 'n', setting: 'setting', 'on screen': 'onScreen', 'what we see': 'see', 'line(s)': 'lines', lines: 'lines', line: 'lines', s: 'secs', sec: 'secs', seconds: 'secs', start: 'from', end: 'to', 'what moves': 'moves', 'what we hear': 'hear', transition: 'transition', camera: 'camera' };

// "ALEX: Stop. / SAM: I swear." → [{ who, text }]; "—" → [].
function splitLines(cell) {
  if (!cell || /^[—–-]$/.test(cell)) return [];
  return cell.split(/\s+\/\s+/).map((part) => {
    const m = /^([A-Z][A-Z0-9 .'’-]*(?:\s*\([^)]*\))?):\s*(.*)$/.exec(part);
    return m ? { who: m[1], text: m[2] } : { who: '', text: part };
  });
}

const blank = (v) => (!v || v === '—' || v === '-' ? '' : v); // "—" marks a deliberately empty cell
function parseStoryboard(md) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*\|/.test(l));
  const pre = (start < 0 ? lines : lines.slice(0, start)).filter((l, i) => !(i === 0 && /^#\s/.test(l))); // the title repeats the page head
  let end = start;
  while (end >= 0 && end < lines.length && /^\s*\|/.test(lines[end])) end++;
  const b = pre.findIndex((l) => /^\*\*Blocking\*\*/.test(l));
  const header = (b < 0 ? pre : pre.slice(0, b)).join('\n').trim();
  const blocking = [...(b < 0 ? [] : pre.slice(b)), ...(start < 0 ? [] : lines.slice(end))].join('\n').trim();

  const rows = [];
  if (start >= 0) {
    const keys = tableCells(lines[start]).map((h) => COLS[h.toLowerCase()] || null);
    let scene = '';
    for (const l of lines.slice(start + 1, end)) {
      const c = tableCells(l);
      if (isSeparator(c)) continue; // separator / empty row
      if (/^\*\*/.test(c[0]) && c.slice(1).every((x) => !x)) { scene = c[0].replace(/\*\*/g, '').trim(); continue; }
      const r = {};
      keys.forEach((k, i) => { if (k) r[k] = c[i] || ''; });
      const n = /^\d+$/.test(r.n || '') ? Number(r.n) : null;
      rows.push({ n, scene, setting: r.setting || '', onScreen: r.onScreen || '', see: r.see || '', lines: splitLines(r.lines), secs: r.secs || '', from: r.from || '', to: r.to || '', moves: blank(r.moves), hear: blank(r.hear), transition: blank(r.transition), camera: blank(r.camera) });
    }
  }
  return { header, blocking, rows };
}

// A generated file's sidecar (<stem>.gen.json, written by generate-image / generate-video): what
// was sent — model, provider, params, prompt — with each ref resolved to a servable brand file
// ({ p, v, type }) when it is one. null when there is none.
function readGen(brandDirAbs, byRel, f) {
  const side = byRel.get(f.rel.replace(/\.[^./]+$/, '.gen.json'));
  const g = side && readJson(join(brandDirAbs, side.p), null);
  if (!g) return null;
  const refs = (Array.isArray(g.refs) ? g.refs : []).map(({ role = 'ref', path = '' }) => {
    const p = String(path), name = p.split('?')[0].split('/').pop();
    if (/^https?:\/\//i.test(p)) return { role, name, url: p, type: typeOf(name) };
    try { return { role, name, p, v: Math.round(statSync(join(brandDirAbs, p)).mtimeMs), type: typeOf(p) }; } catch { return { role, name }; }
  });
  return { model: g.model, provider: g.provider, at: g.at, params: g.params || {}, refs, prompt: g.prompt || '' };
}

// Shots matched to frames/frame-NN.* (else its 4:5 draft frame-NN-4x5.*, made before the 9:16 extension;
// make-ai-slides) and clips/clip-NN[-<model>].* or chunk-NN[-<model>].* (several model takes per shot),
// each with its sidecar (`gen`). A clip whose sidecar sent frames/frame-NN.* as refs covers each of
// those shots (one clip per chunk of shots); without one, it belongs to shot NN.
const FRAME = /^frames\/frame-0*(\d+)\.(png|jpe?g|webp)$/i;
const FRAME_4X5 = /^frames\/frame-0*(\d+)-4x5\.(png|jpe?g|webp)$/i;
function shotsWithMedia(brandDirAbs, folder, sb, files) {
  const byRel = new Map(files.map((f) => [f.rel, f]));
  const own = `outputs/${folder}/`;
  const frames = new Map(), drafts = new Map(), clips = new Map();
  for (const f of files) {
    let m;
    if ((m = FRAME.exec(f.rel)) || (m = FRAME_4X5.exec(f.rel))) {
      (FRAME.test(f.rel) ? frames : drafts).set(+m[1], { p: f.p, v: f.v, gen: readGen(brandDirAbs, byRel, f) });
    } else if ((m = /^clips\/(?:clip|chunk)-0*(\d+)(?:-(.+))?\.(mp4|mov|m4v|webm)$/i.exec(f.rel))) {
      const gen = readGen(brandDirAbs, byRel, f);
      const sent = (gen?.refs || []).map((r) => r.p?.startsWith(own) && FRAME.exec(r.p.slice(own.length))).filter(Boolean);
      const shots = sent.length ? [...new Set(sent.map((x) => +x[1]))] : [+m[1]];
      for (const n of shots) clips.set(n, [...(clips.get(n) || []), { model: m[2] || 'orig', p: f.p, v: f.v, gen, shots }]);
    }
  }
  return sb.rows.map((r) => {
    if (r.n == null) return r;
    // A 9:16 frame extended from its 4:5 draft shows the draft's generation: the art's prompt and refs.
    const final = frames.get(r.n), draft = drafts.get(r.n);
    const frame = final ? { ...final, gen: draft?.gen || final.gen } : draft || {};
    return {
      ...r,
      frame: frame.p ? frame : null,
      clips: (clips.get(r.n) || []).sort((a, b) => b.v - a.v), // newest first
    };
  });
}

// ---- steps per format ----
// A step: { key, label, done, count?, panel } where panel holds any of
// { note, md (inline text), fields: [[label, text]], files: [...], storyboard: true }.
const ROOT_VIDEO = (f) => !f.rel.includes('/') && f.type === 'video' && !/^reference/i.test(f.rel);
const ROOT_EXPORT = (f) => ROOT_VIDEO(f) || (!f.rel.includes('/') && f.type === 'audio');
const ROOT_MD = (f) => !f.rel.includes('/') && f.type === 'md' && !/^analysis\.md$/i.test(f.rel);
const under = (dir, ...types) => (f) => f.rel.startsWith(`${dir}/`) && (!types.length || types.includes(f.type));
const any = (...preds) => (f) => preds.some((p) => p(f));
const count = (files) => { const n = files.filter((f) => ['image', 'video', 'audio'].includes(f.type)).length; return n > 1 ? String(n) : ''; };

// Generic families: each step lists the files that evidence it (and optionally record fields).
// An optional step is shown only when something for it exists.
const FAMILIES = {
  image: [ // make-image-ad
    { key: 'copy', label: 'Copy', fields: (rec) => Object.entries(rec?.copy || {}).map(([k, v]) => [k, displayText(v)]) },
    { key: 'design', label: 'Design', fields: (rec) => (rec?.design ? [['design', displayText(rec.design)]] : []) },
    { key: 'drafts', label: 'Drafts', files: any(under('drafts', 'image'), (f) => !f.rel.includes('/') && f.type === 'image') },
    { key: 'final', label: 'Final', files: under('final', 'image'), done: (rec) => ['approved', 'synced'].includes(rec?.status) },
  ],
  song: [ // make-ai-song
    { key: 'concept', label: 'Concept', files: ROOT_MD },
    { key: 'lyrics', label: 'Lyrics', files: (f) => /^music\/[^/]*lyrics[^/]*\.txt$/i.test(f.rel), fields: (rec) => (rec?.copy?.lyrics ? [['lyrics', displayText(rec.copy.lyrics)]] : []) },
    { key: 'song', label: 'Song', files: under('music', 'audio') },
    { key: 'look', label: 'Look', files: under('sheets', 'image') },
    { key: 'storyboard', label: 'Storyboard', files: any(under('storyboards', 'image'), (f) => f.rel === 'storyboard.md') },
    { key: 'clips', label: 'Clips', files: under('clips', 'video') },
    { key: 'edit', label: 'Edit', files: ROOT_VIDEO },
  ],
  voice: [ // voiceover / audio-story ads (generate-voiceover)
    { key: 'script', label: 'Script', files: any(ROOT_MD, under('voice', 'txt')) },
    { key: 'voice', label: 'Voice', files: under('voice', 'audio') },
    { key: 'broll', label: 'B-roll', optional: true, files: under('broll', 'image', 'video') },
    { key: 'export', label: 'Export', files: ROOT_EXPORT },
  ],
  creator: [ // creator-filmed (UGC) and editor-built formats: a brief, then the delivered video
    { key: 'brief', label: 'Brief', files: any(ROOT_MD, (f) => !f.rel.includes('/') && /^reference/i.test(f.rel) && f.type !== 'other', (f) => /^analysis\.md$/i.test(f.rel), under('slides', 'image')) },
    { key: 'video', label: 'Video', files: ROOT_VIDEO },
  ],
  video: [ // other generated video (podcast, explainer)
    { key: 'script', label: 'Script', files: any(ROOT_MD, (f) => f.rel === 'script.md', under('voice', 'txt')) },
    { key: 'voice', label: 'Voice', optional: true, files: under('voice', 'audio') },
    { key: 'look', label: 'Look', optional: true, files: (f) => f.type === 'image' && f.rel.includes('/') && !/^(drafts|final|clips|reference)\//.test(f.rel) },
    { key: 'clips', label: 'Clips', files: under('clips', 'video') },
    { key: 'music', label: 'Music', optional: true, files: under('music', 'audio') },
    { key: 'edit', label: 'Edit', files: ROOT_VIDEO },
  ],
};

function familyOf(format) {
  const f = format.toLowerCase();
  if (f === 'animation' || f === 'slides') return 'animation'; // make-ai-slides shares the storyboard view
  if (/song/.test(f)) return 'song';
  if (/static|image|screenshot|carousel/.test(f)) return 'image';
  if (/voiceover|audio/.test(f)) return 'voice';
  if (/ugc|creator|text|handwritten/.test(f)) return 'creator';
  return 'video';
}

function genericSteps(family, files, rec) {
  const steps = [];
  for (const def of FAMILIES[family]) {
    const own = def.files ? files.filter(def.files) : [];
    const fields = own.length ? [] : (def.fields?.(rec) || []).filter(([, v]) => v);
    if (def.optional && !own.length) continue;
    steps.push({
      key: def.key,
      label: def.label,
      done: !!(own.length || fields.length || def.done?.(rec)),
      count: count(own),
      panel: { ...(fields.length ? { fields } : {}), ...(own.length ? { files: present(own, files) } : {}) },
    });
  }
  return steps;
}

// make-ai-animation: Concept · Script · Voices · Storyboard · Sheets · Frames · Clips · Edit.
function animationSteps(brandDirAbs, folder, files) {
  const sbFile = files.find((f) => f.rel === 'storyboard.md');
  const sb = sbFile ? parseStoryboard(readText(brandDirAbs, sbFile.p)) : { header: '', blocking: '', rows: [] };
  const rows = shotsWithMedia(brandDirAbs, folder, sb, files);
  const shots = rows.filter((r) => r.n != null);
  const framed = shots.filter((s) => s.frame).length;
  const clipped = shots.filter((s) => s.clips.length).length;
  const script = files.find((f) => f.rel === 'script.md');
  const sheets = files.filter(under('sheets', 'image', 'txt'));
  const voices = files.filter(any((f) => f.rel === 'voices.md', under('audio', 'audio'), under('voice', 'audio')));
  const edit = files.filter(ROOT_VIDEO);
  const progress = (n) => (shots.length ? `${n}/${shots.length}` : '');
  const steps = [
    { key: 'concept', label: 'Concept', done: !!(sb.header || script), panel: sb.header ? { md: sb.header } : {} },
    { key: 'script', label: 'Script', done: !!(script || shots.some((s) => s.lines.length)),
      panel: script ? { files: present([script], files) } : shots.length ? { note: 'The lines are on the storyboard cards.' } : {} },
    { key: 'voices', label: 'Voices', done: voices.length > 0, panel: voices.length ? { files: present(voices, files) } : {} },
    { key: 'storyboard', label: 'Storyboard', done: shots.length > 0, count: shots.length ? `${shots.length} shot${shots.length === 1 ? '' : 's'}` : '', panel: shots.length ? { storyboard: true } : {} },
    { key: 'sheets', label: 'Sheets', done: sheets.some((f) => f.type === 'image'), count: count(sheets), panel: sheets.length ? { files: present(sheets, files) } : {} },
    { key: 'frames', label: 'Frames', done: shots.length > 0 && framed === shots.length, count: progress(framed), panel: shots.length ? { storyboard: true } : {} },
    { key: 'clips', label: 'Clips', done: shots.length > 0 && clipped === shots.length, count: progress(clipped), panel: shots.length ? { storyboard: true } : {} },
    { key: 'edit', label: 'Edit', done: edit.length > 0, panel: edit.length ? { files: present(edit, files) } : {} },
  ];
  return { steps, storyboard: shots.length ? { blocking: sb.blocking, rows } : null };
}

// Done / current / todo: the step after the furthest done step is current; gaps stay todo.
function withStates(steps) {
  let last = -1;
  steps.forEach((s, i) => { if (s.done) last = i; });
  return steps.map((s, i) => ({ ...s, state: s.done ? 'done' : i === last + 1 ? 'current' : 'todo' }));
}

function adWorkflow(brandDirAbs, folder) {
  const head = parseFolder(folder);
  const files = inventory(brandDirAbs, folder);
  const rec = readRecord(brandDirAbs, head.id);
  const family = familyOf(head.format);
  const { steps, storyboard = null } = family === 'animation'
    ? animationSteps(brandDirAbs, folder, files)
    : { steps: genericSteps(family, files, rec) };
  return { ...head, status: rec?.status || '', steps: withStates(steps), storyboard };
}

// The ad list: newest (highest id) first, each with its current step.
export function workflowList(brandDirAbs) {
  const ads = adFolders(join(brandDirAbs, 'outputs')).map((folder) => {
    const { steps, storyboard, ...head } = adWorkflow(brandDirAbs, folder);
    const cur = steps.find((s) => s.state === 'current');
    return { ...head, step: cur ? { label: cur.label, count: cur.count } : null, states: steps.map((s) => s.state) };
  });
  return { ads: ads.sort((a, b) => b.id - a.id || a.folder.localeCompare(b.folder)) };
}

export function workflowDetail(brandDirAbs, folder) {
  if (!isAdFolder(folder) || !existsSync(join(brandDirAbs, 'outputs', folder))) return null;
  return adWorkflow(brandDirAbs, folder);
}
