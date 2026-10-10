// Workspace/brand enumeration and validation, the brand page wrapper, and small fs helpers.
// A "brand" is any directory at <root>/workspaces/<Workspace>/<Brand> that has an inputs/ or
// outputs/ child. Folders starting with "." or "_" (e.g. workspaces/_swipe, <WS>/_harness) are
// private, never brands.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { notFound } from 'next/navigation';
import { workspacesDir } from './root.js';

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const listDirs = (p) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !/^[._]/.test(d.name)).map((d) => d.name); } catch { return []; } };

// A JSON file, or the fallback when it is missing or unreadable.
export function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
}

// True when abs sits inside base (both already absolute); guards ?p= traversal.
export const within = (base, abs) => abs === base || abs.startsWith(base + sep);

export function listBrands() {
  const out = [];
  for (const workspace of listDirs(workspacesDir())) {
    for (const brand of listDirs(join(workspacesDir(), workspace))) {
      const dir = join(workspacesDir(), workspace, brand);
      if (isDir(join(dir, 'inputs')) || isDir(join(dir, 'outputs'))) out.push({ workspace, brand });
    }
  }
  return out.sort((a, b) => a.workspace.localeCompare(b.workspace) || a.brand.localeCompare(b.brand));
}

// Route params arrive percent-encoded; decode defensively (idempotent for plain names).
function decodeSegment(s) {
  try { return decodeURIComponent(String(s || '')); } catch { return String(s || ''); }
}

const badSegment = (s) => !s || /^[._]/.test(s) || s.includes('/') || s.includes('\\') || s.includes('\0');

// Validated absolute brand dir, or null (unknown/unsafe → the route 404s).
function brandDir(ws, brand) {
  if (badSegment(ws) || badSegment(brand)) return null;
  const dir = resolve(join(workspacesDir(), ws, brand));
  if (!within(workspacesDir(), dir)) return null;
  return isDir(dir) ? dir : null;
}

// Resolve [ws]/[brand] route params → { ws, brand, dir }, or null when the brand doesn't exist.
export async function brandCtx(params) {
  const raw = await params;
  const ws = decodeSegment(raw.ws);
  const brand = decodeSegment(raw.brand);
  const dir = brandDir(ws, brand);
  return dir ? { ws, brand, dir } : null;
}

// A /[ws]/[brand]/<tab> page: 404 on an unknown brand, else <Component ws brand {...extra} />.
// `extra(params)` adds props (the workflow ad). Each page file keeps its own `dynamic` literal.
export const brandPage = (Component, extra) => async function BrandTabPage({ params }) {
  const ctx = await brandCtx(params);
  if (!ctx) notFound();
  return <Component ws={ctx.ws} brand={ctx.brand} {...(extra ? await extra(params) : {})} />;
};

// Its title, "<Brand> · <label> · Ad Harness"; label may be a function of the params.
export const brandMetadata = (label) => async ({ params }) => {
  const ctx = await brandCtx(params);
  const text = typeof label === 'function' ? await label(params) : label;
  return { title: `${ctx?.brand || 'Unknown brand'} · ${text} · Ad Harness` };
};
