---
name: pull-media
description: Fetch a brand's media into a local cache for cataloging — from a Google Drive folder, a local folder/upload, or a URL (direct file or a YouTube/social link). The first step of catalog-media; also usable on its own to gather reference assets. Never fabricate — only pull what the source serves.
---

# Pull media

Fetch media into a local cache so **catalog-media** can ingest it. Sources:

- **Local / upload** — a folder or file already on disk (e.g. assets a client sent, or shots you
  saved from the brand's site). Copied into the cache; non-media and `_catalog/` are skipped.
- **Google Drive** — a folder (subfolders included) or file link/id. With the workspace's Drive creds
  (the same ones **sync-to-drive** uses; share the client folder with that account) it uses the Drive
  API. Without them it falls back to the public link, which works when the folder is shared "anyone
  with the link" (names only, no change dates; Google Docs/Vids are skipped). With `--brand`, a folder
  pull skips files already in the brand's `drive-sources.json` (see **catalog-media**).
- **Air.inc** — a board share link (`app.air.inc/a/<id>/b/<board>`), read through Air's public share
  API with no key; pulls each asset's original file. Sub-boards aren't walked.
- **URL** — a direct media file, or a YouTube/social link via `yt-dlp` if installed.

```
node tools/pull-media.mjs --source "<link|path>" --out <cache dir> [--workspace <WS>] [--brand <dir>] [--dry-run]
```

The workspace (for Drive creds) is inferred from `--out` under `workspaces/<WS>/...` or `--brand`, or
pass `--workspace`. `--dry-run` lists what a Drive or Air pull would download. Dropbox / OneDrive aren't wired yet — download from those and pass the
folder as a **local** source.

**catalog-media**'s `ingest-media.mjs` calls this for links on its own; run it by hand only to
gather reference assets without cataloging them. Pulling is just the fetch; identification, naming, and the searchable catalog all happen there. Only pull what the
source actually serves — never generate or fabricate media.
