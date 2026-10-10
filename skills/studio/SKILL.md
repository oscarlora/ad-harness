---
name: studio
description: Launch Ad Harness Studio, the local web app holding every human-facing UI: the ads Board (live-updating review table of a brand's ads with click-to-preview), the Media library (searchable gallery with an editable sidebar), and the Workflow page (where each ad stands in its format's workflow, with the animation storyboard as a swipeable strip). One app for all workspaces and brands, with a switcher. Use when the human wants to review ads, browse media or track an ad's progress, or asks to "open the studio / board / gallery / batch UI".
---

# Studio

The human-facing web app (`studio/`, Next.js). One instance covers every workspace and brand — a
brand switcher leading each page's toolbar, and addressable URLs: `/<Workspace>/<Brand>/board`, `/<Workspace>/<Brand>/media` and `/<Workspace>/<Brand>/workflow[/<ad folder>]`.
Pages **update live** as sub-agents write records and renders (the server watches the brand's files
and pushes changes) — no refresh needed.

## Launch

```
node studio/dev.mjs        # from the repo root → http://localhost:4179, or the next free port
```

(`npm run studio` does the same; the direct `node` form works even when npm isn't on the spawn
PATH — e.g. preview launchers. A `PORT` env var sets the starting port, and a busy port shifts
upward to the first free one rather than fighting the instance already there; each port gets its
own build dir, so parallel sessions coexist. Read the address it prints.) Deps install via `tools/setup.sh` / `setup.ps1` (or
`npm install --prefix studio` once).

## Board — review a brand's ads

The per-ad records (`outputs/json/*.json`) merged with batch plans (`outputs/batches/*.json`) in one
table: rendered thumbnail · status · batch · concept · image type · copy · design. Plan slots with no
record yet appear as `planned` rows, so the whole batch — made and still-to-make — reviews in one
place. Filter by status or batch; search across hook, persona, angle, format, design. Click an ad for
the full-screen viewer (metadata sidebar, arrow keys, Open full / Reveal).

Read-only over the records — it never writes. It is the review surface for the orchestrator pattern
(operating principles): the user watches ads land and calls approvals/revisions from here while the
main agent keeps routing work.

## Media — browse and curate the catalog

The media catalog (`inputs/media/_catalog/`) as a true-aspect grid: filters (type · source · person ·
ratio) and keyword search. The viewer's sidebar **edits records** — fix tags/products, name unknown
people — with every edit flowing through `tools/record-media.mjs --merge`, the single merge path.
Video scrubs via sprites; audio plays with waveform + synced transcript. **Use as reference**
presigns the original from R2. (Agent-side search stays in **search-media**.)

## Workflow — track an ad's progress

Every ad folder in `outputs/`, newest first, with its current step. Open one for a step bar for its
format (from the workflow skills), each step done / current / not started, inferred from the files in
the folder and the record when there is one; each step opens what it made. Animation: Concept ·
Script · Voices · Storyboard · Sheets · Frames · Clips · Edit, with frames and clips counted against
the storyboard's shots, and the storyboard as a swipeable strip of shot cards (row, frame, clip with
its model takes, both prompts). Other formats get a short list of their own (image, song, voiceover,
creator brief, other video). Read-only; the Board's ad viewer and ID link here.
