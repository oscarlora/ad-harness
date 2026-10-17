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
- **Revisions regenerate — never edit a previous render.** For any revision (ad, frame, clip), fold the change into the prompt that made it (an ad's is in its record) and generate fresh with the original refs. No image-to-image edit pass on a prior render, and don't ask edit-vs-regenerate (image edits stay fine for preparing base photos, or when the user asks). When recasting real footage, the base is always **the original source frame**, with a short prompt naming only the change. To keep a person across shots, add a **face-only crop** (head and hair) from their approved frame and say "use image 2 only for the face and hair, nothing else". Never feed a whole generated frame back as a reference: each pass gets crisper until it reads fake.
- **Defaults for image ads:** 1 generation, GPT Image 2.5 Flare (its fast variant), 4:5, 1K tier. Never change aspect, resize or upscale on your own.
- **References:** the tool hosts local files itself (signed R2 URLs, or kie's file hosting without R2); there is nothing to upload or delete. Pass an existing HTTPS URL directly when the reference isn't a cataloged brand asset.

## How a model reads a prompt (every generator: image, video, voice)

- **Every word is an instruction, and the model may take it literally.** A word with a second meaning
  can turn into it: "marigold dress" grew a flower. Use words with one meaning, and state speed,
  size and timing outright instead of implying them.
- **Traits leak.** The model fills whatever the prompt leaves open from everything else it sees.
  State every trait that matters (age, tone, speed; an accent as in **generate-voice**) first and
  outright, describe the rest in plain, neutral words, and leave out what the model doesn't need,
  such as a name nobody says in the shot.
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
  slide over one at a time) or lacks (a friend handing over a cup in a frame they aren't in) breaks
  the physics. Keep each motion simple (point, pick up, lift, turn, light up), but keep plenty of
  it: one clear beat after another, each on its word.

**Pass references as a bash array** (`R=(); R+=(--ref a.png)`, then `"${R[@]}"`).

**When an output surprises you,** the cause is in the prompt, the references or the parameters.
Find what could explain the result, rewrite it, and regenerate only that item.
Never patch with a negative ("no yellow flower"): naming the thing plants it. Then fold the cause
into this section as a general rule.

## Photography direction (when photography is needed)

Default to a realistic, handheld, casually composed iPhone photo, not a styled brand shot: imperfect and grainy, noisy shadows, no glare, no extreme softness on skin, no specular polish. Always write the exact phrase **"amateur, user generated iPhone photo"** (for video, **"amateur, user generated iPhone video"**) in any prompt meant to read as real (UGC scenes, start frames, backgrounds behind faux UI, lifestyle shots) unless the user asks otherwise.

## Prompt structure (image ads)

Write these sections in order:

1. **Task** — "Create [1/2/3] [1K/2K/4K], [aspect ratio] static image ad(s)"
2. **Composition** — layers and their positions (**ideate-image-format**'s bands or anchor points, never percentages), background, layout
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
  authority**: at the start of a batch, peek with `node tools/upload-to-notion.mjs next-id <WS>
  "<Brand>"` and number from there.
  Otherwise take the highest of the brand's `outputs/` leading numbers and its batch plans' slot IDs
  (**plan-batch**), and add 1.
- **Variation** — `V1`, `V2`, … versions of the same concept. Files only, never folders. A new
  concept is a new ad with its own ID.
- **Concept** — 2–4 words naming the angle's core message (`Greens-Beat-Pills`), not a line lifted
  from the script.
- **Format** — e.g. `Static`, `UGC`, `Voiceover-Mashup`, `Voiceoverless-Mashup`, `Podcast`, `Animation`, `Slides`, `Song`.
- Underscores between parts, hyphens inside a part (`Disappearing-Woman`).

Example: folder `3_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens`, approved file
`3_V1_Energy-Without-Coffee_UGC_Busy-Parent_Afternoon-Crash_Acme-Greens.mp4` (the render's own
extension: `.png` for an image, `.mp4` for a video). To rename an ad, rename its folder and files and
update the paths in its edit documents.

An ad's record is its source of truth; the words on the image live in its prompt.

## Generate

Delegation and long renders: AGENTS.md (operating principles).

1. **Update the record** (concept, prompt, params).
2. **Generate.** Pass the prompt (in a throwaway temp file, to avoid shell-escaping), the refs —
   product/scene photos found with **search-media** plus the brand's type sheet (**pull-fonts**) —
   and any non-default params:
   ```bash
   node tools/generate-image.mjs --prompt-file /tmp/<id>_prompt.txt --timeout 600 \
     --ref "workspaces/<WS>/Acme/inputs/media/00042_bottle.png" \
     --ref "workspaces/<WS>/Acme/inputs/media/brand/type_sheet.png" \
     --out "workspaces/<WS>/Acme/outputs/3_Calm-Mornings_Static_Sarah_Stress-Relief_Acme/drafts/3_V1_Calm-Mornings_Static_Sarah_Stress-Relief_Acme.png"
   ```
3. **When it lands**, set `generation.output` to the printed `Saved:` path (it must match the
   prompt's `File name:` line) and remove the temp prompt file. Index refresh and R2 push: AGENTS.md.

To **re-generate** from an existing record, `generate-image.mjs --record <record.json>` reads the
prompt, refs and params and stamps the result back. All flags: `--help`.

## Video models

`tools/generate-video.mjs`; each model's clip lengths, reference limits and fallbacks are in its
`--help`. **MiniMax H3** is the default. **Seedance 2.5** speaks the dialogue it is given and takes
the longest clips. **Gemini Omni 1.1 Flash** can rework one video it is given.

Every model adds its own sound; only Seedance takes `--no-audio`. Mute what's left in the edit.

### Writing for each model

Workflows say what a clip prompt carries (task, who is who, timeline, lines, sound); lay it out in
its model's own syntax, never another's. On every model, the timeline adds up to `--duration`, and
the last beat gets at least 2 seconds or it is dropped.

**MiniMax H3** (MiniMax's guides on Hugging Face, `MiniMaxAI/MiniMax-H3` → `docs/`). English, named
fields in this order, a blank line between them:

- **With frames:** the first line is exactly `For the target video, at 0.00 seconds into the target
  video, <Picture 1> (from [Shot 1]) is fully referenced.` With a last frame too: `How the reference
  pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of
  the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.`
  (S.SS = the clip length). Then `integrated_multimodal_description:`, `overall_soundscape:`,
  `non_diegetic_music:`.
- **With references** (`--image`, `--video`, `--audio`), six fields:
  - `subject_definitions:` one line per subject or frame. `<Subject 1> is the woman in <Picture 2>,
    …`; a frame to match: `<Picture 1> is the first frame of [Shot 1]`. Pictures, videos and audio
    number in upload order, each type on its own count.
  - `summary:` one paragraph opening with the task type: `[keyframe completion]` (frames to match),
    `[reference generation]` (sheets), joined with ` + `.
  - `retention_analysis:` one line per label, e.g. `<Subject 1> (appears in [Shot 1], [Shot 3]):
    fully_preserved - …`.
  - `detailed_description:` the style in one sentence, then the shots, 350–500 words.
  - `overall_soundscape:`, `non_diegetic_music:`.
- **Shots:** `[Shot 1]` opens with the style and framing ("Stop-motion puppet animation, a medium
  shot of…"), no time; then `[Shot 2] At 00:03.500, the camera cuts to …`.
- **Camera:** a sentence inside the shot: Push In / Pull Out, Pan, Truck, Tilt, Pedestal, Zoom, Arc
  Shot, Tracking Shot, Static Shot, Shake Slightly, POV, plus "with small amplitude" or "at slow
  speed" when it matters.
- **Speech:** each speaker gets an ID, the same in every shot. Describe the voice outside the tag
  the first time: `the woman with a warm, relaxed American alto (S1) says: <d>[English] Exact
  words.</d>`. Voiceover: `says in an off-screen voiceover: <d>…</d> while her lips remain completely
  closed.` A line across a cut takes `<scenetrans>` on both sides; one cut off by the clip's end,
  `<cutoff>`. Nobody speaks: no IDs, no `<d>`.
- **Sound:** `overall_soundscape` is 1–4 sentences of room tone, action sounds and breaths, never
  dialogue. `non_diegetic_music: N/A` means no music; both `N/A` means a silent clip.
- **On-screen text** in double quotes, exactly as it reads.
- **No negatives at all**, not just as patches: say what is there instead ("the sign is blank").

**Gemini Omni** (Google's guide: `ai.google.dev/gemini-api/docs/omni`). English only.

- It cuts between several shots by default; for one, open with "In a single continuous shot, no
  scene cuts."
- References: tag each where its subject appears, counting from 0 ("the woman <IMAGE_REF_0> lifts
  the jar <IMAGE_REF_1>"), and end with "Use the given images as references for video generation;
  they are not initial frames." A frame: end with "Use this image as the starting frame."
- Timeline `[0-2s] … [2-5s] …`.
- Dialogue: who, the voice, then the line in quotes: `she says in a warm American alto: "Exact
  words."` On-screen text in quotes too, saying where it is.
- Sound in one closing `Sound design:` sentence, then plain negatives ("No other dialogue. No
  subtitles."). "No music" doesn't hold; take music out in the edit.

**Seedance 2.5** (BytePlus guide: `docs.byteplus.com/en/docs/modelark/seedance-2-5-prompt-guide`).
Under 1,000 words.

- **Order:** what each file is (`Image 1 is the first frame.`, or `Image 1 is the host, Image 2 the
  guest.`, uploaded in order of first appearance); the audio policy; one sentence of who, where,
  style and camera; the timeline; what holds throughout (camera, place, sound).
- **Timeline** in whole seconds, no gaps: `0-2s: … 2-5s: …`; `Hard cut.` between shots.
- **Dialogue:** `The host's line (dry, amused): {Exact words.}`; before a non-English line, name the
  language (`says in Spanish {…}`). Direct the whole line: a note on one word, or repeating its words,
  prints subtitles.
- **On-screen text** in `【…】`; spell a word that must be exact letter by letter.
- **Audio policy**, first and again at the end: "Only the spoken lines and the sounds below. No
  music, BGM, score, instrumental, melody, soundtrack, synth, ambient pad, drone, crescendo or
  stinger at any moment. No subtitles." Otherwise write positively.
- **Two known faults:** duplicates ("Do not generate duplicate avatars or a twin effect; keep only a
  single corresponding character in the same frame.") and glowing eyes from strong emotion words
  ("shocked", "fanatical"): use calmer ones.
- An error naming `PrivacyInformation` means it read a reference as a real person's face (it can
  misread a realistic AI-made one). Only then tell the user and offer: the same clip on MiniMax H3
  or Omni (on their yes), or a more stylized face. Don't retry the same image.
- `invalid image: heic: decode failed` means a JPG saved in an unusual way: convert it
  (`ffmpeg -i in.jpg -pix_fmt yuvj420p out.jpg`) and rerun with the copy.
