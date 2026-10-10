// extend-to-story.mjs — turn an approved 4:5 static into its 9:16 Story version by AI extension.
// Centers the 4:5 on a 9:16 canvas with flat bars (ffmpeg; grey, or white with --paste: grey bars
// read as grey content and leak into a grey subject), then asks the image model to fill
// only the bars by continuing the scene. The model re-renders the middle too (small text can drift);
// by default its whole output is the Story file. --paste puts the original 4:5 back over the middle
// with a 60 px feathered seam, so the approved art stays pixel-identical and only the bars are new
// (used for illustrated slide frames; make-ai-slides).
//
// Usage:
//   node tools/extend-to-story.mjs --in <approved 4:5.png> --out <story.png> \
//     --above "<what continues above>" --below "<what continues below>" [--timeout 600] [--paste] [--dry]
// --dry prints the prompt and writes the padded canvas without generating.
// Generation runs through generate-image.mjs (default model, provider order, 2K, 9:16).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffprobeJson, parseArgs, run } from './lib/catalog.mjs';

const args = parseArgs(process.argv.slice(2));
for (const k of ['in', 'out', 'above', 'below']) if (!args[k] || args[k] === true) { console.error(`Missing --${k}. See the header of this file for usage.`); process.exit(1); }

const tmp = mkdtempSync(join(tmpdir(), 'story-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
// The canvas sits next to --out: Segmind only takes local refs from inside the brand folder.
const padded = join(dirname(args.out), `.${basename(args.out, '.png')}.canvas.png`);
const bar = args.paste ? 'white' : 'grey';
run('ffmpeg', ['-v', 'error', '-y', '-i', args.in, '-vf', `pad=iw:trunc(iw*16/9/2)*2:0:(oh-ih)/2:color=${args.paste ? '0xFFFFFF' : '0x808080'}`, padded]);

const prompt = `Create 1 2K, 9:16 image by extending the reference image.

The reference is a 9:16 canvas: a finished 4:5 ad sits in the middle, with flat ${bar} bars above and below it.

- Keep the middle ad exactly as it is, in the same position and size: nothing moved, redrawn, or restyled, and every word of text identical.
- Fill only the ${bar} bars by continuing the image naturally: above, ${args.above}; below, ${args.below}. Match the light, color, grain, and perspective so there is no visible seam.
- Add nothing new to the bars: no text, stickers, logos, or new objects.

Constraints: one single image. Natural, undistorted proportions.`;
const promptFile = join(tmp, 'prompt.txt');
writeFileSync(promptFile, prompt);
if (args.dry) { console.log(prompt + `\n\npadded canvas: ${padded}`); process.exit(0); }

const gen = join(dirname(fileURLToPath(import.meta.url)), 'generate-image.mjs');
const r = spawnSync(process.execPath, [gen, '--prompt-file', promptFile, '--ref', padded, '--aspect', '9:16', '--resolution', '2K',
  '--timeout', String(args.timeout || 600), '--out', args.out], { stdio: 'inherit' });
if (r.status !== 0 || !args.paste) { rmSync(padded, { force: true }); process.exit(r.status ?? 1); }

// Paste the original back over the middle, feathered at its top and bottom edges.
const { width: w, height: h } = (ffprobeJson(args.in).streams || []).find((s) => s.codec_type === 'video') || {};
if (!w || !h) { console.error(`Could not read the size of ${args.in}.`); process.exit(1); }
const H = Math.trunc(w * 16 / 9 / 2) * 2, top = Math.trunc((H - h) / 2), f = 60;
const pasted = join(tmp, 'pasted.png');
run('ffmpeg', ['-v', 'error', '-y', '-i', args.out, '-i', args.in, '-filter_complex',
  `[0]scale=${w}:${H}[b];[1]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(Y,H-1-Y)/${f})'[o];[b][o]overlay=0:${top}`,
  '-frames:v', '1', pasted]);
copyFileSync(pasted, args.out);
rmSync(padded, { force: true });
