#!/usr/bin/env node
// check-public.mjs — fail a commit whose files or message contain any local workspace or brand name (the repo is public).
// Terms come from this machine's folders, so nothing private is written here: every workspace and
// brand folder name (except Shared, Library, Personal and _/. names), plus one term per line in
// workspaces/<WS>/_custom/private-terms.txt (# comments ok). Whole-word, case-insensitive; - _ and
// space inside a term match each other. File paths are checked too.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT, parseArgs } from './lib/catalog.mjs';

const HELP = `check-public.mjs — fail on local workspace or brand names in the repo (it is public)

  node tools/check-public.mjs                  scan the staged files (the pre-commit hook)
  node tools/check-public.mjs --all            scan every tracked file
  node tools/check-public.mjs --message <file> scan a commit message (the commit-msg hook)
Exits 1 on any hit. For a false positive, reword it; \`git commit --no-verify\` skips the check.`;

const GENERIC = new Set(['shared', 'library', 'personal']);
const WS_ROOT = join(REPO_ROOT, 'workspaces');

const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : []);
const isPrivateName = (n) => !n.startsWith('_') && !n.startsWith('.') && !GENERIC.has(n.toLowerCase());

function collectTerms(root = WS_ROOT) {
  const terms = new Set();
  for (const ws of dirs(root)) {
    if (ws.startsWith('_') || ws.startsWith('.')) continue;
    if (isPrivateName(ws)) terms.add(ws);
    for (const brand of dirs(join(root, ws))) if (isPrivateName(brand)) terms.add(brand);
    const extra = join(root, ws, '_custom', 'private-terms.txt');
    if (existsSync(extra)) {
      for (const line of readFileSync(extra, 'utf8').split(/\r?\n/)) {
        const t = line.replace(/#.*/, '').trim();
        if (t) terms.add(t);
      }
    }
  }
  return [...terms];
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRegex = (term) => new RegExp(
  `(?<![\\p{L}\\p{N}])${term.trim().split(/[\s_-]+/).map(esc).join('[\\s_-]+')}(?![\\p{L}\\p{N}])`, 'iu');

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'buffer', maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(`git ${args.join(' ')} failed: ${r.stderr}`); process.exit(2); }
  return r.stdout;
}
const skipped = (f) => f.startsWith('workspaces/') || f.split('/').includes('node_modules');

const args = parseArgs(process.argv.slice(2), { flags: ['all'], help: HELP });
const all = !!args.all;
const terms = collectTerms().map((t) => ({ t, re: termRegex(t) }));
if (!terms.length) { console.log('check-public: no local workspaces — nothing to check against'); process.exit(0); }

if (args.message) {
  const found = terms.filter(({ re }) => re.test(readFileSync(args.message, 'utf8'))).map(({ t }) => t);
  if (!found.length) process.exit(0);
  console.error(`check-public: the commit message names ${found.join(', ')} — reword it (examples use "Acme").`);
  process.exit(1);
}

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
