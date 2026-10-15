// An ad's edit: its versions (edit.json, edit-v2.json, …), review notes (comments/<id>.json) and export state.
// A note on a .md (file, quote: the text it's about) shares comments/ with the video's notes (t, box).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORIGIN, compose, endOf, mapTimes, r3 } from '../../engine/doc.js';
import { readJson } from './brands.js';
import { repoRoot } from './root.js';
import { catalogLib } from './tools.js';

const PLAN = /^edit(-v\d+)?\.json$/i;
const NOTE_ID = /^n[a-z0-9]{6,16}$/;
const adDir = (brandDirAbs, folder) => join(brandDirAbs, 'outputs', folder);

// edit.json is V1, edit-v2.json V2.
const label = (file) => `V${/^edit-v(\d+)\.json$/i.exec(file)?.[1] || 1}`;

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function readNotes(dir) {
  const cdir = join(dir, 'comments');
  return existsSync(cdir) ? readdirSync(cdir).filter((n) => n.endsWith('.json')).map((n) => readJson(join(cdir, n), null)).filter(Boolean) : [];
}
// The notes on the ad's .md files, oldest first.
export const docNotes = (brandDirAbs, folder) => readNotes(adDir(brandDirAbs, folder)).filter((n) => n.file).sort((a, b) => a.at.localeCompare(b.at));

// null when the ad has no edit document.
export function editInfo(brandDirAbs, folder) {
  const dir = adDir(brandDirAbs, folder);
  let names = [];
  try { names = readdirSync(dir).filter((n) => PLAN.test(n)); } catch {}
  if (!names.length) return null;
  const mtime = (n) => { try { return Math.round(statSync(join(dir, n)).mtimeMs); } catch { return 0; } };
  // v moves when the document, its base, its fx module or a media file it uses changes, so the preview reloads for
  // any of them; media maps each src to its file's mtime, which the preview's URLs carry (a replaced file refetches).
  const plans = names.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true })).map((n) => {
    const d = readJson(join(dir, n), {});
    const docs = [d, d?.base ? readJson(join(dir, d.base), {}) : null];
    const media = Object.fromEntries([...new Set(docs.flatMap((x) => x?.tracks || []).flatMap((t) => t.clips || []).map((c) => c.src).filter(Boolean))].map((src) => [src, mtime(src)]));
    return { file: n, label: label(n), p: `outputs/${folder}/${n}`, media, v: Math.max(mtime(n), mtime(d?.fx || 'fx.js'), d?.base ? mtime(d.base) : 0, ...Object.values(media)) };
  });
  const notes = readNotes(dir).filter((n) => !n.file).sort((a, b) => a.t - b.t);
  let exp = readJson(join(dir, '.export.json'), null);
  if (exp?.state === 'running' && exp.pid && !alive(exp.pid)) exp = { ...exp, state: 'failed', error: 'The export stopped.' };
  return { plans, notes, export: exp };
}

// note: { id?, t, box?, text, plan } on the video, or { id?, file, quote, text } on a .md (file relative to the ad folder).
// Returns the saved note.
export function saveNote(brandDirAbs, folder, note) {
  const t = Number(note?.t), text = String(note?.text || '').trim(), file = note?.file && String(note.file);
  if (file ? !/^[^/\\\0]+\.md$/i.test(file) || !existsSync(join(adDir(brandDirAbs, folder), file)) : !Number.isFinite(t) || t < 0) throw new Error('a note needs a time or a .md file');
  if (!text) throw new Error('a note needs text');
  const id = NOTE_ID.test(note.id || '') ? note.id : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cdir = join(adDir(brandDirAbs, folder), 'comments');
  mkdirSync(cdir, { recursive: true });
  const prev = readJson(join(cdir, `${id}.json`), {});
  const at = prev.at || new Date().toISOString();
  const box = Array.isArray(note.box) && note.box.length === 4 && note.box.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? note.box.map((x) => +x.toFixed(4)) : null;
  const out = file
    ? { ...prev, id, file, quote: String(note.quote || prev.quote || '').slice(0, 1000), text, status: 'open', at }
    : { ...prev, id, t: +t.toFixed(3), box, text, plan: String(note.plan || prev.plan || 'edit.json'), status: 'open', at };
  delete out.reply;
  writeFileSync(join(cdir, `${id}.json`), JSON.stringify(out, null, 1) + '\n');
  return out;
}

// The user approves a done note: it leaves the list and stays in the history.
export function approveNote(brandDirAbs, folder, id) {
  if (!NOTE_ID.test(id || '')) throw new Error('bad note id');
  const f = join(adDir(brandDirAbs, folder), 'comments', `${id}.json`), note = readJson(f, null);
  if (!note) throw new Error('no such note');
  writeFileSync(f, JSON.stringify({ ...note, status: 'approved' }, null, 1) + '\n');
}

export function removeNote(brandDirAbs, folder, id) {
  if (!NOTE_ID.test(id || '')) throw new Error('bad note id');
  rmSync(join(adDir(brandDirAbs, folder), 'comments', `${id}.json`), { force: true });
}

// The user trims a media clip in Studio: { plan, id: '<track>.<clip>' (raw indices), in, dur } sets the part of its
// source it plays. Its start stays put; when its end moves, everything after it slides along if the clip sits in a
// sequence (the next clip on its track starts where it ended), and a clip of the same name starting at the same
// time on another track (its voice) gets the same trim. In a hook version, a body clip is trimmed in its base.
export async function trimClip(brandDirAbs, folder, { plan, id, in: inS, dur }) {
  if (!PLAN.test(plan || '')) throw new Error('bad edit document');
  const dir = adDir(brandDirAbs, folder);
  let f = join(dir, plan), doc = readJson(f, null), [ti, ci] = String(id || '').split('.').map(Number);
  if (doc?.base) {
    const o = compose(doc, readJson(join(dir, doc.base), {})).tracks[ti]?.clips[ci]?.[ORIGIN];
    if (!o) throw new Error('no such clip');
    if (!o[0]) { f = join(dir, doc.base); doc = readJson(f, null); }
    [, ti, ci] = o;
  }
  const c = doc?.tracks?.[ti]?.clips?.[ci];
  if (!c?.src) throw new Error('only a media clip can be trimmed');
  if (!(Number.isFinite(inS) && inS >= 0 && Number.isFinite(dur) && dur > 0.05)) throw new Error('bad trim');
  const at = c.at ?? 0;
  const oldEnd = endOf(c), newEnd = r3(at + dur), delta = r3(newEnd - oldEnd);
  const set = (x) => { x.in = r3(inS); x.end = newEnd; delete x.dur; };
  const linked = doc.tracks.flatMap((tr, i) => (i === ti ? [] : tr.clips.filter((x) => x.src && x.name === c.name && Math.abs((x.at ?? 0) - at) < 1e-3)));
  const inSequence = doc.tracks[ti].clips.some((x) => x !== c && Math.abs((x.at ?? 0) - oldEnd) < 0.01);
  set(c); linked.forEach(set);
  // Like a cut when it shrinks.
  if (inSequence && delta) mapTimes(doc, (t) => (t >= oldEnd - 1e-3 ? r3(t + delta) : delta < 0 && t > newEnd ? newEnd : t), new Set([c, ...linked]));
  writeFileSync(f, JSON.stringify(doc, null, 1) + '\n');
  (await catalogLib()).markEditing(dir, null);
  return { delta, rippled: inSequence && !!delta, linked: linked.length };
}

// Run tools/edit-video.mjs export in the background; its progress lands in .export.json.
export function startExport(brandDirAbs, folder, plan) {
  if (!PLAN.test(plan || '')) throw new Error('bad edit document');
  const dir = adDir(brandDirAbs, folder);
  const cur = readJson(join(dir, '.export.json'), null);
  if (cur?.state === 'running' && cur.pid && alive(cur.pid)) throw new Error('An export is already running.');
  const child = spawn(process.execPath, [join(repoRoot(), 'tools', 'edit-video.mjs'), 'export', join(dir, plan)], { cwd: repoRoot(), detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  writeFileSync(join(dir, '.export.json'), JSON.stringify({ plan, state: 'running', progress: 0, pid: child.pid, at: Date.now() }));
}
