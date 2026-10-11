---
name: open-studio
description: Launch Ad Harness Studio, the local web app holding every human-facing UI: the ads Board (live-updating review table of a brand's ads with click-to-preview), the Media library (searchable gallery with an editable sidebar), and the Workflow page (where each ad stands in its format's workflow, with the animation storyboard as a swipeable strip and the video edit's live preview, notes and export). One app for all workspaces and brands, with a switcher. Use when the human wants to review ads or a video edit, browse media or track an ad's progress, or asks to "open the studio / board / gallery / batch UI".
---

# Open studio

The human-facing web app (`studio/`). One instance covers every workspace and brand, with a brand
switcher and URLs `/<Workspace>/<Brand>/board`, `/<Workspace>/<Brand>/media` and
`/<Workspace>/<Brand>/workflow[/<ad folder>]`. Pages **update live** as records and renders land.

## Launch

```
node studio/dev.mjs        # from the repo root → http://localhost:4179, or the next free port
```

Run it as a background command and read the address it prints; if Studio is already running it
prints that address and exits, so it never starts a second one. Then open the address for the user
(the agent app's browser pane if it has one, else `open <url>`, or `start <url>` on Windows).
Deps install via `tools/setup.sh` / `setup.ps1` (or `npm install --prefix studio` once).

## Board — review a brand's ads

The ad records (`outputs/json/*.json`) merged with batch plans (`outputs/batches/*.json`) in one
table: rendered thumbnail · status · batch · concept · image type · copy · design. Plan slots with no
record yet show as `planned` rows. Filter by status or batch; search across hook, persona, angle,
format, design. Click an ad for the full-screen viewer. Read-only: the user reviews and calls
approvals/revisions here.

## Media — browse and curate the catalog

The media catalog (`inputs/media/_catalog/`) as a grid with filters (type · source · person · ratio)
and keyword search. The viewer's sidebar **edits records** — fix tags/products, name unknown people —
through `tools/record-media.mjs --merge`. **Use as reference** copies a link to the original (presigned from R2 when the workspace has it).
(Agent-side search is **search-media**.)

## Workflow — track an ad's progress

Every ad folder in `outputs/`, newest first, with its current step. Open one for a step bar for its
format (from the workflow skills), each step done / current / not started, inferred from the folder's
files and the record; each step opens what it made. Animation: Concept · Script · Voices ·
Storyboard · Sheets · Frames · Clips · Edit, with frames and clips counted against the storyboard's
shots, and the storyboard as a swipeable strip of shot cards (row, frame, clip with its model takes,
both prompts). Other formats get a short list of their own (image, song, voiceover, creator brief,
other video).

An ad with an edit document opens on its **Edit** step: the live preview, the timeline, the user's
notes (a click or a box on the frame at a moment, answered by **edit-video**'s review loop) and the
Export button.
