// Platform-aware "open in default app" / "reveal in file manager", for paths inside one brand only.
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { within } from './brands.js';

function launch(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

// The name of the app that opens this file ("QuickTime Player"), or '' when unknown. macOS only; cached per extension.
const APP_JXA = 'ObjC.import("AppKit"); function run(a) { const u = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(a[0])); return u.isNil() ? "" : $.NSFileManager.defaultManager.displayNameAtPath(u.path).js.replace(/\\.app$/, ""); }';
const apps = new Map();
export function defaultApp(abs) {
  if (process.platform !== 'darwin') return Promise.resolve('');
  const ext = extname(abs).toLowerCase();
  if (!apps.has(ext)) {
    apps.set(ext, new Promise((res) => execFile('osascript', ['-l', 'JavaScript', '-e', APP_JXA, abs], { timeout: 3000 }, (err, out) => res(err ? '' : String(out).trim()))));
  }
  return apps.get(ext);
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
