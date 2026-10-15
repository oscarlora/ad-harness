---
name: open-studio
description: Launch Ad Production Kit Studio, the local web app for every human-facing view: the ads Board (review grid), the Media library, and the Workflow page (each ad's progress, its storyboard, and the video edit's live preview, notes and export). One app for all workspaces and brands. Use when the human wants to review ads or a video edit, browse media or track an ad's progress, or asks to "open the studio / board / gallery / batch UI".
---

# Open studio

The human-facing web app (`studio/`). One instance covers every workspace and brand, with a brand
switcher and URLs `/<Workspace>/<Brand>/board`, `/<Workspace>/<Brand>/media` and
`/<Workspace>/<Brand>/workflow[/<ad folder>]`. Pages **update live** as records and renders land.

## Launch

```
node studio/dev.mjs        # from the repo root → http://localhost:4179, or the next free port
                           # --dev while changing Studio's code: hot reload, no rebuild per change
```

Run it as a background command and read the address it prints; if Studio is already running it
prints that address and exits, so it never starts a second one. Then open the address for the user
in the agent app's in-app browser whenever it has one, bringing the pane up if it's hidden; only
without one, `open <url>` (`start <url>` on Windows). Once an ad has its folder, open its own page
(`/<Workspace>/<Brand>/workflow/<ad folder>`), not the list.
Deps install via `tools/setup.sh` / `setup.ps1` (or `npm install --prefix studio` once).

## Pages

- **Board** — the ad records (`outputs/json/*.json`) and batch plans (`outputs/batches/*.json`) by
  status: In Progress (plan slots and ads being made), Pending Review, Approved, plus where each was
  sent. Read-only: the user reviews and calls approvals and revisions here.
- **Media** — the catalog (`inputs/media/_catalog/`). Its sidebar edits records (tags, products,
  people) through `tools/record-media.mjs --merge`.
- **Workflow** — each ad folder's step bar for its format, inferred from the folder's files and the
  record. Animation and slides ads share one view: Concept · Script · Voices · Storyboard · Sheets ·
  Frames · Clips · Edit, frames and clips counted against the storyboard's shots. UGC ads: Concept · Script ·
  Storyboard · Brief · Edit, Concept shows the brief's Message, For and Format lines, Script the LINES TO CAMERA table's Scene and Line columns, Storyboard its other
  columns (actions, editor notes) and the SLIDES / B-ROLL tables. Every .md shown is editable in place (click a block or cell; drag the
  grips to reorder blocks, table rows and columns, or click one to delete, insert, duplicate or comment); selecting text leaves a note for the agent, as on the video, saved to disk at once; changes on disk show live,
  so re-read a file before editing it. An ad with an edit
  document opens on its **Edit** step: live preview, timeline (each track can be turned off in the
  preview to review the others; the guide button shades the 4:5 and 1:1 crops and the Reels safe zone; clicking a media clip opens a trim panel that changes the part of its source
  it plays, sliding what follows), the user's notes (answered by **edit-video**'s review loop) and the
  Export button.
