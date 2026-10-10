// Media data layer — reads the brand's catalog (inputs/media/_catalog) through the harness's
// own helpers, and persists record edits through the existing tool (tools/record-media.mjs)
// so merge semantics stay single-source.
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './brands.js';
import { catalogLib } from './harness.js';
import { repoRoot } from './root.js';

const mediaDirOf = (brandDirAbs) => join(brandDirAbs, 'inputs', 'media');

// Catalog ids are zero-padded sequence numbers (tools/lib/catalog.mjs padId: "00042"). Anything
// else from a client is refused, so an id can never walk out of the catalog (`../`).
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

// Known people ledger (…/_catalog/people.json). Read tolerantly; write pretty.
const readPeopleAt = (file) => readJson(file, []);

export async function readPeople(brandDirAbs) {
  return readPeopleAt((await mediaPaths(brandDirAbs)).people);
}

export async function addPeople(brandDirAbs, entries) {
  const paths = await mediaPaths(brandDirAbs);
  const people = readPeopleAt(paths.people);
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

// Merge a patch into a media record by spawning the existing tool — never reimplement its merge.
// The patch is written to a temp file first (the tool's --merge entry point takes a file).
export async function mergeMediaRecord(brandDirAbs, id, patch) {
  const dir = await mkdtemp(join(tmpdir(), 'studio-patch-'));
  const patchFile = join(dir, 'patch.json');
  try {
    await writeFile(patchFile, JSON.stringify({ id, ...patch }, null, 2));
    const { runAsync } = await catalogLib();
    const tool = join(repoRoot(), 'tools', 'record-media.mjs');
    const media = mediaDirOf(brandDirAbs);
    await runAsync(process.execPath, [tool, '--media', media, '--merge', patchFile], { cwd: repoRoot() });
    // Keep the human-readable index in step with the records.
    if (existsSync(media)) await runAsync(process.execPath, [tool, '--index', media], { cwd: repoRoot() }).catch(() => {});
    return mediaRecord(brandDirAbs, id);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
