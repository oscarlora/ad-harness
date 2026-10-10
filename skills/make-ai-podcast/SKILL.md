---
name: make-ai-podcast
description: Make a podcast-style AI video ad — a podcast clip of one to four speakers where Seedance 2.5 generates both the footage and voices, planned with per-character GPT Image 2.5 base images edited from a generated podcast-set photo. It grounds itself in the brand's research files so the script carries only signed-off claims. Use whenever someone wants a podcast-style or talking-head VIDEO ad, an AI-generated podcast clip, a UGC "two people talking" ad, or wants to turn a product into a vertical podcast-style video — even if they just say "make a podcast ad" or describe the format without naming it. Covers grounding + concept, character design, the podcast-set photo, 9:16 base images, a casual dialogue script, Seedance prompts split within model limits, and finishing.
---

# Make AI podcast

Make a podcast-style video ad: one to four people in conversation, one on screen at a time, simple
straight cuts. **Seedance 2.5 generates both the footage and the voices**. **GPT Image 2.5** locks
each speaker's look in a base image first. Generation runs on the shared tools
(`tools/generate-image.mjs`, `tools/generate-video.mjs`).

The ad can be **any length** and in **any language**. Longer just means more clips: the per-clip cap
is 30 seconds on Seedance 2.5 and 15 on 2.0 and Mini, so you split the script into consecutive clips
within the cap and generate each one, until the whole length is covered.

## Workflow

Run in order. At each step, show the artifact and wait for the user before moving on — this is a
creative pipeline, and early choices (persona, voices, set) propagate everywhere.

1. **Research** — ground in the brand's research files; sign off product, persona + angle, claims.
2. **Concept** — product · persona · angle · market/language · speaker count; 3 options per element.
3. **Characters** — design each speaker's look and voice; 3 options.
4. **Set** — generate the podcast-set photo; a facing per speaker.
5. **Base-image prompts** — one edit-instruction prompt per character, from their set photo.
6. **Generate the base images** — three rolls per character; the user picks.
7. **Script** — a casual dialogue written to the chosen faces; 3 options.
8. **Video prompts** — split into clips within the model's per-clip cap.
9. **Generate the video** — Seedance, one run per clip, once the prompts are approved.
10. **Finish** — self-edit or editor handoff via Drive + Notion; record the ad.

## 1. Research

Ground in the brand's existing files: the product's `-research.md`, `-personas.md`, and
`-angles.md`, the brand's `inputs/feedback.md` (standing client guidance — see **capture-feedback**),
and any client brief in `inputs/`. If the brand isn't onboarded, or the research is missing or thin,
onboard as usual first (**research-brand**, with **pull-reviews**) — that skill owns all research
paths. Don't re-distill the doc into a brief: the research doc is the distillation, and
re-summarizing invites paraphrase drift — which is how claims get overstated.

The gate: a grounding selection the user signs off — which product (and doc), which persona + angle
(picked in step 2), the **2–4 claims** this ad will carry, and the product's **unique mechanism**. If
a claim isn't in the doc, it doesn't go in the script.

**Confirm the mechanism, never infer it.** A research doc lists features and benefits, and stitching
those into a mechanism invents one the brand may not recognise. Take it from the brief, the client,
or an explicit line in the doc. A whole script gets rewritten when it turns out to be wrong.

## 2. Concept

Define the concept element by element, as in any ad: propose **3 deliberately differentiated
options** for each, in order; anything the client brief or the user already defines is decided —
skip its options.

- **Product** — which of the brand's products (usually already set by step 1's gate).
- **Persona** — from the product's `-personas.md` set; ideate fresh ones when none fits
  (**ideate-personas**).
- **Angle** — from `-angles.md`, likewise (**ideate-angles**).
- **Target market** — sets the **accent** of the voices (US → American, UK → British, and so on)
  and the **idioms and phrasing** of the script. The podcast can be in **any language**, not only
  English — write the script in that language and design the voices with the matching accent.
- **Format variation** — how many people on the podcast: a one-, two-, three-, or four-person show.

## 3. Characters

Design each character — how they look **and** how they sound. Per speaker: age, ethnicity, look, and
outfit; then a **detailed voice design** (the checklist lives in **generate-voiceover**). Propose
**3 deliberately differentiated** casts; the user locks one.

Make the voices **clearly contrasting** — for example a low, warm alto against a bright, airy
mezzo. Seedance generates the voices straight from this text, and similar descriptions blur into the
same voice; the separation is what makes them read as different people. You will paste this block
verbatim into every video prompt, so write it once and write it well.

## 4. Set

Generate the **podcast-set photo** the base images are edited from, with **write-prompt**
(`tools/generate-image.mjs`, 9:16 at 1K, three rolls; the user picks, saved as `base/set.png`). Offer 3 set vibes that fit the
brand and persona (backdrop, light, props). Unless the brand owns a real set photo the user wants to
use (**search-media**), every set is generated: never adapt a photo of someone else's show.

The prompt asks for:

- **An intimate single-subject vertical frame:** one stand-in person seated, framed from the waist
  up, angled a little off-camera as if mid-conversation (step 5 replaces them).
- **A boom-arm podcast mic** entering from the lower left toward the speaker's mouth, never covering
  the face.
- **No show branding:** no text, logo or show name anywhere, on the mic or the set.
- **Real footage, not a render:** a paused frame of real interview footage, in **write-prompt**'s
  photography direction. The set sets how real the final video looks: if it looks AI-generated, the
  video will too.

Give every speaker their own **facing**, so intercut singles read as one conversation. The **second
speaker** uses a horizontally flipped copy of the chosen set (`ffmpeg -i set.png -vf hflip
set-flipped.png`): the mic then sits on the opposite side and the speaker faces the opposite
direction, one angled screen-left, the other screen-right. With three or four speakers, keep
assigning facings and mic sides that hold that same conversational geometry; a one-person show
skips this.

Steps 5–6 edit this photo into each character's base image; the set, light, and photographic
character carry through untouched.

## 5. Base-image prompts

One base image per character: an image-to-image edit of the set photo — first speaker on the chosen
set, second on its `-flipped` copy. The prompt is a **pure edit-instruction list**: only the
specific changes you want, nothing else.

- **Don't describe the set photo** — the model sees it; describing it invites redrawing. **No
  meta-words** either: never "photorealistic", "fictional", or any realism or retouch language, and
  never the word "soft" — it triggers retouched skin.
- **Replace the person with the designed character** (step 3), writing imperfections in as
  affirmative character detail: visible pores, slightly uneven skin tone with faint redness, subtle
  under-eye shadows, sun freckles, peach fuzz, flyaways and baby hairs. This is what keeps skin
  organic instead of AI-polished.
- **Wardrobe, pose, framing, and expression** per the character design — including the angle: each
  speaker angled to match their set photo's facing, so intercut singles hold.
- **No text anywhere** in the image: no show name or logo on the mic or set.
- **End with the lock:** add fine sensor noise like a paused frame of real interview footage; keep
  the photo's texture, natural skin texture, grain, contrast, and pixel-level detail exactly the
  same — only replace the person and apply the edits listed. Keep everything else exactly the same.

## 6. Generate the base images

Per character, run the same prompt **three times** (GPT varies run to run), 9:16 at 1K, with that
speaker's set photo as `--ref`:

```
node tools/generate-image.mjs \
  --prompt-file workspaces/<WS>/<Brand>/outputs/<ad-name>/base/<character>.txt \
  --ref workspaces/<WS>/<Brand>/outputs/<ad-name>/base/set.png \
  --aspect 9:16 --resolution 1K \
  --out workspaces/<WS>/<Brand>/outputs/<ad-name>/base/<character>-a.png
```

Roll `-a`/`-b`/`-c`; the second speaker's `--ref` is the `-flipped` copy. Base images and their
prompt `.txt` files live in the ad's working folder, `outputs/<ad-name>/base/` — keep `--out` under
`workspaces/<WS>/…`, since the tool infers the workspace's `<WS>_` keys (root `.env`) from it.
**The user picks the winner** — never grade creative output yourself. Show the rolls inline, one
table row per character (AGENTS.md, Visual). If no roll lands, tighten the prompt and reroll. See `node tools/generate-image.mjs --help`
for flags.

The base images deliberately come **before** the script: seeing the cast helps the user visualize
who's on the podcast, and the script gets written to real faces, not descriptions.

## 7. Script

Write a very casual, speech-like conversation between the characters, built from the signed-off
claims and the research doc's customer language. Give it a shape — **beats, not a rigid order**:
the hook exchange · the problem in the guest's lived words · what she tried that didn't work ·
what actually works, said simply and hedged like a layperson would · the result, with a number and
a timeframe (only from the signed-off claims) · the after, a scene from her week now · the
product, named naturally near the end. Beats can merge or reorder — keep it natural — but every
script covers the ground.

Offer **3 deliberately differentiated** scripts, each opening on a different beat — one on the
result, one on the problem, one on what she tried — so they're genuinely different, not the same
script reworded. Agree the target length with the user — the rest of the pipeline is identical at
any length. Label every dialogue line with the speaker's name and cast role — `MAYA (HOST):`,
`CHLOE (GUEST):` — so who's who reads at a glance. The shared writing law — outcome-led lines,
honest substantiated claims, one angle per ad — lives in **write-copy**, along with the claim
rules in its Claims section; load it. What's podcast-specific is the dialogue craft:

- **Open mid-conversation at the most gripping point.** No greetings, no introductions, no
  "welcome to the show". The first line is the hook — often the host reacting to the strongest
  true claim ("Two weeks? Come on."). A listener who hears only the first five seconds should
  already want the answer.
- **One sentence = one shot.** Keep lines short.
- **Speech-like flow, never punchy:** no ad-copy staccato, no clipped fragments — contractions,
  fillers, a false start, the odd trailing-off (dialogue earns the fillers write-copy bans on
  creatives). Read it aloud; if it sounds written, loosen it.
- **Interruptions:** end a line with a trailing "-" to cut a speaker off and let the other barge in.
  Good for comedic timing and realism.
- **Hedge vs. certainty:** a layperson is unsure about mechanisms ("don't quote me on the science,
  but…") and certain about her own experience. Mixing the two reads as real rather than scripted.
- **Echoes:** the host repeats a fragment back ("two weeks?", "every night?") — the one place a
  clipped fragment belongs; it keeps the exchange a conversation, not alternating monologues.
- **Product out of frame:** the product graphic goes on screen in the edit, not in the footage —
  write the dialogue so nothing needs to be shown.
- **On-screen text vs. spoken word:** captions and overlays follow the brand's text conventions; the
  spoken line can use the natural word. Write each for its medium.

## 8. Video prompts

Split the script into consecutive clips within the model's per-clip cap — **30 seconds or less** on
seedance-2.5, **15** on seedance-2 and Mini; round each clip's length up to a whole second.

**Time every clip at write-copy's pace** (Length): count the clip's words, both speakers, and
divide by 4. If a render still drags, drop its
duration by a second to compress delivery rather than cutting words; if it rushes, cut words rather
than adding seconds.

**Write each clip to hand off to the next.** End a clip mid-thought, on a trailing line the speaker
is clearly about to continue, and open the next mid-sentence with that speaker already talking and
already in motion. A clip that ends on a resolved beat and opens from stillness reads as two
recordings, not one conversation.

Write each clip's prompt **fully self-contained** — restate every character, the set, and which
reference image is which; never reference another clip or assume prior context. A separate
generation has no knowledge of the others, and referencing one lowers quality.

Structure each prompt with these labeled blocks:

- **TASK** — bring lines X–Y to life, vertical 9:16. Use each character's base image exactly as
  their keyframe: do not redraw, restyle, recrop, relight, or change the set, wardrobe, faces, or
  composition. Keep the camera fully locked — no pans, zooms, push-ins, tilts, or shake. Only the
  person on screen moves, in micro-movements: a natural blink rate, collarbone breathing, head
  moves of a centimeter or two, small low hand moves — nothing theatrical. Move between lines
  with simple hard straight cuts, one person on screen at a time; each cut lands exactly on the
  incoming speaker's first word, with that speaker already in subtle motion at the cut (mid-breath,
  mid-nod), never starting from stillness. Cut only when the other person actually speaks — a
  genuine question or interjection; reactions stay off screen, since cutting away for an "mm" reads
  as staged. Consecutive lines from the same speaker run as one continuous locked shot, never a
  jump cut.
- **AUDIO** — no music. Only the voices plus natural sound (soft breaths before and after lines, a
  chair creak, fabric near the mic); room tone runs continuously and unbroken across every cut.
  Brisk pacing, no dead air — each line begins on the tail of the previous one. Hold each voice
  exactly consistent.
- **VOICES** — the voice-design block from step 3, **pasted verbatim and identical in every clip**.
  Say which character is which. Identical wording across clips is what keeps the voices from drifting
  between generations.
- **SHOTS** — per line: who is on screen, their exact expression and gesture (the hands and face do
  the acting), and the exact spoken line. **Anchor each beat to a word**, not to the line: the palm
  turns up on "gave away", the eyes drop on "bored of it", a swallow lands before "every day".
  Generic movement rules produce generic motion; a beat tied to a word produces a performance.
  Expressions move **with** the words and relax as the line ends — never hold, grow, or freeze a
  smile after a line finishes; end every shot mid-energy (a delayed smile onto a stilled face reads
  as uncanny). State once, globally, that **no gesture, sound, or expression repeats anywhere in the
  clip** — repetition is what makes a take read as a loop. Cue interruptions (cut off mid-word) with
  the barging-in voice starting a beat before the cut — the one overlap that beats the
  cut-on-first-word rule.
- **REACTIONS** — write them for **both** people, in both directions: the off-screen listener
  reacting under the speaker's lines (a soft "mhm", a small laugh, a breath, a chair creak), and the
  same for whoever is off screen while the other one is on camera. Name the exact word each reaction
  lands on. This sells the realism — write it rich, never skip it.

Keep prompts tight and value-dense — every word should steer the model, and follow **write-prompt**'s
"How a model reads a prompt" (it also covers what to do when a clip surprises you). The realism carriers are the
micro-details: the micro-gestures, micro-sounds, and micro-movements in **SHOTS**, and the
**REACTIONS** between them — spend your words there.

## 9. Generate the video

Once the user approves the clip prompts, generate with **Seedance** via
`tools/generate-video.mjs`, one run per clip:

```
node tools/generate-video.mjs \
  --prompt-file <clip>.txt \
  --image <host-base>.png --image <guest-base>.png \
  --model seedance-2.5 \
  --aspect 9:16 --resolution 480p --duration <within the model's cap> --generate-audio \
  --out workspaces/<WS>/<Brand>/outputs/<ad-name>/<clip>.mp4 --timeout 600
```

- Pass the base image of each character who speaks in that clip as `--image` references.
- Keep `--generate-audio` on (voices plus natural sound); the no-music rule lives in the prompt text.
- **Always pass `--model seedance-2.5`** — 2.5 gives 30s clips, beat Mini in a same-prompt A/B, and takes up to 30 reference
  images, so every character's base image can ride along. `seedance-2-mini` stays the cheap option,
  capped at 15s and 720p.
- **Resolution follows the 480p-first ladder** (AGENTS.md, video quality). For the approved master,
  Seedance 2.5 reaches 1080p only on the Gateway (auto routes a 1080p request there; Segmind/kie
  stop at 720p); without a Gateway key, switch only the model to full `seedance-2`. The master is a new take and may vary slightly.
- Verify a rendered clip silently with `ffprobe` (duration, streams, audio present); no frame
  pulls or QA images unless the user asks to see one.
- See `node tools/generate-video.mjs --help` for all flags.

## 10. Finish

The generated clips deliberately contain no music and no on-screen product — clean footage, with
full control over the overlays and pacing left for the edit. Guide the user to the finish by one of
two routes:

- **Self-edit in the harness.** Load **edit-video** (Palmier Pro or the ffmpeg plan) and assemble the final cut from an edit plan:
  the clips in sequence, the product graphic on screen at the beat that fits (from the brand's
  catalog — **search-media**), captions and music as wanted (it loads **caption-video** and
  **add-music** for those). The user signs off on the plan, and revisions are plan tweaks plus a
  re-render — seconds, free.
- **Hand off to an editor.** Put the clips in Drive (**sync-to-drive**) and push a Notion page
  (**sync-to-notion**) that links the folder, plus an **editing instructions** block you compose: the
  opening hook (name the exact script line it must match), subtitles, the exact clip order,
  zoom-in/zoom-out moments, background-music direction (trending, copyright-free), and a finishing
  note to add a little noise and experiment with highlights/shadows — it reduces the AI look.

Once the cut is approved, record the ad like any other: write its record to `outputs/json/[id].json`
(schema in `tools/record-ad.mjs` — concept, script, clip prompts + params, final output). Index
refresh and R2 push: AGENTS.md (operating principles); a final cut rendered here needs
`--originals` (**edit-video**, After approval).
This is what puts podcast ads on **plan-batch** plans and the **studio** board alongside image ads.

## Naming

Deliverables follow the naming convention in **write-prompt**, with format `Podcast` — for
example `7_V1_Kitchen-Table-Talk_Podcast_Busy-Parent_Reframe_Acme`.
