#!/usr/bin/env node
// edit-video.mjs — render an edit-plan JSON into one finished video with a single ffmpeg pass
// (one compiled filter_complex — no intermediate files). Zero npm deps. Node 22+.
//
// Usage:
//   node tools/edit-video.mjs --plan <edit-plan.json> [--dry-run] [--timeout 1800]
//
// Plan schema (all relative paths resolve against the PLAN file's directory):
//   {
//     "output":   { "path": "out.mp4", "width": 720, "height": 1280, "fps": 30 },
//     "timeline": [                       // ordered clips; each is normalized (scale+pad to the
//       { "src": "clip.mp4",              // output canvas, fps-converted, audio -> 48k stereo)
//         "trim": { "start": 0, "end": 3 },          // source seconds; default whole clip
//         "speed": 0.5,                              // 0.25..4 playback rate — video setpts + pitch-
//                                                    //  preserving atempo; the entry's length on the
//                                                    //  final clock is recomputed (and reported), so
//                                                    //  speeding dialogue shifts all downstream timing
//         "smooth": true,                            // with speed: minterpolate synthetic frames for
//                                                    //  fluid slow-mo (renders slowly)
//         "zoom": { "from": 1, "to": 1.08,           // Ken Burns zoom, values >= 1
//                   "anchor": "center"|"top"|{"x":0.5,"y":0.5},  // fixed crop point; shorthands =
//                                                    //  {0.5,0.5}/{0.5,0} — {x,y} pins the ACTUAL
//                                                    //  subject (e.g. an off-center face) so escalating
//                                                    //  zoom levels don't visibly shift its position
//                   "start": 0, "end": 3 },          // clip-local seconds (post-speed); default whole clip
//         "transition": { "type": "fade"|"dipblack"|"wipeleft"|"wiperight"|"slideup",
//                         "duration": 0.15 } },      // transition INTO the next entry (xfade +
//                                                    //  acrossfade; ignored on the last entry)
//       { "image": "still.png", "duration": 2.5,     // a still as a full-frame segment (silent
//         "zoom": { "from": 1, "to": 1.06 } }        //  audio); Ken Burns crops from a 2x master
//     ],                                  // entries join as hard cuts (concat) or transitions.
//                                         // TRANSITIONS COMPRESS THE TIMELINE: each crossfade of
//                                         //  duration D overlaps its two clips by D, shortening the
//                                         //  total by D. Caption events, overlay windows and
//                                         //  zoomEvents are authored on the hard-cut clock (the sum
//                                         //  of the entry lengths) and auto-shift by the cumulative
//                                         //  overlap; the stderr "timing" map shows the final clock.
//                                         //  FRAME-EXACT AUTHORING TRAP: if you measure a cut frame
//                                         //  from a rendered/final-clock reference (e.g. scrubbing the
//                                         //  output), ADD BACK the shift for any timestamp at/after a
//                                         //  junction before writing it — the tool subtracts it again,
//                                         //  so a final-clock value pasted in as-is lands one
//                                         //  transition-duration too early.
//     "overlays": [                       // stills or b-roll video over the FINAL timeline, in array order
//       { "image": "logo.png",
//         "start": 1, "end": 3,           // final-timeline seconds
//         "x": 0.5, "y": 0.3,             // overlay CENTER as fractions of the canvas (0..1)
//         "scale": 0.4,                   // overlay width as a fraction of output width
//                                         // (omit = natural pixel size)
//         "zoom": { "from": 1, "to": 1.08,             // Ken Burns across [start,end]; crops from a
//                   "anchor": "center"|"top"|{"x","y"} }, // 2x master so the still stays sharp;
//                                                    //  {x,y} = fixed crop point, see timeline.zoom
//         "slideIn":  { "from": "left"|"right"|"top"|"bottom", "duration": 0.3 },  // eased (cubic)
//         "slideOut": { "to":   "left"|"right"|"top"|"bottom", "duration": 0.3 },  //  position moves;
//         "fadeIn": 0.2, "fadeOut": 0.2 },// seconds, optional; combinable with the slides
//       { "video": "broll.mp4",           // b-roll: its frames play during [start,end] while the
//         "start": 4, "end": 6,           //  timeline's AUDIO keeps playing underneath
//         "trim": { "start": 0, "end": 2 },  // overlay-source seconds; default from its start; a
//                                         //  span shorter than end-start holds its last frame, a
//                                         //  longer one is cut off at end
//         "speed": 0.5,                   // 0.25..4 — slow-mo b-roll (pure setpts when muted);
//                                         //  [start,end] stays fixed, so the source span consumed
//                                         //  is (end-start)*speed; "smooth": true = minterpolate
//         "x": 0.5, "y": 0.5,             // center fractions, same as image
//         "scale": 1.0,                   // fraction of the output frame: scaled + padded to
//                                         //  (scale*W)x(scale*H); 1.0 (default) = full-frame cutaway
//         "mute": true,                   // default true — keep the dialogue; false mixes the
//                                         //  b-roll's own audio over the dialogue track
//         "slideIn": {...}, "slideOut": {...},         // same as image overlays
//         "fadeIn": 0.2, "fadeOut": 0.2 }
//     ],
//     "zoomEvents": [                     // quick punch-ins on the base composite (whoever is on
//       { "start": 3.2, "end": 4.1,       //  screen), final-timeline seconds — align starts to the
//                                         //  claim words via the clips' transcripts
//         "to": 1.08,                     // hold zoom, >= 1
//         "anchor": "center"|"top"|{"x":0.56,"y":0.35},  // fixed crop point; default center; use
//                                         //  the SAME {x,y} across a run of escalating events so
//                                         //  each stage re-crops around the subject's real position
//                                         //  (e.g. a face) instead of the canvas's geometric center
//         "rampIn": 0.12, "rampOut": 0.12 } ],  // ramp to/from 1.0 inside [start,end]; 0 = instant
//                                         //  cut (step, no ease) instead of a ramp; events must not
//                                         //  overlap; applied after concat and before overlays, so
//                                         //  captions stay crisp and unzoomed
//     "captions": {                       // burned in via a generated .ass (libass)
//       "style": { "font": "Helvetica Neue Bold",    // or "fontfile": "path.ttf"
//                  "size": 64,                       // px at output height (default 5% of height)
//                  "fill": "#FFFFFF", "stroke": "#000000", "strokeWidth": 3,
//                  "position": "lower"|"center"|"upper",
//                  "marginV": 448,                   // px from the anchored edge (default 35%H lower —
//                                                    //  clear of feed/Reels UI — 12%H upper; center ignores it)
//                  "maxLines": 2 },
//       "events": [ { "start": 0.2, "end": 2.0, "text": "HOOK LINE" } ]
//     },
//     "music": { "src": "bed.mp3", "gain_db": -18,   // base music level
//                "duck_db": -10,                     // duck under speech (sidechaincompress keyed
//                                                    //  on the dialogue track; ~ -duck_db:1 ratio,
//                                                    //  approximate depth; 0 = no ducking)
//                "fadeIn": 0.5, "fadeOut": 1 },      // + amix, then loudnorm (-14 LUFS) on the master
//     "finish": { "grain": 0.3,                      // 0..1 -> ffmpeg noise strength 0..20
//                 "contrast": 1.05, "saturation": 1.1,   // eq filter; 1.0 = unchanged
//                 "temperature": -10,                // -100..100, 0 = neutral; - cooler (bluer) / + warmer
//                                                    //  (redder) via a midtone colorbalance push
//                 "highlights": -10, "shadows": 8,   // -100..100 each, 0 = neutral; - pulls that band
//                                                    //  down / + boosts it (highlights = brights,
//                                                    //  shadows = darks)
//                 "fade": 30 }                       // 0..100, 0 = off; higher = more matte / milky
//                                                    //  lifted blacks. highlights+shadows+fade fold
//                                                    //  into one curves filter (CapCut-style grade)
//   }
//
// Filter order: clips (trim -> speed -> fps -> scale/pad -> zoom) -> junctions (concat, or xfade +
// acrossfade where a transition is set) -> zoomEvents -> overlays (image + video, in array order)
// -> finish -> captions. Captions render last so they stay crisp above grain/grade, punch-ins and
// b-roll.
//
// Fonts: the chosen face is copied into a fonts-only dir next to the plan (<plan>.fonts/) and
// passed to libass via fontsdir (libass loads every file in that dir, so it holds only fonts).
// Default face: Helvetica Neue Bold from /System/Library/Fonts/HelveticaNeue.ttc (family name +
// bold flag) on macOS; where that file doesn't exist (Windows, Linux), Inter Bold from Google Fonts. A Google Fonts name not on disk ("Montserrat ExtraBold", "Archivo Black") is
// downloaded as a static TTF into the same dir (cached; legacy-UA trick, same as make-type-sheet.py).
// The generated subtitle file lands at <plan>.ass.
//
// --dry-run prints the full ffmpeg command and the generated .ass to stderr and writes nothing.
// Real runs: foreground render with progress on stderr, then the output is ffprobe'd and its
// duration checked against the plan's expected total (warn on > 0.5s drift), then `Saved: <path>`.
//
// Encode: libx264 CRF 18, aac_at (AudioToolbox) when available else aac, +faststart, yuv420p.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, basename, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { die, ffprobeJson, findBin, have, parseArgs, run, typeOf } from './lib/catalog.mjs';

const HELP = `edit-video.mjs — edit-plan JSON -> one ffmpeg render

Required:
  --plan <path>       Edit plan JSON (relative paths inside it resolve against its directory)

Optional:
  --dry-run           Print the ffmpeg command + generated .ass to stderr, write nothing
  --timeout <sec>     Max render time (default 1800)

Plan shape (see the header of this file for the full field-by-field doc):
  output:   { path, width=720, height=1280, fps=30 }
  timeline: [ { src, trim:{start,end}?, speed(0.25..4)?, smooth?,       speed = setpts + pitch-preserving
                zoom:{from,to,anchor,start,end}?,                       atempo; a transition crossfades INTO
                transition:{ type:"fade"|"dipblack"|"wipeleft"          the next entry and SHORTENS the total
                             |"wiperight"|"slideup",                    by its duration — downstream times
                             duration=0.15 }? }                         auto-shift (stderr "timing" map)
              | { image, duration, zoom? } ]                            an image entry = Ken Burns still segment
  overlays: [ { image, start, end, x, y, scale,                         x/y = center fractions; zoom = Ken
                zoom:{from,to,anchor}?, slideIn:{from,duration=0.3}?,   Burns across [start,end]; slides are
                slideOut:{to,duration=0.3}?, fadeIn?, fadeOut? }        eased (cubic) position moves
              | { video, start, end, trim:{start,end}?, x, y,           b-roll: its frames play over the
                  scale=1, speed?, smooth?, mute=true,                  timeline while the timeline's audio
                  slideIn?, slideOut?, fadeIn?, fadeOut? } ]            keeps playing; speed<1 = slow-mo;
                                                                        short trims hold their last frame
  zoomEvents: [ { start, end, to=1.08, anchor,                         punch-ins on the base composite,
                  rampIn=0.12, rampOut=0.12 } ]                         final clock, non-overlapping;
                                                                        ramp 0 = instant cut, no ease
  anchor (zoom/zoomEvents): "center"|"top"|{x,y} (frame fractions);    shorthands = {0.5,0.5}/{0.5,0};
                            {x,y} pins the fixed crop point (e.g. an   {x,y} keeps escalating zoom
                            off-center face) so it stays put on-screen levels from shifting the subject
  captions: { style:{ font?|fontfile?, size, fill, stroke, strokeWidth,
                      position:"lower"|"center"|"upper",
                      marginV? (px; default 35%H lower / 12%H upper), maxLines? },
              events:[ { start, end, text } ] }
  music:    { src, gain_db=-18, duck_db=-10, fadeIn?, fadeOut? }
  finish:   { grain=0..1, contrast?, saturation?,                     eq multipliers (1.0 = unchanged);
              temperature=-100..100, highlights=-100..100,            temperature: - cooler / + warmer
              shadows=-100..100, fade=0..100 }                        (colorbalance); highlights/shadows:
                                                                       - down / + up; fade: milky lifted
                                                                       blacks — all fold into curves (0=off)

Compose order: clips (trim -> speed -> fps -> scale/pad -> zoom) -> junctions (concat / xfade +
acrossfade) -> zoomEvents -> overlays -> finish -> captions. Music ducks under the dialogue track
and the master is loudness-normalized. Output: libx264 CRF 18 + AAC, +faststart. Prints "Saved: <path>".`;

const LEGACY_UA = 'Mozilla/5.0 (Windows NT 5.1)'; // no woff2 support -> Google serves static TTF

const warn = (msg) => console.error('WARN: ' + msg);
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const nf = (n) => +n.toFixed(4); // trim float noise before embedding in a filtergraph

// speed -> pitch-preserving atempo stages (atempo takes 0.5..2 per stage; 0.25..4 needs at most two)
const atempoChain = (speed) => {
  const st = [];
  let s = speed;
  while (s > 2) { st.push(2); s /= 2; }
  while (s < 0.5) { st.push(0.5); s *= 2; }
  st.push(nf(s));
  return st.map((v) => `atempo=${v}`);
};

// Quote a path for use inside a filtergraph option value ('...' disables everything except ').
const fesc = (p) => "'" + String(p).replace(/'/g, "'\\''") + "'";

// ---------- fonts ----------
const SYS_FONT_DIRS = ['/System/Library/Fonts', '/System/Library/Fonts/Supplemental', '/Library/Fonts', join(homedir(), 'Library', 'Fonts')];
const WEIGHT_WORDS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, heavy: 900, black: 900 };

function findSystemFont(name) {
  const variants = [...new Set([name, name.replace(/ /g, ''), name.replace(/ /g, '-')])];
  for (const dir of SYS_FONT_DIRS) for (const v of variants) for (const ext of ['.ttc', '.ttf', '.otf'])
    if (existsSync(join(dir, v + ext))) return join(dir, v + ext);
  return null;
}

// Port of make-type-sheet.py _google_ttf: the legacy UA makes fonts.googleapis.com emit static
// TTF urls. Tries the exact weight first, then the family default. Cached in destDir.
async function googleTtf(family, weight, destDir, dry) {
  const dest = join(destDir, family.toLowerCase().replace(/[^a-z0-9]+/g, '-') + `-${weight}.ttf`);
  if (existsSync(dest)) return dest;
  if (dry) { console.error(`fonts     would fetch Google font "${family}" (wght ${weight}) -> ${dest}`); return dest; }
  const fam = encodeURIComponent(family).replace(/%20/g, '+');
  for (const spec of [`${fam}:wght@${weight}`, fam]) {
    let css;
    try {
      const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}`, { headers: { 'User-Agent': LEGACY_UA } });
      if (!res.ok) continue;
      css = await res.text();
    } catch { continue; }
    const m = css.match(/src:\s*url\((https:\/\/[^)]+\.ttf)\)/);
    if (!m) continue;
    const f = await fetch(m[1], { headers: { 'User-Agent': LEGACY_UA } });
    if (!f.ok) continue;
    writeFileSync(dest, Buffer.from(await f.arrayBuffer()));
    return dest;
  }
  return null;
}

// Resolve captions.style to a concrete face: files to place in the fonts dir + the ASS
// Fontname/Bold pair. Google downloads land directly in fontsDir (which must exist unless dry).
async function resolveFont(style, fontsDir, rp, dry) {
  const name = style.font && String(style.font).trim();
  if (style.fontfile) {
    const p = rp(style.fontfile);
    if (!existsSync(p)) die(`captions.style.fontfile not found: ${p}`);
    return { fontname: name || basename(p).replace(/\.[^.]+$/, ''), bold: false, copy: [p] };
  }
  if (!name) { // default: Helvetica Neue Bold (family file + bold flag) on macOS, else Inter Bold (Google Fonts)
    const p = '/System/Library/Fonts/HelveticaNeue.ttc';
    if (existsSync(p)) return { fontname: 'Helvetica Neue', bold: true, copy: [p] };
    if (await googleTtf('Inter', 700, fontsDir, dry)) { console.error('fonts     default -> Inter Bold (Google Fonts; Helvetica Neue is macOS-only)'); return { fontname: 'Inter', bold: true, copy: [] }; }
    die('no default caption font: Helvetica Neue is macOS-only and Inter could not be fetched from Google Fonts — set captions.style.font or fontfile');
  }
  let p = findSystemFont(name);
  if (p) return { fontname: name, bold: false, copy: [p] };
  // "<Family> <Weight>" naming a face inside a system family file (e.g. "Helvetica Neue Bold")
  const parts = name.split(/\s+/);
  const weight = parts.length > 1 ? WEIGHT_WORDS[parts[parts.length - 1].toLowerCase()] : undefined;
  const base = weight ? parts.slice(0, -1).join(' ') : null;
  if (base) {
    p = findSystemFont(base);
    if (p) return { fontname: base, bold: weight >= 700, copy: [p] };
  }
  // Google Fonts: the full name may itself be a family ("Archivo Black"); else base:wght@weight.
  p = await googleTtf(name, 400, fontsDir, dry);
  if (!p && base) p = await googleTtf(base, weight, fontsDir, dry);
  if (p) { console.error(`fonts     ${name} -> ${basename(p)} (Google Fonts)`); return { fontname: name, bold: false, copy: [] }; }
  die(`font "${name}" not found on disk or Google Fonts — pass captions.style.fontfile instead`);
}

// ---------- .ass generation ----------
const assColor = (hex) => {
  const h = String(hex || '#FFFFFF').replace('#', '');
  const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  return `&H00${f.slice(4, 6)}${f.slice(2, 4)}${f.slice(0, 2)}`.toUpperCase();
};
function assTime(t) {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
function wrapText(text, budget, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > budget && lines.length < maxLines - 1) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}
function buildAss({ W, H, style, events, fontname, bold }) {
  const size = Math.round(style.size ?? H * 0.05);
  const pos = style.position ?? 'lower';
  const align = pos === 'center' ? 5 : pos === 'upper' ? 8 : 2;
  const mV = Math.round(style.marginV ?? (pos === 'center' ? 0 : pos === 'upper' ? H * 0.12 : H * 0.35));
  const mL = Math.round(W * 0.06), mR = Math.round(W * 0.06);
  const maxLines = style.maxLines ?? 2;
  const budget = Math.max(6, Math.floor((W - mL - mR) / (size * 0.5)));
  const out = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Cap,${fontname},${size},${assColor(style.fill)},${assColor(style.fill)},${assColor(style.stroke ?? '#000000')},&H80000000,${bold ? -1 : 0},0,0,0,100,100,0,0,1,${style.strokeWidth ?? 3},0,${align},${mL},${mR},${mV},1`, '',
    '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  for (const [i, ev] of events.entries()) {
    if (ev.start == null || ev.end == null || ev.end <= ev.start) die(`captions.events[${i}] needs start < end`);
    const clean = String(ev.text ?? '').replace(/[{}]/g, '').replace(/\s*\r?\n\s*/g, ' ').trim();
    if (!clean) die(`captions.events[${i}] has no text`);
    const lines = wrapText(clean, budget, maxLines);
    if (lines.some((l) => l.length > budget * 1.4)) warn(`captions.events[${i}] may overflow ${maxLines} line(s): "${clean.slice(0, 40)}..."`);
    out.push(`Dialogue: 0,${assTime(ev.start)},${assTime(ev.end)},Cap,,0,0,0,,${lines.join('\\N')}`);
  }
  return out.join('\n') + '\n';
}

// ---------- main ----------
const shq = (a) => (/^[\w@%+=:,.\/-]+$/.test(a) ? a : "'" + a.replace(/'/g, "'\\''") + "'");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.plan) { console.log(HELP); process.exit(args.help ? 0 : 1); }
  if (!have('ffmpeg') || !have('ffprobe')) die('ffmpeg/ffprobe not found — install ffmpeg (macOS: static build in ~/.local/bin · Windows: winget install Gyan.FFmpeg)');
  const dry = !!args['dry-run'];
  const timeout = parseInt(args.timeout || '1800', 10);

  const planPath = resolve(String(args.plan));
  if (!existsSync(planPath)) die(`plan not found: ${planPath}`);
  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); } catch (e) { die(`could not parse plan JSON: ${e.message}`); }
  const planDir = dirname(planPath);
  const rp = (p) => (isAbsolute(p) ? p : resolve(planDir, p));

  // ---- output
  const o = plan.output || {};
  if (!o.path) die('plan.output.path is required');
  const outPath = rp(String(o.path));
  const even = (n) => Math.max(2, 2 * Math.round(n / 2));
  const W = even(o.width ?? 720), H = even(o.height ?? 1280), FPS = o.fps ?? 30;
  if (W !== (o.width ?? 720) || H !== (o.height ?? 1280)) warn(`output size rounded to even: ${W}x${H}`);

  // ---- timeline
  const XFADE = { fade: 'fade', dipblack: 'fadeblack', wipeleft: 'wipeleft', wiperight: 'wiperight', slideup: 'slideup' };
  if (!Array.isArray(plan.timeline) || !plan.timeline.length) die('plan.timeline needs at least one clip');
  const parseSpeed = (v, where) => {
    if (v == null) return 1;
    const s = +v;
    if (!(s >= 0.25 && s <= 4)) die(`${where}.speed must be within 0.25..4 (got ${v})`);
    return s;
  };
  const parseTransition = (tr, i) => {
    if (!tr) return null;
    if (i === plan.timeline.length - 1) { warn(`timeline[${i}].transition ignored — the last entry has no next clip`); return null; }
    if (!XFADE[tr.type]) die(`timeline[${i}].transition.type must be one of ${Object.keys(XFADE).join('|')}`);
    const duration = +(tr.duration ?? 0.15);
    if (!(duration > 0 && duration <= 2)) die(`timeline[${i}].transition.duration must be within 0..2 seconds`);
    return { type: tr.type, xtype: XFADE[tr.type], duration };
  };
  // anchor: "center" | "top" (shorthands) or {x,y} fractions of frame — the fixed point zoompan
  // crops toward. Shorthands map to {0.5,0.5} / {0.5,0} so old plans keep rendering identically.
  const parseAnchor = (a, where) => {
    if (a == null || a === 'center') return { x: 0.5, y: 0.5 };
    if (a === 'top') return { x: 0.5, y: 0 };
    if (typeof a === 'object' && typeof a.x === 'number' && typeof a.y === 'number') {
      const x = Math.min(1, Math.max(0, a.x)), y = Math.min(1, Math.max(0, a.y));
      if (x !== a.x || y !== a.y) warn(`${where}.anchor {x,y} clamped to 0..1`);
      return { x, y };
    }
    die(`${where}.anchor must be "center", "top", or {x,y} fractions of frame`);
  };
  const parseZoom = (z, where, wholeEnd) => {
    if (!z) return null;
    if ((z.from ?? 1) < 1 || (z.to ?? 1) < 1) warn(`${where}.zoom values < 1 clamped to 1 (zoompan cannot zoom out)`);
    return {
      from: Math.max(1, z.from ?? 1), to: Math.max(1, z.to ?? 1.1),
      start: z.start ?? 0, end: z.end ?? wholeEnd,
      anchor: parseAnchor(z.anchor, `${where}.zoom`),
    };
  };
  const clips = plan.timeline.map((c, i) => {
    if (c.image) { // a still as a full-frame timeline segment (Ken Burns)
      if (c.src) die(`timeline[${i}]: set src or image, not both`);
      const src = rp(String(c.image));
      if (!existsSync(src)) die(`timeline[${i}].image not found: ${src}`);
      if (typeOf(src) !== 'image') die(`timeline[${i}].image is not an image: ${src}`);
      const dur = +(c.duration ?? 0);
      if (!(dur > 0)) die(`timeline[${i}].duration (seconds > 0) is required with image`);
      return { kind: 'image', src, dur, hasAudio: false, zoom: parseZoom(c.zoom, `timeline[${i}]`, dur), transition: parseTransition(c.transition, i) };
    }
    if (!c.src) die(`timeline[${i}].src is required`);
    const src = rp(String(c.src));
    if (!existsSync(src)) die(`timeline[${i}].src not found: ${src}`);
    const p = ffprobeJson(src);
    if (!(p.streams || []).some((s) => s.codec_type === 'video')) die(`timeline[${i}].src has no video stream: ${src}`);
    const hasAudio = (p.streams || []).some((s) => s.codec_type === 'audio');
    const srcDur = p.format?.duration ? +p.format.duration : null;
    const t = c.trim || {};
    const s = t.start ?? 0;
    let e = t.end ?? srcDur;
    if (e == null) die(`timeline[${i}]: source duration unknown — set trim.end`);
    if (srcDur != null && e > srcDur + 0.01) { warn(`timeline[${i}].trim.end ${e}s > source duration ${r1(srcDur)}s — clamped`); e = srcDur; }
    if (e <= s) die(`timeline[${i}]: trim.end (${e}) must be > trim.start (${s})`);
    const speed = parseSpeed(c.speed, `timeline[${i}]`);
    const smooth = !!c.smooth && speed !== 1;
    if (smooth) warn(`timeline[${i}].smooth: motion-interpolated frames render slowly`);
    const dur = (e - s) / speed;
    if (speed !== 1) console.error(`speed     timeline[${i}] ${speed}x: ${r2(e - s)}s of source -> ${r2(dur)}s on the clock`);
    return { kind: 'video', src, start: s, end: e, dur, speed, smooth, hasAudio, zoom: parseZoom(c.zoom, `timeline[${i}]`, dur), transition: parseTransition(c.transition, i) };
  });
  const totalDur = clips.reduce((m, c) => m + c.dur, 0);

  // ---- junction map: transitions overlap adjacent clips, compressing the timeline.
  // Author times (captions, overlays, zoomEvents) live on the hard-cut clock; shiftSpan moves a
  // [start,end] window onto the final clock by the cumulative overlap of the junctions before it.
  const junctions = [];
  {
    let acc = 0;
    clips.forEach((c, i) => {
      acc += c.dur;
      if (!c.transition) return;
      const d = c.transition.duration;
      if (d >= c.dur || d >= clips[i + 1].dur)
        die(`timeline[${i}].transition.duration ${d}s must be shorter than both entries it joins (${r1(c.dur)}s / ${r1(clips[i + 1].dur)}s)`);
      if (i && clips[i - 1].transition && clips[i - 1].transition.duration + d > c.dur)
        warn(`timeline[${i}]: incoming + outgoing transitions (${r2(clips[i - 1].transition.duration + d)}s) exceed the entry (${r2(c.dur)}s) — it never fully shows`);
      junctions.push({ i, oldT: acc, d });
    });
  }
  const totalShift = junctions.reduce((m, j) => m + j.d, 0);
  const finalDur = totalDur - totalShift;
  const shiftAt = (t) => junctions.reduce((m, j) => m + (t >= j.oldT - 1e-6 ? j.d : 0), 0);
  const shiftLog = [];
  const shiftSpan = (start, end, label) => {
    const d = shiftAt(start);
    if (!d) return [start, end];
    const ns = nf(start - d), ne = nf(Math.min(end - d, finalDur));
    shiftLog.push(`${label} ${r2(start)}-${r2(end)}s -> ${r2(ns)}-${r2(ne)}s (-${r2(d)}s)`);
    return [ns, ne];
  };

  // ---- overlays (image or video b-roll)
  const parseSlide = (s, where) => {
    if (!s) return null;
    const edge = s.from ?? s.to; // slideIn names its entry edge "from"; slideOut its exit edge "to"
    if (!['left', 'right', 'top', 'bottom'].includes(edge)) die(`${where} needs an edge ("from"/"to") of left|right|top|bottom`);
    const duration = +(s.duration ?? 0.3);
    if (!(duration > 0)) die(`${where}.duration must be > 0`);
    return { edge, duration };
  };
  const ovs = (plan.overlays || []).map((ov, k) => {
    if (ov.image && ov.video) die(`overlays[${k}]: set image or video, not both`);
    if (!ov.image && !ov.video) die(`overlays[${k}].image or .video is required`);
    const slideIn = parseSlide(ov.slideIn, `overlays[${k}].slideIn`);
    const slideOut = parseSlide(ov.slideOut, `overlays[${k}].slideOut`);
    const winOf = () => { // [start,end] on the final clock (junction-shifted), slides validated to fit
      let start = ov.start ?? 0, end = ov.end ?? totalDur;
      if (end <= start) die(`overlays[${k}].end must be > start`);
      if (junctions.length) { const [s2, e2] = shiftSpan(start, end, `overlay[${k}]`); start = s2; end = Math.min(e2, finalDur); }
      if (end > finalDur + 0.01) warn(`overlays[${k}].end ${end}s is past the timeline end (${r1(finalDur)}s)`);
      const win = end - start, slid = (slideIn?.duration ?? 0) + (slideOut?.duration ?? 0);
      if (slid > win + 1e-9) die(`overlays[${k}]: slideIn + slideOut (${r2(slid)}s) exceed the overlay window (${r2(win)}s)`);
      return [start, end];
    };
    if (ov.image) {
      const image = rp(String(ov.image));
      if (!existsSync(image)) die(`overlays[${k}].image not found: ${image}`);
      if (typeOf(image) !== 'image') die(`overlays[${k}].image is not an image: ${image}`);
      const [start, end] = winOf();
      let zoom = null, tw = 0, th = 0;
      if (ov.zoom) { // Ken Burns needs the still's own aspect: zoompan renders it at 2x for sharpness
        const st = (ffprobeJson(image).streams || []).find((s) => s.codec_type === 'video');
        if (!st?.width || !st?.height) die(`overlays[${k}].zoom: could not read the image's dimensions: ${image}`);
        tw = even(ov.scale ? W * ov.scale : st.width);
        th = even(tw * st.height / st.width);
        zoom = parseZoom(ov.zoom, `overlays[${k}]`, end - start);
      }
      return { kind: 'image', image, start, end, x: ov.x ?? 0.5, y: ov.y ?? 0.5, scale: ov.scale, zoom, tw, th, slideIn, slideOut, fadeIn: ov.fadeIn, fadeOut: ov.fadeOut };
    }
    const video = rp(String(ov.video));
    if (!existsSync(video)) die(`overlays[${k}].video not found: ${video}`);
    const p = ffprobeJson(video);
    if (!(p.streams || []).some((s) => s.codec_type === 'video')) die(`overlays[${k}].video has no video stream: ${video}`);
    const hasAudio = (p.streams || []).some((s) => s.codec_type === 'audio');
    const srcDur = p.format?.duration ? +p.format.duration : null;
    const [start, end] = winOf();
    const t = ov.trim || {};
    const ts = t.start ?? 0;
    let te = t.end;
    if (te != null && srcDur != null && te > srcDur + 0.01) { warn(`overlays[${k}].trim.end ${te}s > source duration ${r1(srcDur)}s — clamped`); te = srcDur; }
    if (te != null && te <= ts) die(`overlays[${k}]: trim.end (${te}) must be > trim.start (${ts})`);
    const speed = parseSpeed(ov.speed, `overlays[${k}]`);
    const smooth = !!ov.smooth && speed !== 1;
    if (smooth) warn(`overlays[${k}].smooth: motion-interpolated frames render slowly`);
    const needed = end - start;          // frames to fill on the final timeline
    let hardEnd = ts + needed * speed;   // never decode past what [start,end] can show (at this rate)
    if (te != null) hardEnd = Math.min(te, hardEnd);
    else if (srcDur != null) hardEnd = Math.min(srcDur, hardEnd);
    if (hardEnd <= ts) die(`overlays[${k}].trim.start ${ts}s is at/past the source end`);
    let mute = ov.mute ?? true;
    if (!mute && !hasAudio) { warn(`overlays[${k}].mute is false but the video has no audio stream — treated as muted`); mute = true; }
    return { kind: 'video', video, ts, hardEnd, needed, mute, speed, smooth, start, end, x: ov.x ?? 0.5, y: ov.y ?? 0.5, scale: ov.scale ?? 1, slideIn, slideOut, fadeIn: ov.fadeIn, fadeOut: ov.fadeOut };
  });

  // ---- zoomEvents (quick punch-ins on the base composite, final-timeline clock)
  const zes = (plan.zoomEvents || []).map((z, k) => {
    if (z.start == null || z.end == null || z.end <= z.start) die(`zoomEvents[${k}] needs start < end`);
    const to = +(z.to ?? 1.08);
    if (to < 1) die(`zoomEvents[${k}].to must be >= 1 (zoompan cannot zoom out)`);
    const rampIn = +(z.rampIn ?? 0.12), rampOut = +(z.rampOut ?? 0.12);
    if (!(rampIn >= 0) || !(rampOut >= 0)) die(`zoomEvents[${k}]: rampIn/rampOut must be >= 0`);
    if (rampIn + rampOut > z.end - z.start + 1e-9) die(`zoomEvents[${k}]: rampIn + rampOut (${r2(rampIn + rampOut)}s) exceed the event (${r2(z.end - z.start)}s)`);
    let start = z.start, end = z.end;
    if (junctions.length) { const [s2, e2] = shiftSpan(start, end, `zoomEvent[${k}]`); start = s2; end = Math.min(e2, finalDur); }
    if (end > finalDur + 0.01) warn(`zoomEvents[${k}].end ${end}s is past the timeline end (${r1(finalDur)}s)`);
    return { start, end, to, rampIn, rampOut, anchor: parseAnchor(z.anchor, `zoomEvents[${k}]`) };
  }).sort((a, b) => a.start - b.start);
  zes.forEach((z, k) => {
    if (k && z.start < zes[k - 1].end - 1e-9)
      die(`zoomEvents overlap on the final clock: one ends at ${r2(zes[k - 1].end)}s, the next starts at ${r2(z.start)}s — punch-ins must not overlap`);
  });

  // ---- music
  let music = null;
  if (plan.music && plan.music.src) {
    const src = rp(String(plan.music.src));
    if (!existsSync(src)) die(`music.src not found: ${src}`);
    if (!(ffprobeJson(src).streams || []).some((s) => s.codec_type === 'audio')) die(`music.src has no audio stream: ${src}`);
    music = { src, gain: plan.music.gain_db ?? -18, duck: plan.music.duck_db ?? -10, fadeIn: plan.music.fadeIn, fadeOut: plan.music.fadeOut };
  }

  // ---- captions -> .ass + fonts dir
  let assPath = null, fontsDir = null, assText = null;
  if (plan.captions && Array.isArray(plan.captions.events) && plan.captions.events.length) {
    const style = plan.captions.style || {};
    const stemPath = planPath.replace(/\.json$/i, '');
    fontsDir = stemPath + '.fonts';
    assPath = stemPath + '.ass';
    if (!dry) mkdirSync(fontsDir, { recursive: true });
    const font = await resolveFont(style, fontsDir, rp, dry);
    for (const srcFont of font.copy) {
      if (dry) console.error(`fonts     would copy ${srcFont} -> ${fontsDir}/`);
      else copyFileSync(srcFont, join(fontsDir, basename(srcFont)));
    }
    let events = plan.captions.events;
    if (junctions.length) events = events.map((ev, i) => { // junction-shift onto the final clock
      if (ev.start == null || ev.end == null || ev.end <= ev.start) return ev; // buildAss reports it
      const [s2, e2] = shiftSpan(ev.start, ev.end, `caption[${i}] "${String(ev.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)}"`);
      return { ...ev, start: s2, end: e2 };
    });
    assText = buildAss({ W, H, style, events, fontname: font.fontname, bold: font.bold });
    if (!dry) writeFileSync(assPath, assText);
  }

  // ---- the junction map, loudly: transitions moved the clock, this is where everything landed
  if (junctions.length) {
    let cum = 0;
    console.error(`timing    transitions compress the timeline: ${r1(totalDur)}s -> ${r1(finalDur)}s (-${r2(totalShift)}s over ${junctions.length} junction(s))`);
    for (const j of junctions) {
      console.error(`timing    junction clip${j.i}->clip${j.i + 1}: ${clips[j.i].transition.type} ${j.d}s — hard-cut clock ${r2(j.oldT)}s = final clock ${r2(j.oldT - cum - j.d)}-${r2(j.oldT - cum)}s (later events shift -${r2(cum + j.d)}s)`);
      cum += j.d;
    }
    for (const l of shiftLog) console.error(`timing    ${l}`);
    if (!shiftLog.length) console.error('timing    no downstream events needed shifting');
  }

  // ---- inputs
  const ffInputs = [];
  clips.forEach((c) => ffInputs.push(...(c.kind === 'image' ? ['-loop', '1', '-i', c.src] : ['-i', c.src])));
  ovs.forEach((ov) => ffInputs.push(...(ov.kind === 'image' ? ['-loop', '1', '-i', ov.image] : ['-i', ov.video])));
  if (music) ffInputs.push('-i', music.src);
  const ovBase = clips.length, mIdx = clips.length + ovs.length;

  // ---- filter graph
  const MINTERP = `minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
  const anyTr = junctions.length > 0;
  const zoomFilter = (z) => { // zoompan on a 2x intermediate; time = frame/fps on the branch clock
    const zexpr = z.end - z.start < 0.04
      ? `if(gte(in/${FPS},${z.start}),${z.to},${z.from})`
      : `${z.from}+(${z.to}-${z.from})*min(max((in/${FPS}-${z.start})/(${z.end}-${z.start}),0),1)`;
    const xexpr = `iw*${z.anchor.x}-(iw/zoom/2)`, yexpr = `ih*${z.anchor.y}-(ih/zoom/2)`;
    return `zoompan=z='${zexpr}':x='${xexpr}':y='${yexpr}':d=1:s=${W}x${H}:fps=${FPS}`;
  };
  const graph = [];
  clips.forEach((c, i) => {
    let v;
    if (c.kind === 'image') { // full-frame still: fit onto a 2x master first so Ken Burns stays sharp
      v = [`fps=${FPS}`, `trim=start=0:end=${c.dur}`, 'setpts=PTS-STARTPTS'];
      if (c.zoom) v.push(
        `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=decrease`,
        `pad=${W * 2}:${H * 2}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', zoomFilter(c.zoom));
      else v.push(
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1');
    } else {
      v = [
        `trim=start=${c.start}:end=${c.end}`,
        c.speed !== 1 ? `setpts=(PTS-STARTPTS)/${c.speed}` : 'setpts=PTS-STARTPTS',
        c.smooth ? MINTERP : `fps=${FPS}`,
        `scale=${W}:${H}:force_original_aspect_ratio=decrease`,
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1',
      ];
      if (c.zoom) v.push(`scale=${W * 2}:${H * 2}`, zoomFilter(c.zoom));
    }
    v.push('format=yuv420p');
    if (anyTr) v.push('settb=AVTB'); // xfade needs every junction input on one timebase
    graph.push(`[${i}:v]${v.join(',')}[v${i}]`);
    if (c.kind === 'video' && c.hasAudio) {
      const a = [`atrim=start=${c.start}:end=${c.end}`, 'asetpts=PTS-STARTPTS'];
      if (c.speed !== 1) a.push(...atempoChain(c.speed));
      a.push('aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo');
      graph.push(`[${i}:a]${a.join(',')}[a${i}]`);
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=start=0:end=${c.dur},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  if (!anyTr) {
    graph.push(clips.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${clips.length}:v=1:a=1[vt][at]`);
  } else { // pairwise left-to-right: xfade/acrossfade at transition junctions, concat at hard cuts
    let vc = 'v0', ac = 'a0', acc = clips[0].dur;
    for (let i = 1; i < clips.length; i++) {
      const tr = clips[i - 1].transition;
      if (tr) {
        graph.push(`[${vc}][v${i}]xfade=transition=${tr.xtype}:duration=${tr.duration}:offset=${nf(acc - tr.duration)}[vj${i}]`);
        graph.push(`[${ac}][a${i}]acrossfade=d=${tr.duration}[aj${i}]`);
        acc += clips[i].dur - tr.duration;
      } else {
        graph.push(`[${vc}][${ac}][v${i}][a${i}]concat=n=2:v=1:a=1[vj${i}][aj${i}]`);
        acc += clips[i].dur;
      }
      vc = `vj${i}`; ac = `aj${i}`;
    }
    graph.push(`[${vc}]null[vt]`, `[${ac}]anull[at]`);
  }

  let cur = 'vt';
  if (zes.length) { // punch-ins on the base composite: 2x up, piecewise zoompan, before overlays
    const T = `(in/${FPS})`;
    // rampIn/rampOut = 0 -> an instant step (gte), no division-by-zero at the boundary; > 0 -> the eased ramp
    const stepIn = (z) => z.rampIn > 0 ? `clip((${T}-${nf(z.start)})/${z.rampIn},0,1)` : `gte(${T},${nf(z.start)})`;
    const stepOut = (z) => z.rampOut > 0 ? `clip((${nf(z.end)}-${T})/${z.rampOut},0,1)` : `lt(${T},${nf(z.end)})`;
    const terms = zes.map((z) => `(${z.to}-1)*${stepIn(z)}*${stepOut(z)}`);
    // anchor: same fixed point for every event -> a plain expr; mixed anchors -> blend by whichever
    // event's [start,end] window is active (falls back to center outside all windows)
    const sameAnchor = zes.every((z) => z.anchor.x === zes[0].anchor.x && z.anchor.y === zes[0].anchor.y);
    const axExpr = sameAnchor ? `${zes[0].anchor.x}`
      : zes.map((z) => `${z.anchor.x}*${`between(${T},${nf(z.start)},${nf(z.end)})`}`).join('+') + '+0.5*(1-(' + zes.map((z) => `between(${T},${nf(z.start)},${nf(z.end)})`).join('+') + '))';
    const ayExpr = sameAnchor ? `${zes[0].anchor.y}`
      : zes.map((z) => `${z.anchor.y}*${`between(${T},${nf(z.start)},${nf(z.end)})`}`).join('+') + '+0.5*(1-(' + zes.map((z) => `between(${T},${nf(z.start)},${nf(z.end)})`).join('+') + '))';
    const xexpr = `iw*(${axExpr})-(iw/zoom/2)`, yexpr = `ih*(${ayExpr})-(ih/zoom/2)`;
    graph.push(`[vt]scale=${W * 2}:${H * 2},zoompan=z='1+${terms.join('+')}':x='${xexpr}':y='${yexpr}':d=1:s=${W}x${H}:fps=${FPS},format=yuv420p[vz]`);
    cur = 'vz';
  }
  ovs.forEach((ov, k) => {
    let br;
    if (ov.kind === 'image') {
      br = ['format=rgba', `fps=${FPS}`, `trim=end=${Math.min(ov.end + 1, finalDur)}`]; // clamp: a branch longer than the timeline would extend the output (framesync repeats the frozen main frame)
      if (ov.zoom) { // Ken Burns: animate across [start,end] on the output clock, from a 2x master
        const z = ov.zoom;
        const zexpr = `${z.from}+(${z.to}-${z.from})*clip((in/${FPS}-${nf(ov.start)})/${nf(Math.max(ov.end - ov.start, 0.04))},0,1)`;
        const oxexpr = `iw*${z.anchor.x}-(iw/zoom/2)`, oyexpr = `ih*${z.anchor.y}-(ih/zoom/2)`;
        br.push(`scale=${ov.tw * 2}:${ov.th * 2}`,
          `zoompan=z='${zexpr}':x='${oxexpr}':y='${oyexpr}':d=1:s=${ov.tw}x${ov.th}:fps=${FPS}`, 'format=rgba');
      } else if (ov.scale) br.push(`scale=${even(W * ov.scale)}:-2`);
      if (ov.fadeIn) br.push(`fade=t=in:st=${ov.start}:d=${ov.fadeIn}:alpha=1`);
      if (ov.fadeOut) br.push(`fade=t=out:st=${r1(ov.end - ov.fadeOut)}:d=${ov.fadeOut}:alpha=1`);
    } else { // video b-roll: trimmed span in local time, held (tpad clone) to fill [start,end], then shifted to start
      const bw = even(W * ov.scale), bh = even(H * ov.scale);
      br = [
        `trim=start=${ov.ts}:end=${ov.hardEnd}`,
        ov.speed !== 1 ? `setpts=(PTS-STARTPTS)/${ov.speed}` : 'setpts=PTS-STARTPTS',
        ov.smooth ? MINTERP : `fps=${FPS}`,
        `scale=${bw}:${bh}:force_original_aspect_ratio=decrease`,
        `pad=${bw}:${bh}:(ow-iw)/2:(oh-ih)/2:color=black`, 'setsar=1', 'format=rgba',
        'tpad=stop=-1:stop_mode=clone', `trim=end=${ov.needed}`,
      ];
      if (ov.fadeIn) br.push(`fade=t=in:st=0:d=${ov.fadeIn}:alpha=1`);
      if (ov.fadeOut) br.push(`fade=t=out:st=${Math.max(0, r1(ov.needed - ov.fadeOut))}:d=${ov.fadeOut}:alpha=1`);
      br.push(`setpts=PTS+${ov.start}/TB`);
    }
    graph.push(`[${ovBase + k}:v]${br.join(',')}[ov${k}]`);
    // position: slides add an eased offset — entry decays as (1-p)^3 (ease-out cubic), exit grows
    // as p^3 (ease-in cubic) — on top of the resting center; fades combine independently
    const baseX = `main_w*${ov.x}-w/2`, baseY = `main_h*${ov.y}-h/2`;
    const OFFSCREEN = { left: { axis: 'x', off: '-w' }, right: { axis: 'x', off: 'main_w' }, top: { axis: 'y', off: '-h' }, bottom: { axis: 'y', off: 'main_h' } };
    let xE = baseX, yE = baseY;
    if (ov.slideIn) {
      const { axis, off } = OFFSCREEN[ov.slideIn.edge];
      const term = `((${off})-(${axis === 'x' ? baseX : baseY}))*pow(1-clip((t-${nf(ov.start)})/${ov.slideIn.duration},0,1),3)`;
      if (axis === 'x') xE = `(${xE})+${term}`; else yE = `(${yE})+${term}`;
    }
    if (ov.slideOut) {
      const { axis, off } = OFFSCREEN[ov.slideOut.edge];
      const term = `((${off})-(${axis === 'x' ? baseX : baseY}))*pow(clip((t-${nf(ov.end - ov.slideOut.duration)})/${ov.slideOut.duration},0,1),3)`;
      if (axis === 'x') xE = `(${xE})+${term}`; else yE = `(${yE})+${term}`;
    }
    const eof = ov.kind === 'video' ? ':eof_action=repeat' : ''; // hold the last b-roll frame through end
    graph.push(`[${cur}][ov${k}]overlay=x='${xE}':y='${yE}':enable='between(t,${ov.start},${ov.end})'${eof}[vo${k}]`);
    cur = `vo${k}`;
  });

  // unmuted b-roll audio joins the dialogue track (so music still ducks under it)
  let dlg = 'at';
  const loud = ovs.map((ov, k) => ({ ov, k })).filter(({ ov }) => ov.kind === 'video' && !ov.mute);
  if (loud.length) {
    loud.forEach(({ ov, k }) => graph.push(
      `[${ovBase + k}:a]atrim=start=${ov.ts}:end=${ov.hardEnd},asetpts=PTS-STARTPTS,` +
      (ov.speed !== 1 ? atempoChain(ov.speed).join(',') + ',' : '') + 'aresample=48000,' +
      `aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=delays=${ov.start}s:all=1[ova${k}]`));
    graph.push(`[at]${loud.map(({ k }) => `[ova${k}]`).join('')}amix=inputs=${loud.length + 1}:duration=first:dropout_transition=3:normalize=0[abr]`);
    dlg = 'abr';
  }

  const fin = plan.finish || {};
  const finSteps = [];
  const eqParts = [];
  if (fin.contrast != null) eqParts.push(`contrast=${fin.contrast}`);
  if (fin.saturation != null) eqParts.push(`saturation=${fin.saturation}`);
  if (eqParts.length) finSteps.push(`eq=${eqParts.join(':')}`);
  // temperature (-100..100): warm/cool via a midtone colorbalance push (red up / blue down = warmer)
  if (fin.temperature != null && +fin.temperature !== 0) {
    const t = +fin.temperature;
    finSteps.push(`colorbalance=rm=${(0.0015 * t).toFixed(4)}:bm=${(-0.0015 * t).toFixed(4)}`);
  }
  // highlights/shadows/fade (-100..100 / -100..100 / 0..100): one curves filter shaping the tone response.
  // fade lifts the black point (matte look); shadows/highlights bow the quarter/three-quarter points.
  if ((fin.highlights != null && +fin.highlights !== 0) || (fin.shadows != null && +fin.shadows !== 0) || (fin.fade != null && +fin.fade !== 0)) {
    const hi = +(fin.highlights ?? 0), sh = +(fin.shadows ?? 0), fd = +(fin.fade ?? 0);
    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const y0 = clamp01(fd / 100 * 0.20);
    let y1 = clamp01(0.25 + sh / 100 * 0.15);
    const y2 = clamp01(0.75 + hi / 100 * 0.15);
    const y3 = clamp01(1 + hi / 100 * 0.10);
    if (y1 <= y0) y1 = clamp01(y0 + 0.01); // keep the control points strictly increasing in y
    finSteps.push(`curves=all='0/${y0.toFixed(4)} 0.25/${y1.toFixed(4)} 0.75/${y2.toFixed(4)} 1/${y3.toFixed(4)}'`);
  }
  if (fin.grain) finSteps.push(`noise=alls=${Math.round(Math.min(1, Math.max(0, fin.grain)) * 20)}:allf=t+u`);
  if (finSteps.length) { graph.push(`[${cur}]${finSteps.join(',')}[vfin]`); cur = 'vfin'; }

  if (assPath) { graph.push(`[${cur}]ass=filename=${fesc(assPath)}:fontsdir=${fesc(fontsDir)}[vcap]`); cur = 'vcap'; }
  graph.push(`[${cur}]format=yuv420p[vout]`);

  if (music) {
    const m = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo', `volume=${music.gain}dB`];
    if (music.fadeIn) m.push(`afade=t=in:st=0:d=${music.fadeIn}`);
    if (music.fadeOut) m.push(`afade=t=out:st=${Math.max(0, r1(totalDur - music.fadeOut))}:d=${music.fadeOut}`);
    m.push(`atrim=start=0:end=${totalDur}`, 'asetpts=PTS-STARTPTS');
    graph.push(`[${mIdx}:a]${m.join(',')}[mus]`);
    if (music.duck) {
      const ratio = Math.min(20, Math.max(2, Math.abs(music.duck)));
      graph.push(`[${dlg}]asplit=2[amain][akey]`);
      graph.push(`[mus][akey]sidechaincompress=threshold=0.02:ratio=${ratio}:attack=20:release=250:makeup=1[mduck]`);
      graph.push('[amain][mduck]amix=inputs=2:duration=first:dropout_transition=3:normalize=0[amix]');
    } else {
      graph.push(`[${dlg}][mus]amix=inputs=2:duration=first:dropout_transition=3:normalize=0[amix]`);
    }
    graph.push('[amix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[aout]');
  } else {
    graph.push(`[${dlg}]anull[aout]`);
  }

  // ---- encode args
  const enc = run('ffmpeg', ['-hide_banner', '-encoders'], { allowFail: true });
  const aac = ((enc.stdout || '').includes('aac_at')) ? 'aac_at' : 'aac';
  const ffArgs = [
    '-y', '-hide_banner', '-loglevel', 'error', '-stats', // error: swscale spams benign warnings on jpeg (yuvj) overlays
    ...ffInputs,
    '-filter_complex', graph.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium',
    '-c:a', aac, '-b:a', '192k',
    '-movflags', '+faststart',
    outPath,
  ];

  if (dry) {
    console.error(`plan      ${clips.length} clip(s) ~${r1(totalDur)}s -> ${W}x${H}@${FPS} · ${ovs.length} overlay(s) · ${plan.captions?.events?.length || 0} caption(s) · music ${music ? 'yes' : 'no'} · audio ${aac}`);
    console.error('--- ffmpeg command:');
    console.error('ffmpeg ' + ffArgs.map(shq).join(' '));
    if (assText) { console.error(`--- generated .ass (would write ${assPath}):`); console.error(assText); }
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  console.error(`render    ${clips.length} clip(s) -> ${W}x${H}@${FPS}, ${ovs.length} overlay(s), ${plan.captions?.events?.length || 0} caption(s), music ${music ? 'yes' : 'no'} — expect ~${r1(totalDur)}s`);
  const t0 = Date.now();
  const r = spawnSync(findBin('ffmpeg'), ffArgs, { stdio: ['ignore', 'inherit', 'inherit'], timeout: timeout * 1000, killSignal: 'SIGKILL' });
  if (r.error && r.error.code === 'ETIMEDOUT') die(`ffmpeg timed out after ${timeout}s`);
  if (r.status !== 0) die('ffmpeg failed (see messages above)');

  const meta = ffprobeJson(outPath);
  const dur = meta.format?.duration ? +meta.format.duration : null;
  if (dur == null) die(`render finished but the output is unreadable: ${outPath}`);
  const drift = Math.abs(dur - totalDur);
  if (drift > 0.5) warn(`output duration ${r1(dur)}s drifts ${r1(drift)}s from the plan's expected ${r1(totalDur)}s`);
  console.error(`done      ${r1(dur)}s ${W}x${H}@${FPS} in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('Saved: ' + outPath);
}

main().catch((e) => die(e?.stack || String(e)));
