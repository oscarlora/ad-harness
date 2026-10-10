// Runtime bridge to the harness's shared libs (tools/lib/*.mjs), which live outside this app.
// They are imported dynamically via a file:// URL built at runtime, so neither webpack nor
// turbopack ever tries to trace or bundle them — the running Node process resolves them.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './root.js';

const cache = new Map();

function load(rel) {
  if (!cache.has(rel)) {
    const href = pathToFileURL(join(repoRoot(), rel)).href;
    // Fully dynamic specifier (a variable) + ignore hints: stays a plain runtime import().
    cache.set(rel, import(/* webpackIgnore: true */ /* turbopackIgnore: true */ href));
  }
  return cache.get(rel);
}

export const catalogLib = () => load(join('tools', 'lib', 'catalog.mjs'));
const r2Lib = () => load(join('tools', 'lib', 'r2.mjs'));

// R2 client for a workspace (or null when the .env carries no creds for it).
export async function r2For(workspace) {
  const [{ loadEnv }, { r2FromEnv }] = await Promise.all([catalogLib(), r2Lib()]);
  return r2FromEnv(loadEnv(repoRoot()), workspace);
}
