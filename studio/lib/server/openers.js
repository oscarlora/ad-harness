// Platform-aware "open in default app" / "reveal in file manager", for paths inside one brand only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { within } from './brands.js';

function launch(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

// rel: brand-relative path. mode: 'open' | 'reveal'. Returns { ok } or { error, status }.
export function openPath(brandDirAbs, rel, mode) {
  const p = String(rel || '');
  if (!p || p.includes('\0')) return { error: 'path required', status: 400 };
  const abs = resolve(brandDirAbs, p);
  if (!within(brandDirAbs, abs)) return { error: 'forbidden', status: 403 };
  if (!existsSync(abs)) return { error: 'not found', status: 404 };
  if (process.platform === 'darwin') {
    launch('open', mode === 'reveal' ? ['-R', abs] : [abs]);
  } else if (process.platform === 'win32') {
    launch('explorer', mode === 'reveal' ? [`/select,${abs}`] : [abs]);
  } else {
    launch('xdg-open', [mode === 'reveal' ? dirname(abs) : abs]);
  }
  return { ok: true };
}
