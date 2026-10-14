---
name: search-media
description: Find and use media from a brand's library — by meaning in any language, by keyword, by product/person/type filters, or by similarity to an asset; video hits come with the matching scene's time range. Use when picking a reference photo or clip for an ad, footage or music for an edit, or answering "what do we have of X".
---

# Search media

The library is the catalog built by **catalog-media** (`inputs/media/_catalog/`). Search it first
for reference photos, footage, music or sounds, instead of hunting raw folders. Assets for every
brand (music, SFX, references) live in the public **shared library**, which setup pulls (if it
isn't local: `node tools/sync-brand.mjs --pull workspaces/Shared/Library --originals`). Search it
the same way with `--media workspaces/Shared/Library/inputs/media`.

## Agent search — retrieve, then judge

1. **Retrieve**:
   ```
   node tools/search-media.mjs --media <brand>/inputs/media --query "bowl de res visto desde arriba" \
     [--type image|video|audio] [--orientation portrait|landscape|square] \
     [--product "<name>"] [--person "<name>"] [--source brand|generated|external] [--limit 20] [--json]
   node tools/search-media.mjs --media <brand>/inputs/media --like 00042 [filters]
   ```
   Queries match by meaning and keyword, in any language. A video hit shows `scene N @ start–end s`:
   the moment to cut. `--like` finds assets that look or sound like one you picked. If the output
   says `[keywords]`, vectors are missing; run `embed-media`.
2. **Judge** — look at the top candidates' proxies (`_catalog/proxies/<id>.jpg`) or keyframes and
   keep only true matches.
3. **Use** — pass the original's path (`inputs/media/<name>`) to the generator. If it isn't
   local (a light pull), presign it from R2:
   `node tools/sync-brand.mjs --presign workspaces/<WS>/<Brand> <id>`.
