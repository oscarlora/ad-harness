---
name: pull-media
description: Fetch a brand's media into a local cache for cataloging — from a Google Drive folder, a local folder/upload, an Air.inc board, or a URL (direct file or a YouTube/social link). The first step of catalog-media; also usable on its own to gather reference assets. Never fabricate — only pull what the source serves.
---

# Pull media

Fetch media into a local cache for **catalog-media**. Sources:

- **Local / upload** — a folder or file on disk. Non-media and `_catalog/` are skipped.
- **Google Drive** — a folder (subfolders included) or file link/id. Uses the workspace's Drive creds
  (share the client folder with that account); without them, the public link works when shared
  "anyone with the link" (Google Docs/Vids skipped). With `--brand`, a folder pull skips files already
  in the brand's `drive-sources.json`.
- **Air.inc** — a board share link (`app.air.inc/a/<id>/b/<board>`), no key. Sub-boards aren't walked.
- **URL** — a direct media file, or a YouTube/social link via `yt-dlp`.
- **Dropbox / OneDrive** — not wired; download and pass the folder as a local source.

```
node tools/pull-media.mjs --source "<link|path>" --out <cache dir> [--workspace <WS>] [--brand <dir>] [--dry-run]
```

The workspace is inferred from `--out` or `--brand`, or pass `--workspace`. `--dry-run` lists what a
Drive or Air pull would download.

`catalog-media.mjs` calls this for links on its own; run it by hand only to gather reference assets
without cataloging them. Only pull what the source serves.
