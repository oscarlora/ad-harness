// An ad's edit: its versions (edit.json, edit-v2.json, …), review notes (comments/<id>.json) and export state.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJson } from './brands.js';
import { repoRoot } from './root.js';

const PLAN = /^edit(-v\d+)?\.json$/i;
const NOTE_ID = /^n[a-z0-9]{6,16}$/;
const adDir = (brandDirAbs, folder) => join(brandDirAbs, 'outputs', folder);

// edit.json is V1, edit-v2.json V2.
const label = (file) => `V${/^edit-v(\d+)\.json$/i.exec(file)?.[1] || 1}`;

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

// null when the ad has no edit document.
export function editInfo(brandDirAbs, folder) {
  const dir = adDir(brandDirAbs, folder);
  let names = [];
  try { names = readdirSync(dir).filter((n) => PLAN.test(n)); } catch {}
  if (!names.length) return null;
  const mtime = (n) => { try { return Math.round(statSync(join(dir, n)).mtimeMs); } catch { return 0; } };
  // v moves when the document or the ad's fx.js changes, so the preview reloads for either.
  const plans = names.sort((a, b) => label(a).localeCompare(label(b), undefined, { numeric: true }))
    .map((n) => ({ file: n, label: label(n), p: `outputs/${folder}/${n}`, v: Math.max(mtime(n), mtime('fx.js')) }));
  const cdir = join(dir, 'comments');
  const notes = existsSync(cdir) ? readdirSync(cdir).filter((n) => n.endsWith('.json')).map((n) => readJson(join(cdir, n), null)).filter(Boolean).sort((a, b) => a.t - b.t) : [];
  let exp = readJson(join(dir, '.export.json'), null);
  if (exp?.state === 'running' && exp.pid && !alive(exp.pid)) exp = { ...exp, state: 'failed', error: 'The export stopped.' };
  return { plans, notes, export: exp };
}

// note: { id?, t, box?, text, plan }. Returns the saved note.
export function saveNote(brandDirAbs, folder, note) {
  const t = Number(note?.t), text = String(note?.text || '').trim();
  if (!Number.isFinite(t) || t < 0 || !text) throw new Error('a note needs a time and text');
  const box = Array.isArray(note.box) && note.box.length === 4 && note.box.every((x) => Number.isFinite(x) && x >= 0 && x <= 1) ? note.box.map((x) => +x.toFixed(4)) : null;
  const id = NOTE_ID.test(note.id || '') ? note.id : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const cdir = join(adDir(brandDirAbs, folder), 'comments');
  mkdirSync(cdir, { recursive: true });
  const prev = readJson(join(cdir, `${id}.json`), {});
  const out = { ...prev, id, t: +t.toFixed(3), box, text, plan: String(note.plan || prev.plan || 'edit.json'), status: 'open', at: prev.at || new Date().toISOString() };
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
