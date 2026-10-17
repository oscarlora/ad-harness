---
name: pull-comments
description: Pull review comments (a client's or a teammate's) on a batch of ads — from Google Drive or the Notion Ads Board — and turn them into a per-ad revision plan. Use when someone has reviewed ads and left comments, and you want to act on them. Pulls the comments, maps each to its ad record, and proposes the fixes for approval.
---

# Pull comments

Pull reviewers' comments (on Drive files or Notion Ads Board pages) and turn them into a
**revision plan**, one entry per ad ID, for approval. It does **not** regenerate on its own.

## 1. Pull — from where they reviewed

**Drive.** Run on any upload spec for the batch (`_upload_*.json` carries the brand + `driveSubfolder`),
or point straight at a folder:

```bash
node tools/pull-comments.mjs drive workspaces/<WS>/Acme/outputs/_upload_41.json
node tools/pull-comments.mjs drive --folder <driveFolderId> <any-spec-under-the-brand>.json
```

Writes `outputs/comments.json`. Resolved comments are flagged, not dropped. A comment with a box drawn
on the image carries a `region` (fractions of width/height plus a label like `bottom-center`) — use
it to pin which element the comment means.

**Notion.** Resolve the board by brand, optionally filtering by status:

```bash
node tools/pull-comments.mjs notion <WS> "Acme" --status "Revision Needed" --status "Pending Client Review"
```

Writes `outputs/notion-comments.json`, threads grouped per page. Needs the integration's **"Read
comments"** capability (Notion → integration settings → Capabilities).

Each run prints a summary, so you needn't open the file.

## 2. Map each comment to its ad

The ad **ID** is the leading number in the Drive filename (`41_V2_...png` → ad `41`, variation `V2`)
or the Notion page's ID property. Open its record: its fields and `generation.prompt` are the source
of truth (**write-prompt**).

## 3. Propose the plan

One block per ad **in the chat**:

- The ad ID + file/page, and each comment verbatim (mark resolved ones).
- For each comment, the concrete change: what changes in the prompt (a line of text, the layout, the composition)
  and what it becomes — never the rendered pixels.
- For a **vague** comment ("make it pop"), offer options instead of guessing.

Then stop. Do not regenerate until the user approves.

## 4. On approval — hand to write-prompt

Fixes rewrite the prompt from scratch, never amend (**write-prompt**). Update the record's fields,
rebuild `generation.prompt` fresh and regenerate (`generate-image.mjs --record`). Re-upload only what
changed (**upload-ads**).

Hand any **durable lesson** (a rule for future ads) to **save-brand-memory**.
