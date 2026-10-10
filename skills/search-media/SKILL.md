---
name: search-media
description: Find and use media from a brand's library — by meaning in any language, by keyword, by product/person/type filters, or by similarity to an asset; video hits come with the matching scene's time range. Use when picking a reference photo or clip for an ad, footage or music for an edit, or answering "what do we have of X".
---

# Search media

The library is the catalog built by **catalog-media** (`inputs/media/_catalog/`).

Reusable assets for every brand (meme SFX, stock sounds) live in the **shared library**,
`workspaces/Shared/Library` — search it the same way, with `--media workspaces/Shared/Library/inputs/media`.

## Agent search — retrieve, then judge

1. **Retrieve**:
   ```
   node tools/search-media.mjs --media <brand>/inputs/media --query "bowl de res visto desde arriba" \
     [--type image|video|audio] [--orientation portrait|landscape|square] \
     [--product "<name>"] [--person "<name>"] [--source brand|generated|external] [--limit 20] [--json]
   node tools/search-media.mjs --media <brand>/inputs/media --like 00042 [filters]
   ```
   Queries are ranked by meaning (Gemini vectors over the words, the pixels/sound, and every video
   scene) fused with keywords. A video hit shows `scene N @ start–end s`: the moment to cut. `--like`
   finds assets that look or sound like one you already picked. Without vectors or a key it falls
   back to keywords (`[keywords]` in the output); run `embed-media` to fix that.
2. **Judge** — Read the top candidates' proxies (`_catalog/proxies/<id>.jpg`) or keyframes and keep
   only true matches.
3. **Use** — a local original is `inputs/media/<name>`. To feed a generator from R2, presign it:
   `node tools/sync-brand.mjs --presign workspaces/<WS>/<Brand> <id>`.

## Human search — the gallery

The **studio** Media page (`/<Workspace>/<Brand>/media`): grid with filters, search, a full-screen
viewer with editable tags/products and people naming, sprite-scrub for video, waveform + transcript
for audio.

## Wiring

Any ad workflow that needs a reference photo, footage, music, or a sound searches here first instead
of hunting raw folders. Anything new the ad makes (renders, voiceovers, music) that is worth reusing
goes back in through **catalog-media** with `--source-type generated`.
