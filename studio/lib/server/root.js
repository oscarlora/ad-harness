// Repo root: walk up from cwd to the dir holding tools/lib/catalog.mjs (workspaces/ may not exist yet).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

let cached = null;

export function repoRoot() {
  if (cached) return cached;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(join(dir, 'tools', 'lib', 'catalog.mjs'))) {
      cached = dir;
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`ad-harness-studio: repo root not found above ${process.cwd()} (looked for tools/lib/catalog.mjs)`);
    dir = up;
  }
}

export const workspacesDir = () => join(repoRoot(), 'workspaces');
