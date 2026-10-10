---
name: sync-to-drive
description: Sync approved ad files to the brand's workspace Google Drive folder — the file store. Use after ads are approved, or alongside a Notion sync. The tool infers the workspace from the spec's path; idempotent (overwrite-by-name). Resolves the destination by fuzzy brand match and never creates folders without an explicit flag.
---

# Sync to Drive

Push approved ad files to the workspace's **Google Drive** (the file store) with
`tools/sync-to-drive.mjs <spec.json>` — the same `_sync_<id>.json` spec as **sync-to-notion**, no
extra field: the tool infers the workspace from the spec's path. It nests
**`<workspace Drive folder> / <brand> / <ad-group name> /`** (ad-group = `driveSubfolder`, else the
spec's `name`) and uploads the files idempotently — images **and video** (mime is derived from the
file extension, so `.mp4`/`.mov` land as real video, not `image/png`); overwrite-by-name;
`supportsAllDrives` on, so Shared Drives work.

**Video ads live in Drive, not Notion** (Notion file uploads cap at ~20MB and the board treats video
this way): sync the video files here, then set the Notion page's **Ad link/Code** to this folder's
URL (printed on completion) rather than uploading the clips to the page. See **sync-to-notion**.

```
node tools/sync-to-drive.mjs workspaces/<WS>/Acme/outputs/_sync_20.json
```

## Resolve the destination first (do this before syncing)

The Drive parent (`<WORKSPACE>_DRIVE_FOLDER`) already contains a folder per client, laid out as
`…<brand>…` (the brand name, sometimes with extra words before/after, e.g. `Acme Ads`). Inside a
brand folder the ads live either in a **package folder** (files dropped straight in, e.g.
`100-statics-package`) or in **per-batch group folders**. **Never create a folder blindly — find the
existing one and confirm placement first.**

1. **Inspect** with `--list` — prints every brand folder under the parent, flags the ones whose name
   *contains* the spec's `brand` (case-insensitive), and lists each match's child folders:
   ```
   node tools/sync-to-drive.mjs --list workspaces/<WS>/Acme/outputs/_sync_41.json
   ```
2. **Pick the brand folder.** The tool matches `brand` by *contains*, so spec `brand: "Acme"` resolves
   to an existing `Acme Ads`. If exactly one folder matches it's used automatically; if several match,
   the sync errors and asks you to set `brand` to the exact name.
3. **Confirm the inner placement with the user** — which package folder, or which group subfolder, or
   files-direct — then set `driveSubfolder` to that exact folder name. A new per-ad folder is named
   `<ID> <descriptor>` (e.g. `41 Static - The Morning Routine Math`) — never prefix it with `#`, even
   where older folders do.
4. **Create only as a last resort.** If the brand or group folder genuinely doesn't exist, confirm with
   the user, then re-run with `--create` to make it (following the `<parent>/<brand>/<group>/` nesting).

## Behavior & flags

- **Brand match = contains** (case-insensitive); exact match wins, a single contains-match is used,
  multiple matches error.
- **Group match = exact name** inside the brand folder (you supply the confirmed `driveSubfolder`).
- **No silent creation.** A missing brand or group folder makes the tool **error and list what
  exists** — it never creates by default. Pass **`--create`** (after user confirmation) to allow it.
- **`--list`** is discovery only; it writes nothing.

## Setup

- **Per-workspace creds in `.env`:** `<WORKSPACE>_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _FOLDER`
  (OAuth Internal app; files owned by the authorizing user, or by the Shared Drive).
- **First time / new machine:** if those vars are missing the tool prints what to do — download the
  workspace's OAuth client (Desktop) JSON and run the one-time consent:
  ```
  node tools/connect-drive.mjs <oauth-client.json> <WORKSPACE>
  ```
  which writes the creds into `.env` (secrets stay local; each machine runs consent once).
