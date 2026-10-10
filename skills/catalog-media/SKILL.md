---
name: catalog-media
description: Ingest media into a brand's searchable library — photos, videos, audio from a folder, a Google Drive link, or a URL. One command probes, analyzes with Gemini via Vercel AI Gateway (descriptions, scenes, sound, products, people, on-media text, a sentence-level transcript of any speech), embeds vectors for search, indexes, and pushes to R2. Use when onboarding a brand's media, adding new assets, emptying the brand's upload inbox, or when asked to ingest/catalog media.
---

# Catalog media

Turn a pile of media into one searchable library. Each file becomes a record at
`inputs/media/_catalog/json/<id>.json`; originals sit flat in `inputs/media/<id>_<descriptor>.<ext>`;
derivatives (thumbs, proxies, keyframes, sprites, peaks) and `vectors.json` live in `_catalog/`.
R2 is the portable master, local is the working copy. Search it with **search-media**.

## Before starting

- `<WS>_AI_GATEWAY_API_KEY` in `.env` (Vercel AI Gateway; it calls Google's paid API, so the media is not trained on).
- `inputs/products.json` (`[{ name, aliases, look }]`, or `{ products, vocabulary }`) and
  `_catalog/people.json` (`[{ name, description }]`) — the names analysis matches against and spells
  right in transcripts (seeded by **research-brand**). `vocabulary` is optional free-form hints for
  speech, e.g. `"Acme (said \"Ack-mee\")"`. Missing ones just mean nothing gets matched.

## Ingest

```
node tools/ingest-media.mjs --brand workspaces/<WS>/<Brand> --source "<folder|Drive link|URL>" \
  [--source-type brand|generated|external] [--source-name "Sept shoot"] [--jobs 2] [--no-push] [--dry-run]
```

It runs, in order: pull (links only, via **pull-media**) → probe (skip duplicates, 5-digit ids,
derivatives; each video decoded once, on the Mac's VideoToolbox engine when it can, with software
fallback; `--jobs` / `MEDIA_JOBS` videos at a time, default 2) → **analyze** (`tools/analyze-media.mjs`, Gemini 3.1 Flash Lite via the Gateway; prompts
in `tools/lib/analysis-prompt.mjs`) → **embed** (`tools/embed-media.mjs`) → index → push to R2 when
the workspace has R2 creds. A video is analyzed as two parallel calls merged into one record: the
picture (a light silent proxy, scenes on the detected cuts) and the sound (the audio track: sound
portrait plus a sentence-level transcript — language, speakers S1, S2…, times ±1 s; tracks over 3
minutes go in ~150 s parts split at pauses, sent in parallel and merged, and a reply that loops on a
word is retried once). Exact word timings are not stored; **caption-video** aligns them when a clip
is captioned.
Idempotent: files already cataloged are skipped — same bytes, or a near-duplicate re-export (an
image with the same picture in any rotation and matching pixels; a video with the same duration and
the same original name or frames). Burst shots and edits stay new; each skip is logged with its
reason. Failed analyses retry on the next run. Without
`--source` it just finishes what is pending (unanalyzed files, stale vectors) and pushes. Run it in
the foreground with a generous timeout — it is one job, not a fan-out.

A **Drive folder** source is tracked: `_catalog/drive-sources.json` records each Drive file ingested
from it (id → name, change date, catalog id — for a skipped duplicate, the id it duplicates), so
later runs download only files it hasn't seen (or
that Drive reports changed, API path only), remember the folder's source type and name, and end with
a one-line summary (new · seen · failed · new ids). Safe to run on a schedule with the same command;
`--dry-run` lists what would download. Access: the workspace's Drive creds, else the folder's public
link (see **pull-media**).

`--source-type`: `brand` for real footage and photos, `generated` for AI-made or finished ads,
`external` for stock or third-party.

Single steps when needed: `analyze-media.mjs --media <…/media> --ids 00012 --force` (redo one),
`embed-media.mjs --media <…/media>` (after hand edits), `record-media.mjs --index <…/media>`.

## After ingest

- **People pass** — collect `unknown_people` across new records, cluster by description + source,
  and ask the user to name them once. Add each to `people.json`, move the entry from
  `unknown_people` to `people` in the matching records, then re-run `embed-media`.
- Browse in the **studio** Media page: `/<Workspace>/<Brand>/media`.

## Setup (one-time)

- **Video / audio** → `ffmpeg` + `ffprobe` (macOS: `bash tools/setup.sh`; Windows: `winget install Gyan.FFmpeg`).
- **URL / social pulls** → `yt-dlp` (macOS: `brew install yt-dlp`; Windows: `winget install yt-dlp.yt-dlp`).
- On Windows `tools/setup.ps1` only checks these and prints the install hints; it doesn't install them.
- **R2** → `<WS>_R2_ACCOUNT_ID`, `_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_BUCKET`. Without them the library stays local.
