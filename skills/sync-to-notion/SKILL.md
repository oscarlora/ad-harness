---
name: sync-to-notion
description: Sync approved local ad creatives to the brand's Notion Ads Board (the review layer) — creates/updates one Notion page per idea with images + fields. Use when ads are approved and need to land on a brand's board. The Drive file store is sync-to-drive. We build locally in Claude Code and sync up.
---

# Sync to Notion

We build ads locally in `outputs/`; **Notion is the brand-facing review layer**. This pushes
approved creatives onto the brand's **Ads Board**: `node tools/sync-to-notion.mjs <spec.json>` — a
declarative **upsert** (matched by page Name), idempotent, safe to edit and re-run.

**Nothing is written without confirmation.** A plain run is a **dry-run plan**; you present it, the
user confirms, and only then you re-run with **`--confirm`**.

## Flow

1. **Inspect** — `--list <spec.json>` prints every board whose title *contains* the spec's `brand`
   (case-insensitive: `"acme"` finds `Acme Skincare Ads Board`) with its full property schema.
2. **Plan** — a plain run resolves the board and maps each spec field onto that board's real
   properties (by alias + actual type; a field with no match is **skipped and reported**, never
   silently dropped), then writes nothing. If the board is ambiguous it errors and lists
   candidates — pin with `board` (full title) or `boardId` in the spec; map an oddly-named
   property with `"propertyMap": { "primaryText": "Body" }`.
3. **Confirm with the user**, then re-run with **`--confirm`** — it executes and prints the page
   URL and a summary.

## Conventions (the tool enforces these)

- **One page per idea**; variations of the same idea group onto a single page.
- **Page body = only the filename heading + its image, per ad.** No intro text, no page cover.
- **Video**: clips live in Drive, not on the page (rule + why in **sync-to-drive**) — set the
  page's **Ad link/Code** to the Drive folder URL and **Media = Video**.
- **Links are real Drive URLs** (the one **sync-to-drive** prints), never a local or mapped-drive
  path. That holds for any board's folder property (e.g. "Edited Creative Folder").
- **Writing back to an existing card:** if two cards share an ID, match by name and status first —
  never write to the first query hit.
- **Naming**: the filename convention lives in **write-prompt**. The page name is the ad's folder
  name (no variation); a grouped page lists the shared Personas + Angles with `+`, e.g.
  `20_Morning-Greens_Static_Busy-Parent+Gym-Goer_Energy+Social-Proof_Greens`.
- **Status** as directed (e.g. `Pending Client Review`).
- **Headline / Primary Text** = the Meta copy, formatted per **write-meta-copy**.

## Spec

Save as `workspaces/<Workspace>/<Brand>/outputs/_sync_<id>.json` — the path selects the workspace
and its `<WS>_NOTION_TOKEN` (Notion is per-workspace and optional). Omit a field to leave it unset.

```json
{
  "brand": "Acme",
  "name": "20_Morning-Greens_Static_Busy-Parent+Gym-Goer_Energy+Social-Proof_Greens",
  "status": "Pending Client Review",
  "product": "Greens", "media": "Image", "id": "auto",
  "ratio": ["4:5"], "variations": 4,
  "headline": "Switch To Steady Energy",
  "primaryText": "Sentence one.\n\nSentence two.",
  "images": ["workspaces/<WS>/Acme/outputs/20.1_..._WELCOME20.png"]
}
```

## IDs

`"id": "auto"` takes the next number after the board's max (an explicit duplicate is refused;
updates keep the page's ID). The board is the brand's **ID authority** (rule in **write-prompt**) —
peek before naming a batch's files:

```
node tools/sync-to-notion.mjs next-id <WS> "Acme"   # prints e.g. 21
```

## After

Push the same files to the brand's Drive (**sync-to-drive**, same spec). The tool runs via **node**
(global fetch; `curl`/`python3` aren't reliable on PATH); re-running an update is safe — it rebuilds
the page body from the spec.
