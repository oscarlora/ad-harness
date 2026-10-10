---
name: make-image-ad
description: The end-to-end image ad workflow — run this to make an image ad from scratch. An interview: at each step propose 3 differentiated options, lock one, and append it to a growing parameter table, then assemble the prompt and generate. Use when the user asks to make or start an image ad.
---

# Make image ad

Make one image ad as an **interview**: each step ideates one variable, you propose **3 deliberately
differentiated options**, the user locks one, and it appends to a growing **parameter table**. Skip
any step the starting point already locked. Show only the artifact. Each step's detail lives in its
own skill.

The parameter table builds across the run. The **format decides the text slots** — `hook` is always
present, and **every other text element the format places gets its own identifiably-named column**
(by position or number) so you can see exactly which copy goes where.

Example — format = hook on top, two sublines, three tertiary pills bottom-right:

| product | persona | angle | format | hook | subline-top | subline-bottom | pill-1 | pill-2 | pill-3 |

During the interview this table lives in the **conversation only** — nothing is written to disk, so the brainstorming stays fast. It becomes the ad's record (`outputs/json/[id].json`) at generation, not before.

## Before starting

If the brand's files aren't present locally, pull them from R2 first (`tools/sync-brand.mjs`; operating
principles). Load the product's `-research.md`, `-personas.md`, `-angles.md`, the brand's
`inputs/feedback.md` (standing client guidance — see **capture-feedback**), and the relevant skills.
If research is missing or thin, run **research-brand** first. **Never repeat** a persona/angle/format already in the
brand's ads (check `outputs/index.md` or the records) unless asked.

If the user wants **more than one** ad, plan the set first with **plan-batch**, then run this
workflow once per ad — take the next open slot from the plan, and add the id to the plan's `made`
after generating. A single ad skips planning and goes straight to the steps below.

## Starting point

Pick how to begin; it sets the order of the concept steps:

- **Angle first** — angle, then format.
- **Format first** — format, then angle.
- **Reference photo first** — a library photo found with **search-media** → photo-centric.
- **Reference ad first** — replicate an ad's format; the reference decides photo- vs graphic-centric.

## Steps

The **concept** is product + persona + angle + format. Then copy, then design.

1. **Product** — ask which **product** of the brand the ad is for, by name (offer the brand's products as the options if there are several). Call it the "product," not the "subject."
2. **Persona** — pick or ideate one (**ideate-personas**).
3. **Angle** — pick or ideate one (**ideate-angles**).
4. **Format** — image type + layer layout (**ideate-image-format**).
5. **Copy** — hook, subline (if the format uses one), tertiary (if it uses it); 3 options each (**write-copy**).
6. **Design** — the treatment through a designer's lens (**design-ad**).
7. **Prompt** — compose the structured prompt in the chat, not in a file (**write-prompt**).
8. **Show, then generate** — show the full ad as a **table in the chat**: every parameter the JSON will hold, **including the prompt** — write nothing to disk yet. Then write the record `outputs/json/[id].json`, update the batch plan, and render (**write-prompt**). Report the output as it lands. Delegation, index refresh and R2 push: AGENTS.md (operating principles).
9. **Approve** — when the user approves, set the record's `status` to `approved`, move the file from
   the ad's `drafts/` to `final/` (**write-prompt**, filename convention), then refresh the
   index (`node tools/record-ad.mjs --index <brand outputs/ dir>`): the refresh strips embedded
   metadata (C2PA, EXIF, XMP) from every approved image, so nothing leaves the machine tagged.
10. **Story version** — every static is made 4:5 first; once a 4:5 is approved, make its 9:16 Story
    version by AI extension, never a new layout: `node tools/extend-to-story.mjs --in <approved 4:5>
    --out <drafts/…> --above "<what continues above>" --below "<what continues below>"`. It centers the
    ad on a 9:16 canvas and has the model fill only the bars; use its output as-is (no pasting the
    original back). Show it, and on approval it goes to `final/` like the 4:5.
