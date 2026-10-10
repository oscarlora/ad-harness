---
name: capture-feedback
description: Consolidate durable client guidance from any source — Drive/Notion comments, a shared document, or notes pasted in chat — into the brand's inputs/feedback.md ledger. Use whenever the client gives direction that should shape future ads, not just fix one. Distills the lesson, dedupes it against research.md and the existing ledger, and appends it.
---

# Capture feedback

Client feedback arrives from many channels — comments on Drive or the Notion Ads Board, a document
the user shares, or notes pasted straight into chat. This is the single funnel that turns the
**durable** part of any of them into standing brand guidance, kept in the brand's
`inputs/feedback.md` ledger so every future ad inherits it.

## Durable guidance vs. a one-off fix

Only **durable, generalizable** lessons belong here. Sort first:

- **Durable** ("never call the greens powder a meal replacement", "testimonials must be real verified quotes",
  "show the actual product, not a stand-in") → the ledger. It will shape every future ad.
- **One-off** ("move 20.2's subline", "remove the bacteria image on this cut") → stays in that ad's
  **revision plan** (see **pull-comments**). It is consumed once and does not generalize.

When a single comment carries both (a specific fix *and* the rule behind it), apply the fix via the
revision plan and capture only the rule here.

## 1. Gather the source

Take the feedback in whatever form it came:

- **Comments** — already harvested by **pull-comments** (Drive or Notion). Read its output.
- **A document** — read the file the user points to.
- **Chat notes** — the user pasted the direction inline; use it directly.

## 2. Distill, then dedupe

Turn each durable point into one **imperative rule** with its reason. Then check it against the
brand's existing truth before writing — the goal is a small ledger free of redundancy:

- **Already in `research.md`?** Don't copy it. research.md is the canonical brand doc; the ledger
  only holds guidance it doesn't yet cover. (Much feedback restates what's already there — e.g. for
  Acme, "no seed oils" and "steady energy, not a sugar rush" are already canonical.)
- **Already in `feedback.md`?** Sharpen or correct the existing line; never stack a duplicate.
- **Conflict** with either? Surface it to the user rather than silently overriding.

## 3. Append to the ledger

Write to `workspaces/<Workspace>/<Brand>/inputs/feedback.md`, grouped by theme (Messaging, Voice,
Visuals, …). Each entry is one line:

```
- <imperative rule> — <why>. — <source>, <YYYY-MM-DD>
```

Scope it to the product or persona in parentheses if it isn't brand-wide. Keep it tight; this file is
loaded at the start of every ad, so every line must earn its place.

## 4. Promote when it stabilizes

The ledger is the inbox; `research.md` is the canonical doc. When a rule has held across several ads
and is plainly brand law, **move it into `research.md`** (the right section — claim rules, voice,
photography) and delete it from `feedback.md`. This keeps the ledger short and the two from drifting.

## Loaded automatically

Every ad workflow (**make-image-ad**, **make-ai-podcast**, **make-ai-song**, **make-ai-animation**,
**make-ai-slides**) reads `feedback.md` alongside `research.md` before any ad. You
don't need to load it by hand during a workflow — only when capturing new feedback into it.
