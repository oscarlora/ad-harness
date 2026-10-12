// Media data: reads the catalog via tools/lib/catalog.mjs and saves edits via tools/record-media.mjs.
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './brands.js';
import { catalogLib } from './tools.js';
import { repoRoot } from './root.js';

const mediaDirOf = (brandDirAbs) => join(brandDirAbs, 'inputs', 'media');

// Catalog ids are zero-padded numbers ("00042"); anything else is refused so an id can't walk out (`../`).
export const isMediaId = (id) => typeof id === 'string' && /^\d{5,}$/.test(id);

async function mediaPaths(brandDirAbs) {
  const { catalogPaths } = await catalogLib();
  return catalogPaths(mediaDirOf(brandDirAbs));
}

export async function mediaRecords(brandDirAbs) {
  const { readRecords } = await catalogLib();
  const paths = await mediaPaths(brandDirAbs);
  return readRecords(paths).sort((x, y) => String(x.id).localeCompare(String(y.id)));
}

export async function mediaRecord(brandDirAbs, id) {
  if (!isMediaId(id)) return null;
  const paths = await mediaPaths(brandDirAbs);
  const p = join(paths.json, `${id}.json`);
  return readJson(p, null);
}

// Adds new names to the known-people ledger (_catalog/people.json).
export async function addPeople(brandDirAbs, entries) {
  const paths = await mediaPaths(brandDirAbs);
  const people = readJson(paths.people, []);
  const have = new Set(people.map((p) => String(p.name || '').toLowerCase()));
  let changed = false;
  for (const e of entries || []) {
    const name = String(e?.name || '').trim();
    if (!name || have.has(name.toLowerCase())) continue;
    people.push({ name, description: String(e.description || ''), hints: [] });
    have.add(name.toLowerCase());
    changed = true;
  }
  if (changed) writeFileSync(paths.people, JSON.stringify(people, null, 2) + '\n');
  return people;
}

// Merge via the tool (its --merge takes a file), never a reimplementation.
export async function mergeMediaRecord(brandDirAbs, id, patch) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-patch-'));
  const patchFile = join(dir, 'patch.json');
  try {
    await writeFile(patchFile, JSON.stringify({ id, ...patch }, null, 2));
    const { runAsync } = await catalogLib();
    const tool = join(repoRoot(), 'tools', 'record-media.mjs');
    const media = mediaDirOf(brandDirAbs);
    await runAsync(process.execPath, [tool, '--media', media, '--merge', patchFile], { cwd: repoRoot() });
    if (existsSync(media)) await runAsync(process.execPath, [tool, '--index', media], { cwd: repoRoot() }).catch(() => {});
    return mediaRecord(brandDirAbs, id);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
