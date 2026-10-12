#!/usr/bin/env node
// generate-sfx.mjs — generate isolated sound effects with Seed Audio 1.0.

import { die, parseArgs, usage } from './lib/catalog.mjs';
import { runSeedAudio } from './lib/providers.mjs';

const HELP = `generate-sfx.mjs — Seed Audio 1.0 sound-effect generator

Required:
  --prompt "<text>"        Literal description of the sound, timing, texture, and environment
  --out <path>             Output audio path under workspaces/<Workspace>/...

Optional:
  --duration <seconds>     Target length (default 2; best-effort)
  --num <n>                Number of variations (default 1)
  --timeout <seconds>      Max wait per task (default 600)

Env: <WORKSPACE>_SEGMIND_API_KEY (inferred from --out).`;

const args = parseArgs(process.argv.slice(2), { help: HELP });
if (!args.prompt) usage(HELP);
if (!args.out) die('--out is required');
const duration = Number(args.duration || 2);
if (!Number.isFinite(duration) || duration <= 0) die(`--duration must be positive, got: ${args.duration}`);
const num = Math.max(1, parseInt(args.num || '1', 10));
const prompt = [
  'Generate one clean, isolated sound effect only. No speech and no music.',
  String(args.prompt).trim(),
  'Start immediately. Include no unrelated ambience unless explicitly requested.',
].join(' ');
runSeedAudio({ prompt, seconds: duration, num, timeout: args.timeout || 600, out: args.out });
