---
name: write-prompt
description: Write the image-generation prompt and run the generator. Use as the final step of making an image ad — turn a locked concept (product, persona, angle, format, copy, design) into a structured prompt, then call tools/generate-image.mjs. Covers the prompt structure, product-reference rule, photography defaults, the output filename convention, which video model runs where, and how any model reads a prompt (with the troubleshooting method every generation uses).
---

# Write prompt

Turn the locked concept into one structured prompt, then generate. Keep prompts under **200 words**. Be exact, never ambiguous: decide everything (no "water or can" — you choose). Format the prompt so it is easy to read.

## Core rules

- **Scene effects wrap around the reference, never onto it.** Lighting, glow, rim-light, shadows, and reflections are scene-level effects applied *around* the product — never let them touch or restyle the product's own printed surface. Measured failure: a can's real printed signature (a small cursive name near the top of the label) got silently replaced with generic "ZERO SUGAR" text on a dramatically-lit render, even with a standard "place as-is" instruction — the model harmonized the product's own content with the surrounding effect instead of leaving it untouched. State it explicitly whenever a render adds atmosphere/lighting near the product: *"nothing printed on the product — no text, no graphic, no signature — may be altered, replaced, or redrawn to match the lighting; the product's surface is pixel-identical to its reference, only the light falling on it and the space around it changes."*
- **Do not describe how the product looks — anywhere in the prompt.** No size, shape, proportions, or aspect ratio; no label colors, artwork, typography, or flavor-color descriptions. The reference image already carries all of that; describing invites the model to redraw (renders have drawn inaccurate can labels from a stray color mention). The product appears only by reference: name it, point to the image, add the negative rule. Example: *"The Acme serum bottle. Use the referenced product image(s). Do not regenerate, redraw, or modify the product or its packaging text — place it as-is."* Scene, layout, and overlay text may be described freely — only the product itself is off-limits. If a layout needs per-flavor positioning (e.g. "one can under each tab"), name the flavor, never its look.
- **A product whose label must read goes first in the references and fills about a third of the
  frame height.** Small, or listed after the people, it gets its label redrawn; keep fingers off
  the label. In a stylized world (stop-motion, 3D), the real product photo still sets the label: ask
  only for the scene's light and material on it. A generated, restyled product sheet drops the small
  print and misprints it, so it is never a reference: the video workflows crop the real product from
  a store photo into the ad's `sheets/product.png` and never generate it.
- **A product held in a hand needs an in-hand reference.** The packshot alone gets the scale wrong. Whenever a person holds the product, add a photo of it held in a hand as an extra ref (**search-media**) and tell the model to match that product-to-hand size.
- **Multi-unit rows: check the geometry — zone-filling beats true proportions.** Scrubbing size language isn't enough on its own: when a layout puts N product refs in a row, N × (true product width at the intended row height) must fit the canvas width with margins, or the model reconciles by silently stretching the products (measured: 8 cans in a full-height row came out uniformly 23% slimmer than the refs). Write the layout so the product's height *follows* its true proportions — e.g. *"the row spans the canvas with small gaps; can height follows true proportions, leaving open background above inside the zone"* — and declare the empty space intentional: *"do not scale the product to fill the zone."*
- **A single pre-composited reference image still needs an exact, paired pixel size — not a width-only target or a bounding area.** Even one locked reference asset (e.g. a multi-product lineup already flattened into one image) gets distorted if the prompt gives only a width (*"up to 88% of canvas width"*) or an area (*"left 5-65% width"*) and leaves height to "follow the proportions" as an abstract instruction — the model blends the width cue with the zone's height instead of doing the ratio math itself (measured: repeated 24-35% distortion even with an explicit ratio statement, across multiple ads, using the same correctly-built reference). Compute the exact width AND height yourself from the reference's own ratio (e.g. a 3.63:1 reference in a 1002px-wide slot renders at 1002×276px) and state both numbers as one fixed, non-negotiable pair: *"renders at exactly 1002px wide by 276px tall — not a suggestion or an upper bound."* Pair it with explicit permission for the leftover space: *"there will be visible empty background around it since this is smaller than the zone — that is correct and expected, do not enlarge it to fill more."* Also drop any "hero / most saturated / prominent" framing on the product — it has nothing to do with size, but may itself nudge the model toward oversizing to "earn" the description.
- **Each generation is stateless — write the prompt as a direct description of the final image, never as an edit of a previous attempt.** The model has no memory of what it produced before, so drop acknowledgements and "don't do this / don't do that" amend caveats that only make sense relative to a prior output. Describe the ad you want; put hard requirements (element counts, "natural undistorted proportions", single image) in the **Constraints** section. When fixing an ad, rebuild the whole prompt fresh rather than patching the old one — and never add product-appearance or dimension language to force a fix, it backfires and the model redraws the product.
- **Revisions regenerate — never edit a previous render.** To revise any output (an ad, a frame, a clip: "make the pimples more noticeable", "fix where the text sits", a new aspect ratio), take the prompt that made it (an ad's is in its record), fold the requested change into it, and run a fresh generation with the original refs. Never run an image-to-image edit pass on a prior render to apply a revision, and don't ask edit-vs-regenerate — regeneration from the updated base prompt is the only path. Edit passes compound artifacts and drift from the source refs; the record's prompt stays the single source of truth for what the ad is. (Image edits are still fine for their creation-time job, placing or adjusting base photos before generation, or when the user asks for an edit.) The same compounding applies to references: when recasting real footage (a winning ad's frames as bases for new people or rooms), the base is always **the original source frame**, with a short prompt that names only the change. To keep the same person across shots, add one more reference: a **face-only crop** of the approved character (head and hair, cropped from her approved frame), and say "use image 2 only for her face and hair, nothing else". Never feed a whole generated frame back in as a reference: it hands over its texture too, so each pass gets crisper and breaks the phone-video detail until it reads fake.
- For portrait feed compositions, position elements with **design-ad**'s five horizontal bands rather than percentages. For other layouts, use clear anchor points.
- **Defaults for image ads:** 1 generation, GPT Image 2.5 Flare (its fast variant), 4:5, 1K tier, medium quality. Use the model's native output; never resize or upscale it.
- **References:** Segmind receives temporary signed R2 URLs for the original brand assets; kie gets them uploaded; the Gateway receives them inline (downscaled to a 2048px long edge). The URL expires; the source object stays in the brand's R2 master. There is no Segmind upload step and nothing permanent to delete. Pass an existing HTTPS URL directly when the reference is not a cataloged brand asset.

## How a model reads a prompt (every generator: image, video, voice)

These hold for every generation in the harness; the workflows apply them to their own prompts.

- **Every word is an instruction, and the model may take it literally.** A word with a second meaning
  can turn into that meaning: a color that is also an object ("marigold dress") grew a flower, a
  motion verb that implies a speed ("float") played as slow motion. Use words with one meaning, and
  state speed, size and timing outright instead of implying them.
- **Traits leak.** The model fills in whatever the prompt leaves open from everything else it sees: a
  name, a face, a loanword, a setting. An American character with an Indian name, a South Asian face
  and "jhumka earrings" spoke with an Indian accent. State every trait that matters (accent, age,
  tone, speed) first and outright, and describe the rest in plain, neutral words. Leave out what the
  model doesn't need, such as a character's name nobody says in the shot. Describe an accent by its
  concrete features (American: hard r's, flapped t's), not by traits other accents share ("crisp,
  precise consonants" kept the Indian accent coming back).
- **The reference image is an instruction too.** Its pose, expression and composition decide what
  happens first: the person who looks mid-speech gets the first line, a figure caught mid-air keeps
  floating. Make the starting image set up the action you want.
- **Name each subject one way, everywhere.** With several people or objects in a shot, identify each
  by position and look, the same words every time they come up. A label must fit only its subject:
  calling an off-screen speaker "GREEN" while a dancer in green is in frame points at the dancer, and
  "silver-haired" stops working once a second gray-haired woman joins the shot.
- **Name each reference by number and say who is in frame.** "Linda from reference image 1, the
  reception from reference image 2." List exactly who is in the shot; otherwise the model fills it
  with people from the sheets.
- **No mirrors.** The model duplicates people and the reflection doesn't match.
- **Keep bodies neutral for content filters.** Filters read anatomy and pose words: "from the chest
  up" and "leaning far forward, elbows on her knees" on women in low-cut dresses got frames blocked.
  Frame by waist, shoulders or collarbones, and use neutral poses ("sitting on the edge of the seat").
- **One main motion per moment.** Movements stacked at once (a camera orbit around a spin) blur
  together and slow down; give one main motion and its tempo.
- **Animate from the frame, not against it.** A clip's action works with what its start frame
  already shows: things where they already are, people already in it. Asking for something the
  frame contradicts (jars standing in a row, prompted to slide over one at a time) or lacks (a
  friend handing over a cup in a frame she isn't in) breaks the physics. Keep each motion
  simple and physically easy (point, pick up, lift, turn, light up), but keep plenty of it: one
  clear beat after another, each on its word, so the shot stays busy without asking for hard physics.

**Pass references as a bash array** (`R=(); R+=(--ref a.png)`, then `"${R[@]}"`): in zsh a quoted
"--ref a --ref b" string silently sends none.

**When an output surprises you,** the cause is in the prompt, the references or the parameters: the
model was told something vague or confusing. Reread all three, find what could explain the result,
rewrite it, and regenerate only that item. Never patch with a negative ("no yellow flower"): naming
the thing plants it. Then fold the cause into this section as a general rule, so it doesn't recur.

## Photography direction (when photography is needed)

Default to a realistic photo that looks shot on an iPhone, handheld, casual composition — like a real person caught the moment, not a styled brand shot. Imperfect and grainy. No glare. No extreme softness, especially on skin. No specular polish on any surface. Shadows are noisy, not clean. Always write the exact phrase **"amateur, user generated iPhone photo"** (for video, **"amateur, user generated iPhone video"**) in any image or video prompt meant to read as real (UGC scenes, start frames, backgrounds behind faux UI, lifestyle shots) unless the user asks otherwise — without it the render drifts toward a styled stock look.

## Prompt structure (image ads)

Write these sections in order:

1. **Task** — "Create [1/2/3] [1K/2K/4K], [aspect ratio] static image ad(s)"
2. **Composition** — layers and their positions (with %), background, layout
3. **Text** — the copy, with case; end this section with a short note that typography references follow
4. **Design** — per text type: font, color, alignment, and any legibility treatment (weight, background, shadow, stroke, gradient)
5. **Photography direction** — only if applicable (see above)
6. **Constraints** — single image, no logos, no URLs
7. **`File name:`** — always last, exactly once (see below)

## Filename convention (canonical — every other skill points here)

Every ad gets its own folder in `outputs/` with two subfolders: `drafts/` for every render not yet
approved, `final/` for approved variations, so what's still missing shows at a glance. A render
lands in `drafts/`; on approval, move it to `final/` and update the path in the record. Other
working files (prompts, plans) sit in their own subfolders.

- **Folder:** `[ID]_[Concept]_[Format]_[Persona]_[Angle]_[Product]`
- **Approved file:** `[ID]_[Variation]_[Concept]_[Format]_[Persona]_[Angle]_[Product]` — the same
  name with the variation added. `File name:` is this.

- **ID** — next integer. **If the brand reviews on a Notion Ads Board, the board is the ID
  authority**: peek `next-id` at the start of a batch (**sync-to-notion**) and number from there.
  Otherwise scan the brand's `outputs/` for the highest leading number and add 1.
- **Variation** — `V1`, `V2`, … Files only, never folders: every variation of an ad lives in the
  ad's one folder. Every ad made in one working session shares one ID, even across concepts: each
  new concept continues the variation count (V6, V7, …), and the record's `variations` map gives each
  its own concept, copy, and prompt. The folder and file names keep the first concept's name.
- **Format** — e.g. `Static`, `UGC`, `Voiceover-Mashup`, `Voiceoverless-Mashup`, `Podcast`, `Animation`, `Slides`, `Song`.
- Underscores between parts, hyphens inside a part (`Disappearing-Woman`).

Example: folder `3_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens`, approved file
`3_V1_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens.mp4` (the render's own
extension: `.png` for an image, `.mp4` for a video).

Each ad's full source of truth — concept, copy, prompt, and the generation payload — is its record at `outputs/json/[ID].json` (same ID; schema in `tools/record-ad.mjs`).

## Generate

Delegation and how to run long renders follow AGENTS.md (operating principles).

1. **Write the record** `outputs/json/[ID].json` (concept · copy · design · the prompt · the params).
2. **Generate.** Pass the prompt (write it to a throwaway temp file to avoid shell-escaping), the
   refs — product/scene photos found with **search-media** plus the brand **type sheet**
   (`inputs/media/brand/type_sheet.png`, FONT reference only — see **pull-fonts**) — and any
   non-default params:
   ```bash
   node tools/generate-image.mjs --prompt-file /tmp/<id>_prompt.txt --timeout 600 \
     --ref "workspaces/<WS>/Acme/inputs/media/00042_bottle.png" \
     --ref "workspaces/<WS>/Acme/inputs/media/brand/type_sheet.png" \
     --out "workspaces/<WS>/Acme/outputs/3_Calm-Mornings_Static_Sarah_Stress-Relief_Acme/3_V1_Calm-Mornings_Static_Sarah_Stress-Relief_Acme.png"
   ```
3. **When it lands**, set `generation.output` to the saved path (the printed `Saved:` line) and remove
   the temp prompt file. Index refresh and R2 push: AGENTS.md (operating principles).

To **re-generate** from an existing record, `generate-image.mjs --record <record.json>` reads the
prompt/refs/params and stamps the result back — no temp file needed.

Options: `--provider auto|segmind|kie|gateway` (default `auto`), `--model gpt-image-2.5` (default; `gpt-image-2` and `nano-banana-pro` secondary), `--aspect`, `--resolution`, `--quality`, `--num`, `--format`. Run `node tools/generate-image.mjs --help` for all flags. The saved path(s) print on success. Output is always the model's native dimensions for the requested aspect/resolution — there is no force-resize or upscale path.

Use **GPT Image 2.5** by default, always. **Only switch models (`--model gpt-image-2`, `--model nano-banana-pro`) when the user explicitly asks — never on your own** — even when GPT Image 2.5 mangles something (flag the problem and keep generating on GPT Image 2.5). The record's `generation.output` must match the `File name:` line in the prompt.

**Provider failover is automatic** (order and rules: AGENTS.md), always with the same prompt,
references, aspect, and resolution; a provider that can't take the request is skipped (kie's GPT
Image 2.5 has no 4:5 or 5:4). Stop and ask the user if every configured provider fails. Never switch
models, change aspect, lower quality, resize, or upscale on your own.

## Video models

`tools/generate-video.mjs` (limits per model in its `--help`), on the same auto routing:

- **MiniMax H3 Max** (the default): 5–15 s clips, 480p drafts and a 768p master, with
  sound; `--no-audio` asks for silence. With
  `--image` references only Segmind runs H3 Max (local refs are presigned from the workspace's R2).
  kie carries only base MiniMax H3 (Hailuo 03): it renders 768p whatever you ask, and the tool warns when it falls back there. The Gateway takes no references (first
  and last frame only).
- **Seedance 2.5:** up to 30 s and 30 reference images; generates voices and sound
  (`--generate-audio`). Masters reach 720p, or 1080p on the Gateway. **Seedance 2** and **2 Mini** cap
  at 15 s.
