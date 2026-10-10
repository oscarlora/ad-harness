---
name: pull-comments
description: Pull the client's review comments on a batch of ads — from Google Drive or the Notion Ads Board — and turn them into a per-ad revision plan. Use when the client has reviewed ads and left comments, and you want to act on them. Pulls the comments, maps each to its ad record, and proposes the fixes for approval.
---

# Pull comments

The client reviews a batch and comments on the ads — either on the files in their Drive folder, or on
the ad pages in their Notion Ads Board. This pulls those comments and turns them into a **revision
plan** — one entry per ad, grouped by ad ID — for you to approve before anything is regenerated. It
does **not** regenerate on its own.

## 1. Pull — from the source the client reviewed in

**Drive** (client commented on files in the Drive folder). Run on any sync spec for the batch
(`_sync_*.json` carries the brand + `driveSubfolder`), or point straight at a folder:

```bash
node tools/pull-drive-comments.mjs workspaces/<WS>/Acme/outputs/_sync_41.json
node tools/pull-drive-comments.mjs --folder <driveFolderId> <any-spec-under-the-brand>.json
```

Writes `outputs/comments.json`. Resolved comments are flagged, not dropped. When the client drew a box
on the image, the comment carries a `region` (the marked box as fractions of width/height plus a coarse
label like `bottom-center`) — use it to pin which element a comment means; it's the box they drew, not
the freehand strokes.

**Notion** (client commented on pages in the Ads Board). Resolve the board by brand, optionally
filtering to the statuses under review:

```bash
node tools/pull-notion-comments.mjs <WS> "Acme" --status "Revision Needed" --status "Pending Client Review"
```

Writes `outputs/notion-comments.json`. Comments come back grouped into threads per page. The board's
Status property tells you which stage each ad is at. Needs the integration's **"Read comments"**
capability (Notion → integration settings → Capabilities); without it the tool says so and exits.

Each tool prints a per-file/per-page summary so you can read it without opening the file.

## 2. Map each comment to its ad

The ad **ID** keys everything: in Drive it's the leading number in the filename (`41_V2_...png` → ad `41`,
variation `V2`); in Notion it's the page's ID property. Open that ad's record at
`outputs/json/<id>.json` — its concept, copy, design, and the `generation.prompt` are the source of
truth (see **write-prompt**). If a record doesn't exist yet for an older ad, fall back to the `.png` in
`outputs/` and any legacy prompt file.

## 3. Propose the plan

Present one block per ad **in the chat**, plainly — no separate review UI:

- The ad ID + file/page, and each comment verbatim (mark resolved ones).
- For each comment, the concrete change: which field moves (copy slot, design, composition) and what
  it becomes. Tie it to the record, never to the rendered pixels.
- When a comment is **vague or open-ended** (e.g. "make it pop"), don't guess — offer **3
  differentiated options** for that fix, per the house style.

Then stop and let the user lock the changes. Do not regenerate until they approve.

## 4. On approval — hand to write-prompt

Apply the locked fixes by the **write-prompt** rule: *fixes = rewrite the prompt from scratch, never
amend*. Update the ad's record fields, rebuild `generation.prompt` fresh so the fix is encoded without
contradicting anything else, then regenerate (`generate-image.mjs --record`) and re-index
(`record-ad.mjs --index`). Resync only what changed (**sync-to-drive** / **sync-to-notion**).

If any comment carried a **durable lesson** (a rule for future ads, not just this fix), hand it to
**capture-feedback** to fold into the brand's `inputs/feedback.md`.
