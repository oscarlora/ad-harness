---
name: plan-batch
description: Plan a batch of ads before making them — for when the user wants more than one. Turns an end goal (e.g. "50 images, 5 personas × 10, no repeated formats or angles") into a stored, resumable plan, and tracks progress as ads get made. Use when the user asks for multiple ads; skip it for a single ad and go straight into the workflow.
---

# Plan batch

For **more than one** ad, plan the batch before making any. The plan survives across sessions.

## Plan file

`workspaces/<Workspace>/<Brand>/outputs/batches/[name].json`:

```json
{
  "name": "acme-50",
  "product": "Acme Bowl",
  "constraints": { "noRepeatFormat": true, "noRepeatAngle": true },
  "slots": [ { "id": 31, "persona": "...", "angle": "...", "format": "..." } ]
}
```

One slot per ad, each with the ID it reserves.

## How

1. **Settle the goal and split** with the user — the total, how to divide it (personas × count,
   products, angles), and the constraints; options differ in structure.
2. **Write the plan** to `outputs/batches/[name].json`, numbering the slots on from the next free ID
   (**write-prompt**, Filename convention).
3. **Build against it** — the ad's workflow makes each ad from the next open slot (no record yet),
   under the slot's ID. Honor the constraints (check the records / `outputs/index.md`).
4. **Resume any time** — re-open the plan and continue.
