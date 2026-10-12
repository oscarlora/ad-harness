// Board data: ad records plus batch-plan slots not made yet, with persona details and renders.
// Returned paths are brand-relative (POSIX), for the /file route.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isSeparator, tableCells } from '../../components/workflow/Markdown.js';
import { readJson } from './brands.js';
import { repoRoot } from './root.js';

const readJsonDir = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(dir, f), null))
    .filter(Boolean);
};

const readAds = (outputs) => readJsonDir(join(outputs, 'json')).sort((x, y) => (x.id || 0) - (y.id || 0));
const readPlans = (outputs) => readJsonDir(join(outputs, 'batches'));

// ---- persona details (the `## Personas` table in inputs/*research.md) ----
// Table names ("The Morning Routine") vs record slugs ("MorningRoutine"): drop "The ", compare alphanumerics, digits as words.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const norm = (s) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
const wordy = (s) => s.replace(/\d/g, (d) => WORDS[+d]);

function parsePersonaTable(md) {
  const m = md.match(/^##\s+Personas\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  const rows = m[1].split('\n').filter((l) => l.trim().startsWith('|')).map(tableCells);
  if (rows.length < 3) return [];
  const heads = rows[0].map((h) => h.toLowerCase());
  const KEY = { name: 'name', age: 'age', gender: 'gender', 'awareness stage': 'awareness', 'physical pain': 'pain', 'emotional pain': 'feels', 'desired outcome': 'wants', objection: 'but' };
  return rows.slice(1).filter((vals) => !isSeparator(vals)).map((vals) => {
    const rec = {};
    heads.forEach((h, i) => { if (KEY[h]) rec[KEY[h]] = vals[i] || ''; });
    return rec.name ? rec : null;
  }).filter(Boolean);
}

function personas(brandDirAbs) {
  const out = [];
  const inputs = join(brandDirAbs, 'inputs');
  try {
    for (const f of readdirSync(inputs).filter((f) => /research\.md$/i.test(f))) {
      try { out.push(...parsePersonaTable(readFileSync(join(inputs, f), 'utf8'))); } catch {}
    }
  } catch {}
  return out;
}

function personaDetail(list, slug) {
  if (!slug) return null;
  const s = norm(slug);
  let best = null, bestScore = 0;
  for (const p of list) {
    const n = norm(p.name), nw = wordy(n), sw = wordy(s);
    let score = 0;
    if (s === n || sw === nw) score = 3;
    else if (nw.includes(sw) || sw.includes(nw)) score = 2;
    else { const nl = nw.replace(/[^a-z]/g, ''), sl = sw.replace(/[^a-z]/g, ''); if (nl && sl && (nl.includes(sl) || sl.includes(nl))) score = 1; }
    if (score > bestScore) { best = p; bestScore = score; }
  }
  return best;
}

const posix = (p) => p.split(sep).join('/');

// A record's render: the first existing generation.output(s) path (repo-relative or absolute), as { abs, mtime }.
function renderOf(rec) {
  for (const p of [rec?.generation?.output, ...(rec?.generation?.outputs || [])].filter(Boolean)) {
    const abs = resolve(repoRoot(), p);
    try { const st = statSync(abs); if (st.isFile()) return { abs, mtime: st.mtimeMs }; } catch {}
  }
  return null;
}

// Brand-relative form of a record path (for the file route); falls back to the raw string.
function brandRel(brandDirAbs, p) {
  if (!p) return '';
  const abs = isAbsolute(p) ? p : resolve(repoRoot(), p);
  const rel = relative(brandDirAbs, abs);
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return posix(rel);
  return posix(String(p));
}

function promptOf(rec) {
  const p = rec?.generation?.prompt;
  if (!p) return '';
  return typeof p === 'string' ? p : JSON.stringify(p, null, 2);
}

// Records tagged with their batch, plus a planned row for each plan slot with no record yet.
function adsWithPlan(outputs, plans) {
  const recs = readAds(outputs);
  const byId = new Map(recs.map((r) => [String(r.id), r]));
  const planned = [];
  for (const plan of plans) {
    for (const slot of plan.slots || []) {
      const existing = byId.get(String(slot.id));
      if (existing) { existing.batch = plan.name; if (slot.angleSource) existing.angleSource = slot.angleSource; continue; }
      planned.push({
        id: slot.id,
        status: 'in-progress',
        batch: plan.name,
        concept: { product: plan.subject || plan.defaults?.product || '', persona: slot.persona || '', angle: slot.angle || '', format: slot.format || '', imageType: slot.imageType || '' },
        angleSource: slot.angleSource || '',
        refs: slot.refs || [],
        copy: slot.copy || {},
        design: slot.design || '',
        generation: null,
      });
    }
  }
  return [...recs, ...planned].sort((x, y) => (x.id || 0) - (y.id || 0));
}

// Ad folders in outputs/ ("<id>_<Concept>_<Format>_…").
export function adFolders(outputs) {
  try { return readdirSync(outputs, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d+_/.test(d.name)).map((d) => d.name); } catch { return []; }
}

// Records may hold objects or arrays where strings are expected; flatten them for React.
export function displayText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(displayText).join(' · ');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${displayText(x)}`).join(' · ');
  return String(v);
}

export function boardData(brandDirAbs) {
  const outputs = join(brandDirAbs, 'outputs');
  const plans = readPlans(outputs);
  const personaList = personas(brandDirAbs);
  const folders = adFolders(outputs);
  const ads = adsWithPlan(outputs, plans).map((r) => {
    const ad = {
      ...r,
      folder: folders.find((f) => f.startsWith(`${r.id}_`)) || '', // links the ad to its Workflow page
      refs: (r.refs || r.generation?.refs || []).map((ref) => brandRel(brandDirAbs, ref)),
      prompt: promptOf(r),
      design: displayText(r.design),
      copy: Object.fromEntries(Object.entries(r.copy || {}).map(([k, v]) => [k, displayText(v)])),
    };
    const render = renderOf(r);
    if (render) {
      ad.img = posix(relative(brandDirAbs, render.abs));
      ad.imgVersion = render.mtime; // cache-buster
    }
    const pd = personaDetail(personaList, r.concept?.persona);
    if (pd) ad.personaDetail = pd;
    return ad;
  });
  return { ads, batches: plans.map((pl) => pl.name).filter(Boolean) };
}
