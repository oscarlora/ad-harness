// Repo root discovery. The app lives at <root>/studio; `next dev`/`start` run with
// cwd = studio (npm sets cwd to the package dir), so the root is one level up — but we
// walk upward and fingerprint the harness (tools/lib/catalog.mjs) so it also works when the
// process is started from the repo root or anywhere inside it. workspaces/ may not exist yet
// on a fresh clone (brand trees are pulled from R2), so it is not part of the fingerprint.
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
