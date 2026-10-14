#!/usr/bin/env node
// edit-video.mjs — an ad's edit.json: check it, export it, grab stills, and build its captions, color match,
// ducking and review comments. Export and stills run Studio's own engine (studio/engine) in a headless browser,
// so they match Studio's preview frame for frame.

import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, writeFileSync, writeSync, closeSync, watch } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { brandDirFrom, die, ffprobeJson, mimeOf, parseArgs, round, run, usage } from './lib/catalog.mjs';

const HELP = `edit-video.mjs — an ad's edit document (outputs/<ad>/edit.json)

  check    <edit.json>                            summary + problems (missing files, black gaps)
  place    <edit.json> --shots <shots.json> [--track Video] [--scene 0.25] [--max-rate 1] [--sfx <wav>]
                                                  shots on their lines: shots.json = {"clips":[{"file",
                                                  "starts":[timeline s of each shot], "end"}]}; finds each
                                                  clip's cuts and fits every shot to its slot (slowed, or sped
                                                  up to --max-rate and trimmed). --sfx also writes the
                                                  shots' own sound, cut the same way, as one WAV
  cut      <edit.json> --from s --to s            remove that stretch of time from every track: clips trimmed or
                                                  split, everything after it (clips, captions, keyframes) moves up
  reframe  <edit.json> --size 1080x1350 --out <edit-v2.json>   the edit in another frame size (positions and
                                                  sizes scaled; media still fills the frame)
  export   <edit.json> [--out <mp4>] [--scale 0.5] [--from s] [--to s] [--timeout 1800]
                                                  H.264 + AAC; default out: the doc's "output", else
                                                  final/<id>_V<n>_<rest of folder>.mp4 (n from edit-v<n>.json)
  frames   <edit.json> --at 1,4.5,9 [--out <png>] [--scale 0.5]   a contact sheet of those moments
  captions <edit.json> --words <transcript.json|timing.json> [--max 3] [--track Captions] [--from s] [--to s]
                                                  word-timed caption lines into the track's captions clip
                                                  (breaks at punctuation, pauses and a song's lyric lines)
  match    <edit.json> [--track Video] [--ref <clip src>] [--strength 0.75]   per-clip color match
                                                  (grade.match) toward the reference clip (default: the median look)
  moves    <edit.json> [--from s] [--to s] [--track Video]   timeline times where the picture moves most
                                                  (to place sound effects on actions)
  duck     <edit.json> --track Music --words <transcript.json> [--speaker S1] [--db -10]
                                                  volume keyframes: the track dips while they speak
  comments <ad folder> [--wait] [--done <id> --reply "…" --span 12.4-15]   review notes left in Studio: open
                                                  ones print as JSON with what was on screen and a contact sheet of
                                                  their moments (marked spots outlined), and turn "seen"; --wait
                                                  blocks until there is one; --done marks one done with the
                                                  changed stretch, which Studio's review button plays

Document (times are seconds on the timeline clock; any number marked * also takes keyframes
[[t, value, easing?], …], easing: linear | in | out | ease (default) | back | bounce | elastic | hold):
  { size: [1080, 1920], fps: 30, background, loudness: -14 (LUFS; null = untouched), fonts: { family: file },
    fx: "fx.js" (the ad's own layers / transitions / animations, see studio/engine/draw.js), output,
    tracks: [ { name, hidden, mute, volume* (dB), opacity*, grade,
                transform: { scale*, x*, y*, rotate*, origin: [x, y] }, clips: [...] } ] }
  The first track draws on top. Paths are relative to the document.
  Every clip: type (else from src), at, end (or dur; media default to the source's end), name.
    video  src, in (source s), rate, mute, volume* (dB), fit (cover | contain | fill), grade,
           transition: { type, dur (0.4), dir, ease, color } into it from the clip before it on its track,
           centered on the cut: cut | fade | dip | slide | push | wipe (dir left|right|up|down) | zoom | blur | flip
    audio  src, in, rate, volume* (dB), fadeIn, fadeOut, loop
    image  src, fit, grade
    text   text ("line\\nwith {accent} words and {any color|#FF3B30}"), style
    captions  lines: [{ text, at, end, words: [[word, start, end, color?], …] }], style,
           active: { color, scale, ease, dur } (the spoken word), upcoming: { color, opacity } (0 = reveal word by word)
    rect   color*, radius*
    custom draw (a layer in fx), any params
  Visual clips: x*, y* (center), w*, h* (box; media default the frame), scale*, rotate*, opacity*, blur*,
    origin: [x, y] (scale/rotate pivot), radius*, enter / exit: type or { type, dur }:
    fade | pop | bounce | zoom | blur | slide-up | slide-down | slide-left | slide-right
  style: font (Google Fonts family or doc.fonts), size, weight, italic, color, accent, stroke, strokeWidth,
    shadow { color, blur, x, y, opacity }, background { color, padX, padY, radius, opacity }, maxWidth,
    lineHeight, letterSpacing, case (upper | lower)
  grade: exposure* (stops), contrast*, saturation*, gamma* (1 = as shot), temperature*, tint* (-1..1),
    vignette*, grain* (0..1), match ([gL, ga, gb, oL, oa, ob]: Lab × g + o, from \`match\`)`;

const args = parseArgs(process.argv.slice(2), { flags: ['wait'], help: HELP });
const [cmd, target] = args._;
if (!cmd) usage(HELP);

const readDoc = (p) => {
  if (!p || !existsSync(p)) die(`edit document not found: ${p || '(none given)'}`);
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { die(`${p}: ${e.message}`); }
};
const saveDoc = (p, doc) => writeFileSync(p, JSON.stringify(doc, null, 1) + '\n');
// A clip's end on the timeline: end, else at + dur, else `open` (media run to the source's end).
const clipEnd = (c, open = Infinity) => c.end ?? (c.dur != null ? (c.at ?? 0) + c.dur : open);
const trackNamed = (doc, name) => (doc.tracks || []).find((tr) => tr.name === name) || die(`no track named "${name}" (tracks: ${(doc.tracks || []).map((t) => t.name).join(', ')})`);

// ---------- check ----------
function check(p) {
  const doc = readDoc(p), dir = dirname(p), problems = [];
  const lines = [];
  let end = 0;
  for (const tr of doc.tracks || []) {
    const clips = [...(tr.clips || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    lines.push(`${tr.name}${tr.mute ? ' (muted)' : ''}${tr.hidden ? ' (hidden)' : ''}: ${clips.length} clip(s)`);
    clips.forEach((c, i) => {
      if (c.src && !existsSync(resolve(dir, c.src))) problems.push(`${tr.name}: missing ${c.src}`);
      const stop = clipEnd(c, null);
      if (stop != null) end = Math.max(end, stop);
      const next = clips[i + 1];
      const video = (x) => x?.src && (x.type || 'video') === 'video' && !/\.(mp3|wav|m4a|aac|ogg|opus|flac|png|jpe?g|webp|gif|avif)$/i.test(x.src);
      if (stop != null && video(c) && video(next) && next.at > stop + 0.001) problems.push(`${tr.name}: ${round(next.at - stop)}s of black at ${round(stop)}s`);
    });
  }
  console.log(`${(doc.size || [1080, 1920]).join('x')} @ ${doc.fps || 30} fps · ${round(doc.duration ?? end)}s`);
  for (const l of lines) console.log('  ' + l);
  for (const pr of problems) console.log('PROBLEM: ' + pr);
  if (!problems.length) console.log('ok');
}

// ---------- place ----------
const probeDur = (f) => +ffprobeJson(f).format.duration;
const cutsIn = (f, thr) => [...(run('ffmpeg', ['-hide_banner', '-i', f, '-vf', `select='gt(scene,${thr})',showinfo`, '-an', '-f', 'null', '-'], { allowFail: true }).stderr || '')
  .matchAll(/pts_time:([0-9.]+)/g)].map((m) => +m[1]);

function placeCmd(p) {
  if (!args.shots) die('--shots <shots.json> is required');
  const doc = readDoc(p), dir = dirname(p), fps = doc.fps || 30, maxRate = +(args['max-rate'] || 1);
  const fr = (t) => Math.round(Math.round(t * fps) / fps * 1e4) / 1e4;
  const clips = [];
  for (const c of readDoc(resolve(args.shots)).clips) {
    const f = resolve(dir, c.file), dur = probeDur(f);
    const b = [0, ...cutsIn(f, +(args.scene || 0.25)), dur], st = [...c.starts, c.end];
    if (b.length !== st.length) console.error(`WARN: ${c.file}: found ${b.length - 1} shots, planned ${c.starts.length} — check it by eye`);
    for (let k = 0; k < Math.min(b.length, st.length) - 1; k++) {
      const s0 = b[k] + (k ? 1 / fps : 0); // a frame past the cut, so it never shows the shot before
      const seg = b[k + 1] - s0, win = st[k + 1] - st[k];
      const rate = seg >= win ? Math.min(seg / win, maxRate) : (seg - 0.02) / win;
      if (rate < 0.8) console.error(`WARN: ${c.file} shot ${k + 1} slowed to ${rate.toFixed(2)}x`);
      clips.push({ src: c.file, at: fr(st[k]), end: fr(st[k + 1]), in: +s0.toFixed(3), rate: +rate.toFixed(4), mute: true });
    }
  }
  const tr = (doc.tracks ||= []).find((t) => t.name === (args.track || 'Video')) || (doc.tracks.push({ name: args.track || 'Video', clips: [] }), doc.tracks.at(-1));
  tr.clips = clips;
  saveDoc(p, doc);
  console.log(`${clips.length} shots -> ${tr.name}`);
  if (!args.sfx) return;
  // The shots' own sound, cut and tempo-matched like the picture (pitch kept), on a silent bed.
  const files = [...new Set(clips.map((c) => c.src))];
  const tempo = (r) => { const st = []; while (r > 2) { st.push(2); r /= 2; } while (r < 0.5) { st.push(0.5); r /= 0.5; } return [...st, r].map((x) => `atempo=${x}`).join(','); };
  const end = Math.max(...clips.map((c) => c.end));
  const graph = clips.map((c, k) => {
    const win = c.end - c.at;
    return `[${files.indexOf(c.src)}:a]atrim=${c.in}:${(c.in + win * c.rate).toFixed(3)},asetpts=PTS-STARTPTS,${tempo(c.rate)},atrim=0:${win.toFixed(3)},adelay=${Math.round(c.at * 1000)}:all=1[s${k}]`;
  });
  graph.push(`aevalsrc=0:d=${end.toFixed(3)}:s=48000[bed]`, `[bed]${clips.map((_, k) => `[s${k}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first[out]`);
  const out = resolve(dir, args.sfx);
  mkdirSync(dirname(out), { recursive: true });
  run('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', resolve(dir, f)]), '-filter_complex', graph.join(';'), '-map', '[out]', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  console.log(`Saved: ${out}`);
}

// ---------- cut ----------
const isKeys = (v) => Array.isArray(v) && Array.isArray(v[0]);
// Keyframes on the timeline clock after removing [a, b): keys inside drop, later ones move up.
const cutKeys = (v, a, b) => v.filter(([t]) => t < a || t >= b).map(([t, ...rest]) => [t >= b ? round(t - (b - a)) : t, ...rest]);
function cutValues(o, a, b) {
  for (const [k, v] of Object.entries(o || {})) {
    if (isKeys(v)) o[k] = cutKeys(v, a, b);
    else if (v && typeof v === 'object' && !Array.isArray(v) && k !== 'transition') cutValues(v, a, b);
  }
}

function cutCmd(p) {
  const a = +args.from, b = +args.to;
  if (!(b > a)) die('--from and --to (seconds, from < to) are required');
  const doc = readDoc(p), d = b - a, shift = (t) => (t >= b ? round(t - d) : t > a ? a : t);
  for (const tr of doc.tracks || []) {
    cutValues(tr, a, b);
    const out = [];
    for (const c of tr.clips || []) {
      const at = c.at ?? 0, end = clipEnd(c), rate = c.rate ?? 1;
      cutValues(c, a, b);
      if (c.lines) c.lines = c.lines.filter((l) => l.at < a || l.at >= b).map((l) => ({ ...l, at: shift(l.at), end: shift(l.end), ...(l.words && { words: l.words.map(([w, s, e, ...x]) => [w, shift(s), shift(e), ...x]) }) }));
      if (end <= a || at >= b) { if (at >= b) { c.at = round(at - d); if (c.end != null) c.end = round(end - d); } out.push(c); continue; }
      if (at >= a && end <= b) continue; // wholly inside: gone
      if (at < a && end > b && c.src && !c.lines) { // spans the cut: split, the second part skips the cut's source
        out.push({ ...c, end: a });
        out.push({ ...c, at: a, in: round((c.in ?? 0) + (b - at) * rate), ...(c.end != null && { end: round(end - d) }), transition: undefined });
        continue;
      }
      if (at < a) { if (c.end != null || c.dur != null) { c.end = round(Math.max(a, end - d)); delete c.dur; } } // trims its tail (or the cut, inside it)
      else { c.in = round((c.in ?? 0) + (b - at) * rate); c.at = a; if (c.end != null) c.end = round(end - d); } // trims its head
      out.push(c);
    }
    tr.clips = out.filter((c) => c.end == null || c.end - (c.at ?? 0) >= 1 / (doc.fps || 30)); // slivers left by rounding
  }
  if (doc.duration != null) doc.duration = round(doc.duration - d);
  saveDoc(p, doc);
  console.log(`cut ${round(a)}–${round(b)}s (${round(d)}s) from every track`);
}

// ---------- reframe ----------
function reframeCmd(p) {
  const m = /^(\d+)x(\d+)$/.exec(args.size || '');
  if (!m || !args.out) die('--size <W>x<H> and --out <file> are required');
  const doc = readDoc(p), [W, H] = doc.size || [1080, 1920], nw = +m[1], nh = +m[2], sx = nw / W, sy = nh / H;
  const scale = (v, f) => (isKeys(v) ? v.map(([t, x, ...e]) => [t, Math.round(x * f), ...e]) : typeof v === 'number' ? Math.round(v * f) : v);
  const place = (o) => {
    for (const [k, f] of [['x', sx], ['w', sx], ['y', sy], ['h', sy]]) if (o[k] != null) o[k] = scale(o[k], f);
    if (o.origin) o.origin = [Math.round(o.origin[0] * sx), Math.round(o.origin[1] * sy)];
  };
  for (const tr of doc.tracks || []) {
    if (tr.transform) place(tr.transform);
    for (const c of tr.clips || []) {
      place(c);
      if (c.style?.maxWidth) c.style.maxWidth = Math.round(c.style.maxWidth * sx);
    }
  }
  doc.size = [nw, nh];
  delete doc.output;
  const out = resolve(args.out);
  saveDoc(out, doc);
  console.log(`${W}x${H} -> ${nw}x${nh}: ${out} (check text positions on a frames sheet)`);
}

// ---------- headless engine ----------
function engineBundle() {
  const out = join(tmpdir(), 'ad-production-kit-edit', 'headless.js');
  mkdirSync(dirname(out), { recursive: true });
  let esbuild;
  try { esbuild = import.meta.resolve('esbuild'); } catch { die('esbuild missing — run: bash tools/setup.sh'); }
  return import(esbuild).then((m) => m.build({
    entryPoints: [join(import.meta.dirname, '..', 'studio', 'engine', 'headless.js')],
    bundle: true, format: 'esm', target: 'es2022', outfile: out, logLevel: 'error',
    nodePaths: [join(import.meta.dirname, '..', 'studio', 'node_modules')],
  })).then(() => readFileSync(out));
}

async function browser() {
  let pw;
  try { pw = await import('playwright-core'); } catch { die('playwright-core missing — run: bash tools/setup.sh'); }
  const opts = { headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist'] };
  // An installed Chrome or Edge first (they carry H.264/AAC), else Playwright's Chromium, downloaded on the first export.
  const launch = async () => {
    for (const channel of ['chrome', 'msedge', 'chromium']) {
      try { return await pw.chromium.launch({ ...opts, channel }); } catch {}
    }
    return null;
  };
  let b = await launch();
  if (!b) {
    console.error('No Chrome or Edge found: downloading Chromium for the export (once)…');
    run(process.execPath, [join(import.meta.dirname, '..', 'node_modules', 'playwright-core', 'cli.js'), 'install', '--no-shell', 'chromium'], { allowFail: true });
    b = await launch();
  }
  return b || die(`no browser for the export: install Google Chrome${process.platform === 'linux' ? ', or run: sudo npx playwright-core install-deps chromium' : ''}`);
}

// Serve the plan's brand folder + the engine page; collect the output; resolve when the page reports done.
async function runPage(planPath, query, outPath, { timeout = 1800, onProgress } = {}) {
  const brand = resolve(brandDirFrom(planPath));
  const root = brand === resolve(planPath) ? dirname(planPath) : brand;
  const app = await engineBundle();
  const fd = openSync(outPath, 'w');
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const body = (req) => new Promise((r) => { const parts = []; req.on('data', (d) => parts.push(d)); req.on('end', () => r(Buffer.concat(parts))); });
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (req.method === 'POST') {
      const b = await body(req);
      if (u.pathname === '/out') writeSync(fd, b, 0, b.length, +u.searchParams.get('offset'));
      else if (u.pathname === '/progress') onProgress?.(+b.toString());
      else if (u.pathname === '/done') resolveDone(JSON.parse(b.toString()));
      return res.end('ok');
    }
    if (u.pathname === '/') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><script type="module" src="/app.js"></script>');
    if (u.pathname === '/app.js') return res.writeHead(200, { 'Content-Type': 'text/javascript' }).end(app);
    const file = resolve(root, decodeURIComponent(u.pathname.replace(/^\/f\//, '')));
    if (!u.pathname.startsWith('/f/') || !(file + sep).startsWith(root + sep) && file !== root) return res.writeHead(403).end();
    let st;
    try { st = statSync(file); } catch { return res.writeHead(404).end(); }
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const head = { 'Content-Type': mimeOf(file), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
    if (!m) return createReadStream(file).pipe(res.writeHead(200, { ...head, 'Content-Length': st.size }));
    const s = m[1] ? +m[1] : st.size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    createReadStream(file, { start: s, end: e }).pipe(res.writeHead(206, { ...head, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const b = await browser();
  const page = await b.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  const plan = relative(root, planPath).split(sep).map(encodeURIComponent).join('/');
  await page.goto(`http://127.0.0.1:${server.address().port}/?plan=${plan}&${new URLSearchParams(query)}`);
  const timer = setTimeout(() => resolveDone({ error: `timed out after ${timeout}s` }), timeout * 1000);
  const result = await done;
  clearTimeout(timer);
  closeSync(fd);
  await b.close();
  server.close();
  if (result.error) die(result.error);
  for (const e of result.errors || []) console.error('WARN: ' + e);
  return result;
}

function defaultOut(planPath, doc) {
  if (doc.output) return resolve(dirname(planPath), doc.output);
  const folder = basename(dirname(planPath));
  const [id, ...rest] = folder.split('_');
  const v = /^edit-v(\d+)\.json$/i.exec(basename(planPath))?.[1] || '1';
  return join(dirname(planPath), 'final', `${id}_V${v}_${rest.join('_')}.mp4`);
}

// Studio reads this to show the export's state.
const statusFile = (planPath) => join(dirname(planPath), '.export.json');
const setStatus = (planPath, s) => writeFileSync(statusFile(planPath), JSON.stringify({ plan: basename(planPath), pid: process.pid, at: Date.now(), ...s }));

async function exportCmd(p) {
  const doc = readDoc(p);
  const out = args.out ? resolve(args.out) : defaultOut(p, doc);
  mkdirSync(dirname(out), { recursive: true });
  const query = { mode: 'export', scale: args.scale || 1, ...(args.from && { from: args.from }), ...(args.to && { to: args.to }) };
  setStatus(p, { state: 'running', progress: 0 });
  const t0 = Date.now();
  let shown = 0;
  try {
    const r = await runPage(p, query, out, {
      timeout: +(args.timeout || 1800),
      onProgress: (x) => { setStatus(p, { state: 'running', progress: x }); if (x - shown >= 0.25) { shown = x; console.error(`${Math.round(x * 100)}%`); } },
    });
    const meta = ffprobeJson(out);
    const rel = relative(dirname(p), out).split(sep).join('/');
    setStatus(p, { state: 'done', out: rel, seconds: round((Date.now() - t0) / 1000) });
    console.error(`done      ${round(+meta.format.duration)}s in ${round((Date.now() - t0) / 1000)}s`);
    console.log('Saved: ' + out);
  } catch (e) {
    setStatus(p, { state: 'failed', error: String(e.message || e) });
    throw e;
  }
}

async function framesCmd(p) {
  if (!args.at) die('--at <seconds,seconds,…> is required');
  const out = args.out ? resolve(args.out) : join(tmpdir(), 'ad-production-kit-edit', `frames-${Date.now()}.png`);
  mkdirSync(dirname(out), { recursive: true });
  await runPage(p, { mode: 'frames', at: args.at, scale: args.scale || 0.5 }, out);
  console.log('Saved: ' + out);
}

// ---------- captions ----------
// Words from a kit transcript ({words:[{word,start,end}]}) or a song timing file ({lines:[{words}]}).
function readWords(file) {
  const d = readDoc(file);
  // A song's lyric lines end a caption line too.
  const ws = d.words || (d.lines || []).flatMap((l) => (l.words || []).map((w, i, a) => ({ ...w, brk: i === a.length - 1 })));
  if (!ws.length) die(`${file}: no word timings (transcribe with --words, or a song .timing.json)`);
  return ws.map((w) => ({ word: String(w.word).trim(), start: +w.start, end: +w.end, speaker: w.speaker, brk: w.brk })).filter((w) => w.word);
}

function captionsCmd(p) {
  if (!args.words) die('--words <transcript.json> is required');
  const doc = readDoc(p), max = +(args.max || 3), from = +(args.from || 0), to = args.to ? +args.to : Infinity;
  const ws = readWords(resolve(args.words)).filter((w) => w.start >= from && w.start < to);
  const groups = [];
  let g = [];
  ws.forEach((w, i) => {
    g.push(w);
    const next = ws[i + 1];
    if (!next || w.brk || g.length >= max || /[,.!?;:]$/.test(w.word) || next.start - w.end > 0.5) { groups.push(g); g = []; }
  });
  const clean = (s) => s.replace(/[,.;:]+$/, '');
  const lines = groups.map((grp, i) => {
    const next = groups[i + 1];
    const last = grp[grp.length - 1].end;
    const end = next && next[0].start - last < 1.2 ? next[0].start : last + 0.4;
    return { text: grp.map((w) => clean(w.word)).join(' '), at: round(grp[0].start), end: round(end), words: grp.map((w) => [clean(w.word), round(w.start), round(w.end)]) };
  });
  const tr = (doc.tracks ||= []).find((t) => t.name === (args.track || 'Captions')) || (doc.tracks.unshift({ name: args.track || 'Captions', clips: [] }), doc.tracks[0]);
  let clip = tr.clips.find((c) => c.type === 'captions' || c.lines);
  if (!clip) tr.clips.push(clip = { type: 'captions', style: { font: 'Inter', weight: 700, size: 72, color: '#FFFFFF', stroke: '#000000', strokeWidth: 6 }, y: Math.round((doc.size?.[1] || 1920) * 0.65) });
  if (args.from || args.to) clip.lines = [...(clip.lines || []).filter((l) => l.at < from || l.at >= to), ...lines].sort((a, b) => a.at - b.at);
  else clip.lines = lines;
  saveDoc(p, doc);
  console.log(`${lines.length} caption lines (≤${max} words) -> ${tr.name}`);
}

// ---------- color match ----------
// Reinhard transfer in CIELAB: each clip's Lab mean and spread moved to the reference's (the shader applies it).
const lab = (r, g, b) => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [r, g, b].map(lin);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116);
  const x = f((0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047), y = f(0.2126729 * R + 0.7151522 * G + 0.072175 * B), z = f((0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
// Lab mean and spread over 8 frames of the part of the source a clip uses (near-black and near-white pixels skipped).
function stats(file, a, b) {
  const acc = [[0, 0], [0, 0], [0, 0]];
  let n = 0;
  for (let i = 0; i < 8; i++) {
    const t = a + ((b - a) * (i + 0.5)) / 8;
    const px = run('ffmpeg', ['-v', 'quiet', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=64:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { allowFail: true, binary: true }).stdout;
    for (let j = 0; px && j + 2 < px.length; j += 3) {
      const L = lab(px[j] / 255, px[j + 1] / 255, px[j + 2] / 255);
      if (L[0] < 5 || L[0] > 95) continue;
      for (let c = 0; c < 3; c++) { acc[c][0] += L[c]; acc[c][1] += L[c] * L[c]; }
      n++;
    }
  }
  return n ? acc.map(([s, s2]) => ({ m: s / n, sd: Math.sqrt(Math.max(1e-6, s2 / n - (s / n) ** 2)) })) : null;
}

function matchCmd(p) {
  const doc = readDoc(p), dir = dirname(p), tr = trackNamed(doc, args.track || 'Video');
  const vids = tr.clips.filter((c) => c.src && (c.type || 'video') === 'video');
  const st = vids.map((c) => {
    const a = c.in ?? 0, b = a + ((c.end ?? c.at + 2) - (c.at ?? 0)) * (c.rate ?? 1);
    return stats(resolve(dir, c.src), a, Math.max(a + 0.1, b));
  });
  const ok = st.filter(Boolean);
  if (!ok.length) die('could not read any clip');
  const med = (xs) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
  const ref = args.ref ? st[vids.findIndex((c) => c.src === args.ref)] || die(`--ref ${args.ref} is not a clip on ${tr.name}`)
    : [0, 1, 2].map((ch) => ({ m: med(ok.map((x) => x[ch].m)), sd: med(ok.map((x) => x[ch].sd)) }));
  const k = +(args.strength ?? 0.75); // part of the way: a full transfer can flatten deliberate looks
  vids.forEach((c, i) => {
    if (!st[i]) return;
    const r = st[i].map((s, ch) => Math.min(1.6, Math.max(0.6, ref[ch].sd / s.sd)));
    const g = r.map((x) => 1 + k * (x - 1)), o = st[i].map((s, ch) => k * (ref[ch].m - s.m * r[ch]));
    c.grade = { ...c.grade, match: [...g, ...o].map((x) => +x.toFixed(3)) };
  });
  saveDoc(p, doc);
  console.log(`matched ${vids.length} clips on ${tr.name} to ${args.ref || 'their median look'}`);
}

// ---------- movement ----------
// Frame-difference energy of each shown frame (timeline clock); peaks = actions.
function movesCmd(p) {
  const doc = readDoc(p), dir = dirname(p), tr = trackNamed(doc, args.track || 'Video'), fps = doc.fps || 30;
  const from = +(args.from || 0), to = args.to ? +args.to : Infinity;
  const energy = [];
  for (const c of tr.clips.filter((x) => x.src && x.end > from && x.at < to)) {
    const a = Math.max(c.at, from), b = Math.min(c.end, to), rate = c.rate ?? 1;
    const s0 = (c.in ?? 0) + (a - c.at) * rate, len = (b - a) * rate;
    const raw = run('ffmpeg', ['-v', 'quiet', '-ss', s0.toFixed(3), '-t', len.toFixed(3), '-i', resolve(dir, c.src), '-vf', `fps=${fps / rate},scale=48:84,format=gray`, '-f', 'rawvideo', '-'], { allowFail: true, binary: true }).stdout;
    const n = 48 * 84;
    for (let f = 1; raw && (f + 1) * n <= raw.length; f++) {
      let d = 0;
      for (let i = 0; i < n; i++) d += Math.abs(raw[f * n + i] - raw[(f - 1) * n + i]);
      energy.push({ t: a + f / fps, e: d / n, cut: f === 1 || b - (a + f / fps) < 0.15 });
    }
  }
  const es = energy.filter((x) => !x.cut).map((x) => x.e).sort((x, y) => x - y);
  const floor = es[Math.floor(es.length * 0.6)] || 0;
  const peaks = [];
  energy.forEach((x, i) => {
    const win = energy.slice(Math.max(0, i - 6), i + 7);
    if (x.cut || x.e <= floor * 1.5 || x.e > floor * 10 || x.e < Math.max(...win.map((w) => w.e))) return; // > 10× is a cut inside the clip
    if (peaks.length && x.t - peaks[peaks.length - 1].t < 0.6) { if (x.e > peaks[peaks.length - 1].e) peaks[peaks.length - 1] = x; return; }
    peaks.push(x);
  });
  console.log(JSON.stringify(peaks.map((x) => ({ t: round(x.t), strength: round(x.e / (floor || 1)) }))));
}

// ---------- ducking ----------
function duckCmd(p) {
  if (!args.words || !args.track) die('--track <name> and --words <transcript.json> are required');
  const doc = readDoc(p), tr = trackNamed(doc, args.track), dip = +(args.db ?? -10), base = typeof tr.volume === 'number' ? tr.volume : 0;
  const ws = readWords(resolve(args.words)).filter((w) => !args.speaker || w.speaker === args.speaker);
  const spans = [];
  for (const w of ws) { const s = spans[spans.length - 1]; if (s && w.start - s[1] < 0.6) s[1] = Math.max(s[1], w.end); else spans.push([w.start, w.end]); }
  const keys = [[0, base]];
  for (const [a, b] of spans) keys.push([round(Math.max(0, a - 0.25)), base], [round(a), base + dip], [round(b), base + dip], [round(b + 0.4), base]);
  tr.volume = keys.filter((k, i) => !i || k[0] > keys[i - 1][0]);
  saveDoc(p, doc);
  console.log(`${tr.name}: ${dip} dB under ${spans.length} spoken stretch(es)${args.speaker ? ` of ${args.speaker}` : ''}`);
}

// ---------- review comments ----------
// One file per note in <ad>/comments/ (written by Studio): { id, t, box?: [x, y, w, h] (fractions), text, plan, status, reply? }

// What shows at time t in a document: per track, the clips live then (index, what it is, its span).
function onScreen(doc, t) {
  const out = {};
  for (const tr of doc.tracks || []) {
    const sorted = [...(tr.clips || [])].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    sorted.forEach((c, i) => {
      const end = clipEnd(c);
      if (t < (c.at ?? 0) || t >= end) return;
      const line = c.lines?.find((l) => t >= l.at && t < l.end);
      if (c.lines && !line) return;
      const [what, a, b] = line ? [`caption line "${line.text}"`, line.at, line.end] : [c.text != null ? `text "${c.text}"` : c.src || c.draw || c.type, c.at ?? 0, end];
      (out[tr.name] ||= []).push(`#${i} ${what} (${round(a)}–${Number.isFinite(b) ? `${round(b)}s` : 'end'})`);
    });
  }
  return out;
}

async function commentsCmd(dir) {
  const ad = resolve(dir || '.'), cdir = join(ad, 'comments');
  const read = () => (existsSync(cdir) ? readdirSync(cdir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(readFileSync(join(cdir, f), 'utf8')); } catch { return null; } }).filter(Boolean) : []);
  const save = (c) => writeFileSync(join(cdir, `${c.id}.json`), JSON.stringify(c, null, 1) + '\n');
  if (args.done) {
    const c = read().find((x) => x.id === args.done) || die(`no comment ${args.done}`);
    const span = args.span && String(args.span).split('-').map(Number);
    if (span && (span.length !== 2 || !span.every(Number.isFinite))) die('--span is <from>-<to> in seconds');
    save({ ...c, status: 'done', ...(args.reply && { reply: String(args.reply) }), ...(span && { span }) });
    return console.log(`done: ${c.id}`);
  }
  let open = read().filter((c) => c.status === 'open');
  if (!open.length && args.wait) {
    mkdirSync(cdir, { recursive: true });
    open = await new Promise((res) => {
      const w = watch(cdir, () => { const o = read().filter((c) => c.status === 'open'); if (o.length) { w.close(); setTimeout(() => res(read().filter((c) => c.status === 'open')), 300); } });
    });
  }
  open.sort((a, b) => a.t - b.t);
  for (const c of open) save({ ...c, status: 'seen' });
  // Each note with what was on screen, and one sheet of their frames with the marked spots outlined.
  const plans = [...new Set(open.map((c) => c.plan || 'edit.json'))].filter((f) => existsSync(join(ad, f)));
  for (const plan of plans) {
    const doc = readDoc(join(ad, plan)), mine = open.filter((c) => (c.plan || 'edit.json') === plan);
    for (const c of mine) c.showing = onScreen(doc, c.t);
    const sheet = join(tmpdir(), 'ad-production-kit-edit', `notes-${basename(ad).split('_')[0]}-${plan.replace('.json', '')}.png`);
    mkdirSync(dirname(sheet), { recursive: true });
    await runPage(join(ad, plan), { mode: 'frames', at: mine.map((c) => c.t).join(','), boxes: JSON.stringify(mine.map((c) => c.box || null)), scale: 0.4 }, sheet);
    for (const c of mine) c.sheet = sheet;
  }
  console.log(JSON.stringify(open, null, 1));
}

const p = target && resolve(target);
const cmds = { check, place: placeCmd, cut: cutCmd, reframe: reframeCmd, export: exportCmd, frames: framesCmd, captions: captionsCmd, match: matchCmd, moves: movesCmd, duck: duckCmd, comments: commentsCmd };
if (!cmds[cmd]) usage(HELP);
Promise.resolve(cmds[cmd](cmd === 'comments' ? target : p)).catch((e) => die(e?.stack || String(e)));
