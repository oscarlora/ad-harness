---
name: plan-batch
description: Plan a batch of ads before making them — for when the user wants more than one. Turns an end goal (e.g. "50 images, 5 personas × 10, no repeated formats or angles") into a stored, resumable plan, and tracks progress as ads get made. Use when the user asks for multiple ads; skip it for a single ad and go straight into the workflow.
---

# Plan batch

When the user wants **more than one** ad, plan the batch before making any. A single ad skips this —
go straight into the workflow. The plan is stored so it survives across sessions.

## Plan file

`workspaces/<Workspace>/<Brand>/outputs/batches/[name].json`:

```json
{
  "name": "acme-50",
  "goal": 50,
  "constraints": { "noRepeatFormat": true, "noRepeatAngle": true },
  "split": [ { "persona": "...", "count": 10 } ],
  "made": [],
  "remaining": 50
}
```

## How

1. **Settle the goal and split** with the user — the total, how to divide it (personas × count,
   products, angles), and the constraints (no repeated formats/angles, etc.). Offer 3 differentiated
   structures.
2. **Write the plan** to `outputs/batches/[name].json`.
3. **Build against it** — the ad's workflow (**make-image-ad**, **make-ai-podcast**, **make-ai-song**,
   **make-ai-animation** or **make-ai-slides**) makes each ad from the next open slot, writes its record, then appends the id to `made` and decrements `remaining`. Honor the
   constraints (skip already-used formats/angles, read from the records / `outputs/index.md`).
4. **Resume any time** — re-open the plan, see what's left and what's off-limits, continue.

While building, keep the **studio** board open so the user reviews ads as they land (it updates
live) and calls approvals/revisions from there. Delegation: AGENTS.md (operating principles).
