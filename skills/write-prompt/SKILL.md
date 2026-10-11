---
name: write-prompt
description: Write the image-generation prompt and run the generator. Use as the final step of making an image ad — turn the locked concept into a structured prompt, then call tools/generate-image.mjs. Also owns the product-reference rules, photography defaults, the output filename convention, the video models, and how any model reads a prompt (with the troubleshooting every generation uses).
---

# Write prompt

Turn the locked concept into one structured, easy-to-read prompt, then generate. Under **200 words**. Decide everything; never leave a choice to the model (no "water or can").

## Core rules

- **Scene effects wrap around the product, never onto it.** Whenever a render adds lighting or atmosphere near the product, state: *"nothing printed on the product — no text, no graphic, no signature — may be altered, replaced, or redrawn to match the lighting; the product's surface is pixel-identical to its reference, only the light falling on it and the space around it changes."*
- **Never describe how the product looks**, anywhere in the prompt: no size, shape, proportions, label colors, artwork or typography; describing invites a redraw. Name it, point to the image, add the negative rule: *"The Acme serum bottle. Use the referenced product image(s). Do not regenerate, redraw, or modify the product or its packaging text — place it as-is."* Scene, layout and overlay text are free to describe. For per-flavor positions, name the flavor, never its look.
- **A product whose label must read goes first in the references and fills about a third of the
  frame height**; small, or listed after the people, it gets its label redrawn. Keep fingers off
  the label. In a stylized world (stop-motion, 3D), the real product photo still sets the label: ask
  only for the scene's light and material on it. A generated product sheet is never a reference: the
  video workflows crop the real product from a store photo into the ad's `sheets/product.png`.
- **A product held in a hand needs an in-hand reference.** Add a photo of it held in a hand (**search-media**) and tell the model to match that product-to-hand size; the packshot alone gets the scale wrong.
- **Multi-unit rows: zone-filling beats true proportions.** N products in a row must fit the canvas width at true proportions, or the model stretches them. Let height follow proportions and declare the empty space intentional: *"the row spans the canvas with small gaps; can height follows true proportions, leaving open background above inside the zone; do not scale the product to fill the zone."*
- **A single pre-composited reference needs an exact width-and-height pair**, never a width-only target or a zone. Compute both from the reference's ratio (3.63:1 in a 1002px slot = 1002×276px) and state them as fixed: *"renders at exactly 1002px wide by 276px tall — not a suggestion or an upper bound. There will be visible empty background around it since this is smaller than the zone — that is correct and expected, do not enlarge it to fill more."* Drop any "hero / prominent" framing on the product; it nudges oversizing.
- **Each generation is stateless.** Describe the final image, never an edit of a previous attempt (no "don't do X" caveats about a prior output). Hard requirements (element counts, "natural undistorted proportions", single image) go in **Constraints**. To fix an ad, rebuild the whole prompt fresh; never add product-appearance or dimension language to force a fix.
- **Revisions regenerate — never edit a previous render.** For any revision (ad, frame, clip), fold the change into the prompt that made it (an ad's is in its record) and generate fresh with the original refs. No image-to-image edit pass on a prior render, and don't ask edit-vs-regenerate (image edits stay fine for preparing base photos, or when the user asks). When recasting real footage, the base is always **the original source frame**, with a short prompt naming only the change. To keep a person across shots, add a **face-only crop** (head and hair) from her approved frame and say "use image 2 only for her face and hair, nothing else". Never feed a whole generated frame back as a reference: each pass gets crisper until it reads fake.
- For portrait feed compositions, position elements with **design-ad**'s five horizontal bands, not percentages. For other layouts, use clear anchor points.
- **Defaults for image ads:** 1 generation, GPT Image 2.5 Flare (its fast variant), 4:5, 1K tier, medium quality. Use the model's native output; never resize or upscale it.
- **References:** the tool hosts local files itself (signed R2 URLs, or kie's file hosting without R2); there is nothing to upload or delete. Pass an existing HTTPS URL directly when the reference isn't a cataloged brand asset.

## How a model reads a prompt (every generator: image, video, voice)

- **Every word is an instruction, and the model may take it literally.** A word with a second meaning
  can turn into it: "marigold dress" grew a flower. Use words with one meaning, and state speed,
  size and timing outright instead of implying them.
- **Traits leak.** The model fills whatever the prompt leaves open from everything else it sees (an
  American character with an Indian name and "jhumka earrings" spoke with an Indian accent). State every trait that matters (accent, age, tone, speed)
  first and outright, describe the rest in plain, neutral words, and leave out what the model
  doesn't need, such as a name nobody says in the shot. Describe an accent by its concrete features
  (American: hard r's, flapped t's), not by traits other accents share.
- **The reference image is an instruction too.** Its pose, expression and composition decide what
  happens first: the person who looks mid-speech gets the first line. Make the starting image set
  up the action you want.
- **Name each subject one way, everywhere.** With several people or objects in a shot, identify each
  by position and look, in the same words every time. A label must fit only its subject: calling an
  off-screen speaker "GREEN" while a dancer in green is in frame points at the dancer.
- **Name each reference by number and say who is in frame.** "Linda from reference image 1, the
  reception from reference image 2." List exactly who is in the shot; otherwise the model fills it
  with people from the sheets.
- **No mirrors.** The model duplicates people and the reflection doesn't match.
- **Keep bodies neutral for content filters.** Anatomy and pose words ("from the chest up", "leaning
  far forward") get frames blocked. Frame by waist, shoulders or collarbones, and use neutral poses
  ("sitting on the edge of the seat").
- **One main motion per moment.** Stacked movements (a camera orbit around a spin) blur together and
  slow down; give one main motion and its tempo.
- **Animate from the frame, not against it.** A clip's action works with what its start frame
  already shows. Asking for something the frame contradicts (jars standing in a row, prompted to
  slide over one at a time) or lacks (a friend handing over a cup in a frame she isn't in) breaks
  the physics. Keep each motion simple (point, pick up, lift, turn, light up), but keep plenty of
  it: one clear beat after another, each on its word.

**Pass references as a bash array** (`R=(); R+=(--ref a.png)`, then `"${R[@]}"`): in zsh a quoted
"--ref a --ref b" string silently sends none.

**When an output surprises you,** the cause is in the prompt, the references or the parameters.
Find what could explain the result, rewrite it, and regenerate only that item.
Never patch with a negative ("no yellow flower"): naming the thing plants it. Then fold the cause
into this section as a general rule.

## Photography direction (when photography is needed)

Default to a realistic, handheld, casually composed iPhone photo, not a styled brand shot: imperfect and grainy, noisy shadows, no glare, no extreme softness on skin, no specular polish. Always write the exact phrase **"amateur, user generated iPhone photo"** (for video, **"amateur, user generated iPhone video"**) in any prompt meant to read as real (UGC scenes, start frames, backgrounds behind faux UI, lifestyle shots) unless the user asks otherwise.

## Prompt structure (image ads)

Write these sections in order:

1. **Task** — "Create [1/2/3] [1K/2K/4K], [aspect ratio] static image ad(s)"
2. **Composition** — layers and their positions (bands or anchor points, as above), background, layout
3. **Text** — the copy, with case; end with a short note that typography references follow
4. **Design** — per text type: font, color, alignment, and any legibility treatment (weight, background, shadow, stroke, gradient)
5. **Photography direction** — only if applicable (see above)
6. **Constraints** — single image, no logos, no URLs
7. **`File name:`** — always last, exactly once (see below)

## Filename convention (canonical — every other skill points here)

Every ad gets its own folder in `outputs/`. A render lands in `drafts/`; on approval, move it to
`final/` and update the path in the record. Other working files (prompts, plans) get their own subfolders.

- **Folder:** `[ID]_[Concept]_[Format]_[Persona]_[Angle]_[Product]`
- **Approved file:** `[ID]_[Variation]_[Concept]_[Format]_[Persona]_[Angle]_[Product]` — the same
  name with the variation added. `File name:` is this.

- **ID** — next integer. **If the brand reviews on a Notion Ads Board, the board is the ID
  authority**: peek `next-id` at the start of a batch (**upload-ads**) and number from there.
  Otherwise scan the brand's `outputs/` for the highest leading number and add 1.
- **Variation** — `V1`, `V2`, … Files only, never folders. Every ad made in one working session
  shares one ID, even across concepts: each new concept continues the variation count (V6, V7, …),
  and the record's `variations` map gives each its own concept, copy and prompt. Folder and file
  names keep the first concept's name.
- **Format** — e.g. `Static`, `UGC`, `Voiceover-Mashup`, `Voiceoverless-Mashup`, `Podcast`, `Animation`, `Slides`, `Song`.
- Underscores between parts, hyphens inside a part (`Disappearing-Woman`).

Example: folder `3_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens`, approved file
`3_V1_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens.mp4` (the render's own
extension: `.png` for an image, `.mp4` for a video).

Each ad's source of truth (concept, copy, prompt, generation payload) is its record at `outputs/json/[ID].json` (schema in `tools/record-ad.mjs`).

## Generate

Delegation and long renders: AGENTS.md (operating principles).

1. **Write the record** `outputs/json/[ID].json` (concept · copy · design · the prompt · the params).
2. **Generate.** Pass the prompt (in a throwaway temp file, to avoid shell-escaping), the refs —
   product/scene photos found with **search-media** plus the brand **type sheet**
   (`inputs/media/brand/type_sheet.png`, FONT reference only — see **pull-fonts**) — and any
   non-default params:
   ```bash
   node tools/generate-image.mjs --prompt-file /tmp/<id>_prompt.txt --timeout 600 \
     --ref "workspaces/<WS>/Acme/inputs/media/00042_bottle.png" \
     --ref "workspaces/<WS>/Acme/inputs/media/brand/type_sheet.png" \
     --out "workspaces/<WS>/Acme/outputs/3_Calm-Mornings_Static_Sarah_Stress-Relief_Acme/3_V1_Calm-Mornings_Static_Sarah_Stress-Relief_Acme.png"
   ```
3. **When it lands**, set `generation.output` to the printed `Saved:` path (it must match the
   prompt's `File name:` line) and remove the temp prompt file. Index refresh and R2 push: AGENTS.md.

To **re-generate** from an existing record, `generate-image.mjs --record <record.json>` reads the
prompt, refs and params and stamps the result back.

Options: `--provider auto|segmind|kie|gateway` (default `auto`), `--model gpt-image-2.5` (default; `gpt-image-2` and `nano-banana-pro` secondary), `--aspect`, `--resolution`, `--quality`, `--num`, `--format`; all flags in `--help`.

Always **GPT Image 2.5**; switch models only when the user explicitly asks, even when it mangles
something (flag it). Provider failover is automatic (AGENTS.md); a provider that can't take the
request is skipped (kie's GPT Image 2.5 has no 4:5 or 5:4). If every provider fails, stop and ask.
Never change aspect, lower quality, resize or upscale on your own.

## Video models

`tools/generate-video.mjs` (limits per model in its `--help`), on the same auto routing:

- **MiniMax H3 Max** (the default): 5–15 s clips, 480p drafts and a 768p master, with sound;
  `--no-audio` asks for silence. With `--image` references only Segmind runs H3 Max. kie carries only base MiniMax H3 (Hailuo 03), which renders
  768p whatever you ask; the tool warns when it falls back there. The Gateway takes no references
  (first and last frame only).
- **Seedance 2.5:** up to 30 s and 30 reference images; generates voices and sound
  (`--generate-audio`). Masters reach 720p, or 1080p on the Gateway. **Seedance 2** and **2 Mini** cap
  at 15 s.
