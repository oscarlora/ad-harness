---
name: make-image-ad
description: The end-to-end image ad workflow — run this to make an image ad from scratch. An interview: at each step propose 3 differentiated options, lock one, and append it to a growing parameter table, then assemble the prompt and generate. Use when the user asks to make or start an image ad.
---

# Make image ad

Make one image ad as an **interview**: each step ideates one variable, you propose **3 deliberately
differentiated options**, the user locks one, and it appends to a growing **parameter table**. Skip
any step the starting point already locked.

The **format decides the text slots**: `hook` is always present, and every other text element the
format places gets its own identifiably-named column. Example — hook on top, two sublines, three
pills bottom-right:

| product | persona | angle | format | hook | subline-top | subline-bottom | pill-1 | pill-2 | pill-3 |

The table lives in the **conversation only** until generation; it becomes the ad's record
(`outputs/json/[id].json`) then, not before.

## Before starting

If the workspace uses R2, pull the brand first (AGENTS.md). Load the product's `-research.md`,
`-personas.md`, `-angles.md`, the brand's `inputs/memory.md` (**save-brand-memory**), and the
relevant skills. If research is missing or thin, run **research-brand** first. **Never repeat** a
persona/angle/format already in the brand's ads (check `outputs/index.md` or the records) unless asked.

For **more than one** ad, plan the set first with **plan-batch**, then run this workflow once per ad:
take the next open slot, and add the id to the plan's `made` after generating.

## Starting point

Pick how to begin; it sets the order of the concept steps:

- **Angle first** — angle, then format.
- **Format first** — format, then angle.
- **Reference photo first** — a library photo found with **search-media** → photo-centric.
- **Reference ad first** — replicate an ad's format; the reference decides photo- vs graphic-centric.

## Steps

The **concept** is product + persona + angle + format. Then copy, then design.

1. **Product** — ask which **product** the ad is for, by name (offer the brand's products if there are several). Call it the "product," not the "subject."
2. **Persona** — pick or ideate one (**ideate-personas**).
3. **Angle** — pick or ideate one (**ideate-angles**).
4. **Format** — image type + layer layout (**ideate-image-format**).
5. **Copy** — hook, plus subline and tertiary if the format uses them; 3 options each (**write-copy**).
6. **Design** — the treatment through a designer's lens (**design-ad**).
7. **Prompt** — compose the structured prompt in the chat, not in a file (**write-prompt**).
8. **Show, then generate** — show the full ad as a **table in the chat**, every parameter the JSON will hold **including the prompt**. Then write the record `outputs/json/[id].json`, update the batch plan, and render (**write-prompt**).
9. **Approve** — set the record's `status` to `approved`, move the file from the ad's `drafts/` to
   `final/` (**write-prompt**, filename convention), then refresh the index
   (`node tools/record-ad.mjs --index <brand outputs/ dir>`), which strips embedded metadata from
   every approved image.
10. **Story version** — every static is made 4:5 first; once a 4:5 is approved, make its 9:16 Story
    version by AI extension, never a new layout: `node tools/extend-to-story.mjs --in <approved 4:5>
    --out <drafts/…> --above "<what continues above>" --below "<what continues below>"`. Use its
    output as-is (don't paste the original back). Show it; on approval it goes to `final/` like the 4:5.
