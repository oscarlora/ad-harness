---
name: catalog-media
description: Ingest media into a brand's searchable library — photos, videos, audio from a folder, a Google Drive link, or a URL. One command probes, analyzes with Gemini (descriptions, scenes, sound, products, people, on-media text, a sentence-level transcript of any speech), embeds vectors for search, indexes, and pushes to R2. Use when onboarding a brand's media, adding new assets, emptying the brand's upload inbox, or when asked to ingest/catalog media.
---

# Catalog media

Each file becomes a record at `inputs/media/_catalog/json/<id>.json`; originals sit flat in
`inputs/media/<id>_<descriptor>.<ext>`; derivatives and `vectors.json` live in `_catalog/`. Search
it with **search-media**.

## Before starting

- `<WS>_AI_GATEWAY_API_KEY` in `.env`.
- `inputs/products.json` (`[{ name, aliases, look }]`, or `{ products, vocabulary }`) and
  `_catalog/people.json` (`[{ name, description }]`) — the names analysis matches and spells right in
  transcripts (seeded by **research-brand**). `vocabulary` is optional speech hints, e.g.
  `"Acme (said \"Ack-mee\")"`. Missing files just mean nothing gets matched.

## Ingest

```
node tools/catalog-media.mjs --brand workspaces/<WS>/<Brand> --source "<folder|Drive link|URL>" \
  [--source-type brand|generated|external] [--source-name "Sept shoot"] [--jobs 2] [--no-push] [--dry-run]
```

It runs pull (links only, via **pull-media**) → probe (skips duplicates; `--jobs` / `MEDIA_JOBS`
videos at a time, default 2) → analyze (`tools/analyze-media.mjs`; prompts in
`tools/lib/analysis-prompt.mjs`) → embed (`tools/embed-media.mjs`) → index → push to R2 when the
workspace has R2 keys (`.env.example`). Transcripts are by sentence; **caption-video** aligns word timings later.

Idempotent: already-cataloged files and near-duplicate re-exports are skipped (each skip logged with
its reason); failed analyses retry next run. Without `--source` it finishes what is pending and
pushes. Run it in the foreground with a generous timeout — it is one job, not a fan-out.

A **Drive folder** source is tracked in `_catalog/drive-sources.json`, so later runs download only
new or changed files and remember the folder's source type and name. Safe to run on a schedule with
the same command; `--dry-run` lists what would download. Access: the workspace's Drive creds, else
the folder's public link (see **pull-media**).

`--source-type`: `brand` for real footage and photos, `generated` for AI-made or finished ads,
`external` for stock or third-party.

Single steps: `analyze-media.mjs --media <…/media> --ids 00012 --force` (redo one),
`embed-media.mjs --media <…/media>` (after hand edits), `record-media.mjs --index <…/media>`.

## After ingest

- **People pass** — collect `unknown_people` across new records, cluster by description + source,
  and ask the user to name them once. Add each to `people.json`, move the entry from
  `unknown_people` to `people` in the matching records, then re-run `embed-media`.
- Browse in Studio's Media page (**open-studio**): `/<Workspace>/<Brand>/media`.
