#!/usr/bin/env node
// check-public.mjs — the never-commit-client-data guard. The harness is public; client names stay
// in workspaces/ (never committed) and in R2. This scans files about to be committed for any local
// workspace or brand name and fails if it finds one.
//
// Terms come from this machine's own folders, so nothing private is written down here:
//   - every workspace folder under workspaces/, and every brand folder inside each
//     (skipping generic ones: Shared, Library, Personal, and anything starting with _ or . —
//     a workspace starting with _ is skipped whole)
//   - one extra term per line in any workspaces/<WS>/_harness/private-terms.txt (# comments ok),
//     for names that aren't folders (people, products, domains)
// Matching is whole-word and case-insensitive; "-", "_" and spaces inside a term match each other
// ("Acme-Labs" also catches "acme labs" and "ACME_LABS"). File paths are checked too.
// workspaces/ and node_modules/ are never scanned.
//
// Usage:
//   node tools/check-public.mjs          scan the staged files (what the pre-commit hook runs)
//   node tools/check-public.mjs --all    scan every tracked file
// Prints file:line and the term per hit; exits 1 on any hit, 0 when clean. The hook lives in
// .githooks/pre-commit (setup.sh / setup.ps1 point git at it). For a true false positive, reword
// it; `git commit --no-verify` skips the check.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, parseArgs } from './lib/catalog.mjs';

const GENERIC = new Set(['shared', 'library', 'personal']);
const WS_ROOT = join(REPO_ROOT, 'workspaces');

const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
const isPrivateName = (n) => !n.startsWith('_') && !n.startsWith('.') && !GENERIC.has(n.toLowerCase());

export function collectTerms(root = WS_ROOT) {
  const terms = new Set();
  for (const ws of dirs(root)) {
    if (ws.startsWith('_') || ws.startsWith('.')) continue; // scratch folders, not client workspaces
    if (isPrivateName(ws)) terms.add(ws);
    for (const brand of dirs(join(root, ws))) if (isPrivateName(brand)) terms.add(brand);
    const extra = join(root, ws, '_harness', 'private-terms.txt');
    if (existsSync(extra)) {
      for (const line of readFileSync(extra, 'utf8').split(/\r?\n/)) {
        const t = line.replace(/#.*/, '').trim();
        if (t) terms.add(t);
      }
    }
  }
  return [...terms];
}

// Whole word, case-insensitive; separators inside the term (- _ space) match any of the three.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const termRegex = (term) => new RegExp(
  `(?<![\\p{L}\\p{N}])${term.trim().split(/[\s_-]+/).map(esc).join('[\\s_-]+')}(?![\\p{L}\\p{N}])`, 'iu');

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'buffer', maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(`git ${args.join(' ')} failed: ${r.stderr}`); process.exit(2); }
  return r.stdout;
}
const skipped = (f) => f.startsWith('workspaces/') || f.split('/').includes('node_modules');

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const all = !!parseArgs(process.argv.slice(2)).all;
  const terms = collectTerms().map((t) => ({ t, re: termRegex(t) }));
  if (!terms.length) { console.log('check-public: no local workspaces — nothing to check against'); process.exit(0); }

  const files = git(all ? ['ls-files', '-z'] : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    .toString('utf8').split('\0').filter((f) => f && !skipped(f));
  // Staged runs read what is staged (the index), not the working copy.
  const read = (f) => (all ? (existsSync(join(REPO_ROOT, f)) && statSync(join(REPO_ROOT, f)).isFile() ? readFileSync(join(REPO_ROOT, f)) : null) : git(['show', `:${f}`]));

  const hits = [];
  for (const f of files) {
    for (const { t, re } of terms) if (re.test(f)) hits.push(`${f} (file name)  ${t}`);
    const buf = read(f);
    if (!buf || buf.subarray(0, 8000).includes(0)) continue; // binary
    buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      for (const { t, re } of terms) if (re.test(line)) hits.push(`${f}:${i + 1}  ${t}`);
    });
  }
  if (!hits.length) { console.log(`check-public: clean (${files.length} file${files.length === 1 ? '' : 's'}, ${terms.length} terms)`); process.exit(0); }
  console.error(`check-public: client names found in ${all ? 'tracked' : 'staged'} files — replace them (examples use "Acme"):`);
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}
