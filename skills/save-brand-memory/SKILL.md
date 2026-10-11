---
name: save-brand-memory
description: Save what the agent should remember about a brand into its inputs/memory.md, from any source — the user's own notes, a teammate, client comments, or results. Use when someone says "remember that…", "always/never do X for this brand", gives direction that should shape future ads (not just fix one), or a lesson comes out of results ("this hook keeps winning"). Distills the rule, dedupes it against research and the existing memory, and appends it.
---

# Save brand memory

Turn anything that should shape **future** ads into a standing rule in the brand's
`inputs/memory.md`. Every ad workflow loads it before starting.

## Durable rule vs. a one-off fix

- **Durable** ("never call the greens powder a meal replacement", "UGC-style hooks keep winning")
  → memory.
- **One-off** ("move 20.2's subline") → that ad's **revision plan** (**pull-comments**).

When a note carries both, apply the fix through the revision plan and save only the rule here.

## 1. Gather the source

- **Chat:** the user's or a teammate's note, used directly.
- **Comments:** **pull-comments**' output.
- **A document:** the file the user points to.
- **Results:** the user's read on what's winning or losing.

## 2. Distill, then dedupe

Turn each durable point into one **imperative rule** with its reason, then check:

- **Already in `research.md`?** Don't copy it.
- **Already in `memory.md`?** Sharpen the existing line; never stack a duplicate.
- **Conflict** with either? Ask the user rather than silently overriding.

## 3. Append

Write to `workspaces/<WS>/<Brand>/inputs/memory.md`, grouped by theme (Messaging, Voice, Visuals,
Results, …), one line each:

```
- <imperative rule> — <why>. — <source>, <YYYY-MM-DD>
```

The source is who or what it came from (`user`, a teammate's name, `client comments`, `results`).
Scope a rule to its product or persona in parentheses if it isn't brand-wide. Keep the file tight.

## 4. Promote when it stabilizes

When a rule has held across several ads and is plainly brand law, **move it into `research.md`**
(the right section) and delete it from `memory.md`.
