---
name: make-ai-podcast
description: Make a podcast-style AI video ad — one to four speakers, where Seedance 2.5 generates the footage and voices from per-character GPT Image 2.5 base images edited from a generated podcast-set photo, with a script grounded in the brand's research. Use whenever someone wants a podcast-style or talking-head VIDEO ad, an AI-generated podcast clip, a UGC "two people talking" ad, or a product turned into a vertical podcast-style video — even if they just say "make a podcast ad" or describe the format without naming it.
---

# Make AI podcast

A podcast-style video ad: one to four people talking, one on screen at a time, straight cuts.
**Seedance 2.5** generates the footage and the voices; **GPT Image 2.5** locks each speaker's look in
a base image first. Any length, any language: longer just means more clips (step 8).

## Workflow

Run in order. Show each step's artifact and wait for the user before moving on.

1. **Research** — ground in the brand's research files; sign off product, persona + angle, claims.
2. **Concept** — product · persona · angle · market/language · speaker count; 3 options per element.
3. **Characters** — design each speaker's look and voice; 3 options.
4. **Set** — generate the podcast-set photo; a facing per speaker.
5. **Base-image prompts** — one edit-instruction prompt per character, from their set photo.
6. **Generate the base images** — three rolls per character; the user picks.
7. **Script** — a casual dialogue written to the chosen faces; 3 options.
8. **Video prompts** — split into clips within the model's per-clip cap.
9. **Generate the video** — Seedance, one run per clip, once the prompts are approved.
10. **Finish** — self-edit or editor handoff via **upload-ads**; record the ad.

## 1. Research

Ground in the product's `-research.md`, `-personas.md` and `-angles.md`, the brand's
`inputs/memory.md` (**save-brand-memory**), and any client brief in `inputs/`. If the research is
missing or thin, onboard first (**research-brand**, with **pull-reviews**). Work from the research doc
itself; don't re-summarize it into a brief, since paraphrase overstates claims.

The gate: the user signs off the product (and doc), the persona + angle (picked in step 2), the
**2–4 claims** this ad carries, and the product's **unique mechanism**. A claim not in the doc doesn't
go in the script.

**Confirm the mechanism, never infer it.** Take it from the brief, the client, or an explicit line in
the doc — never stitch one together from features and benefits.

## 2. Concept

Propose **3 deliberately differentiated options** per element, in order; skip any element the brief
or the user already set.

- **Product** — usually set by step 1's gate.
- **Persona** — from `-personas.md`; ideate fresh ones when none fits (**ideate-personas**).
- **Angle** — from `-angles.md`, likewise (**ideate-angles**).
- **Target market** — sets the voices' **accent** (US → American, UK → British) and the script's
  **language, idioms and phrasing**.
- **Format variation** — a one-, two-, three-, or four-person show.

## 3. Characters

Per speaker: age, ethnicity, look, outfit, and a **detailed voice design** (checklist in
**generate-voice**). Propose **3 deliberately differentiated** casts; the user locks one.

Make the voices **clearly contrasting** (a low, warm alto against a bright, airy mezzo): Seedance
builds the voices from this text, and similar descriptions blur into one voice. This block gets
pasted verbatim into every video prompt.

## 4. Set

Generate the **podcast-set photo** with **write-prompt** (`tools/generate-image.mjs`, 9:16 at 1K,
three rolls; the user picks; save as `base/set.png`). Offer 3 set vibes that fit the brand and persona
(backdrop, light, props). Use a real set photo only when the brand owns one the user wants
(**search-media**); never adapt a photo of someone else's show.

The prompt asks for:

- **One stand-in person seated**, framed from the waist up, angled a little off-camera as if
  mid-conversation (step 5 replaces them).
- **A boom-arm podcast mic** entering from the lower left toward the mouth, never covering the face.
- **No text, logo or show name** anywhere, on the mic or the set.
- **A paused frame of real interview footage**, not a render, in **write-prompt**'s photography
  direction. If the set looks AI-generated, the video will too.

Give each speaker their own **facing** so intercut singles read as one conversation. The second
speaker uses a flipped copy (`ffmpeg -i set.png -vf hflip set-flipped.png`): mic on the other side,
facing the other way. With three or four speakers, keep assigning facings and mic sides in that same
geometry; a one-person show skips this.

## 5. Base-image prompts

One base image per character: an image-to-image edit of their set photo (the second speaker's is the
`-flipped` copy). The prompt is a **pure edit-instruction list**: only the changes you want.

- **Don't describe the set photo** — describing it invites redrawing. **No meta-words**: never
  "photorealistic", "fictional", or any realism or retouch language, and never "soft" (it triggers
  retouched skin).
- **Replace the person with the designed character** (step 3), writing imperfections in as character
  detail: visible pores, slightly uneven skin tone with faint redness, subtle under-eye shadows, sun
  freckles, peach fuzz, flyaways and baby hairs.
- **Wardrobe, pose, framing, and expression** per the character design, angled to match their set
  photo's facing.
- **No text anywhere**: no show name or logo on the mic or set.
- **End with the lock:** add fine sensor noise like a paused frame of real interview footage; keep
  the photo's texture, natural skin texture, grain, contrast, and pixel-level detail exactly the
  same — only replace the person and apply the edits listed. Keep everything else exactly the same.

## 6. Generate the base images

Per character, run the same prompt **three times**, 9:16 at 1K, with that speaker's set photo as
`--ref`:

```
node tools/generate-image.mjs \
  --prompt-file workspaces/<WS>/<Brand>/outputs/<ad-name>/base/<character>.txt \
  --ref workspaces/<WS>/<Brand>/outputs/<ad-name>/base/set.png \
  --aspect 9:16 --resolution 1K \
  --out workspaces/<WS>/<Brand>/outputs/<ad-name>/base/<character>-a.png
```

Roll `-a`/`-b`/`-c`; the second speaker's `--ref` is the `-flipped` copy. Keep `--out` under
`workspaces/<WS>/…` (the tool picks the workspace's keys from it). Show the rolls inline, one table
row per character; **the user picks** — never grade them yourself. If no roll lands, tighten the
prompt and reroll.

## 7. Script

Write a very casual, speech-like conversation from the signed-off claims and the research doc's
customer language. Cover these **beats**, merged or reordered as feels natural: the hook exchange ·
the problem in the guest's lived words · what she tried that didn't work · what actually works, said
simply and hedged like a layperson · the result, with a number and a timeframe (signed-off claims
only) · the after, a scene from her week now · the product, named naturally near the end.

Offer **3 deliberately differentiated** scripts, each opening on a different beat (the result, the
problem, what she tried). Agree the target length with the user. Label every line with the speaker's
name and role: `MAYA (HOST):`, `CHLOE (GUEST):`. Writing and claim rules live in **write-copy**; load
it. The podcast-specific dialogue craft:

- **Open mid-conversation at the most gripping point.** No greetings, no introductions, no "welcome
  to the show". The first line is the hook, often the host reacting to the strongest true claim
  ("Two weeks? Come on.").
- **One sentence = one shot.** Keep lines short.
- **Speech-like flow, never punchy:** no ad-copy staccato — contractions, fillers, a false start, the
  odd trailing-off (dialogue may use the fillers write-copy bans elsewhere). If it sounds written,
  loosen it.
- **Interruptions:** end a line with a trailing "-" to cut a speaker off and let the other barge in.
- **Hedge vs. certainty:** unsure about mechanisms ("don't quote me on the science, but…"), certain
  about her own experience.
- **Echoes:** the host repeats a fragment back ("two weeks?", "every night?") — the one place a
  clipped fragment belongs.
- **Product out of frame:** the product graphic goes on in the edit; write the dialogue so nothing
  needs to be shown.
- **On-screen text vs. spoken word:** captions and overlays follow the brand's text conventions; the
  spoken line can use the natural word.

## 8. Video prompts

Split the script into consecutive clips within the model's per-clip cap (**write-prompt**, Video
models); round each clip's length up to a whole second. Time each clip at **write-copy**'s pace
(Length), counting every speaker's words. If a render drags, drop its duration by a second rather
than cutting words; if it rushes, cut words rather than adding seconds.

**Hand off between clips.** End a clip mid-thought, on a line the speaker is about to continue, and
open the next mid-sentence with that speaker already talking and moving.

Make each prompt **fully self-contained**: restate every character, the set, and which reference
image is which; never reference another clip.

Structure each prompt with these labeled blocks:

- **TASK** — bring lines X–Y to life, vertical 9:16. Use each character's base image exactly as
  their keyframe: do not redraw, restyle, recrop, relight, or change the set, wardrobe, faces, or
  composition. Keep the camera fully locked — no pans, zooms, push-ins, tilts, or shake. Only the
  person on screen moves, in micro-movements: a natural blink rate, collarbone breathing, head
  moves of a centimeter or two, small low hand moves — nothing theatrical. Simple hard straight cuts
  between lines, one person on screen at a time; each cut lands exactly on the incoming speaker's
  first word, with that speaker already in subtle motion (mid-breath, mid-nod). Cut only when the
  other person actually speaks (a genuine question or interjection); reactions stay off screen.
  Consecutive lines from the same speaker run as one continuous locked shot, never a jump cut.
- **AUDIO** — no music. Only the voices plus natural sound (soft breaths before and after lines, a
  chair creak, fabric near the mic); room tone runs unbroken across every cut. Brisk pacing, no dead
  air — each line begins on the tail of the previous one. Hold each voice exactly consistent.
- **VOICES** — step 3's voice-design block, **verbatim and identical in every clip**, saying which
  character is which. Identical wording keeps the voices from drifting between clips.
- **SHOTS** — per line: who is on screen, their exact expression and gesture, and the exact spoken
  line. **Anchor each beat to a word**: the palm turns up on "gave away", the eyes drop on "bored of
  it". Expressions move **with** the words and relax as the line ends — never hold, grow, or freeze a
  smile after a line; end every shot mid-energy. State once that **no gesture, sound, or expression
  repeats anywhere in the clip**. Cue interruptions (cut off mid-word) with the barging-in voice
  starting a beat before the cut — the one exception to the cut-on-first-word rule.
- **REACTIONS** — for **both** people: whoever is off screen reacts under the other's lines (a soft
  "mhm", a small laugh, a breath, a chair creak), each named to the exact word it lands on. Write it
  rich; never skip it.

Keep prompts tight, per **write-prompt**'s "How a model reads a prompt". Spend the words on the
micro-gestures, micro-sounds and micro-movements in **SHOTS** and on **REACTIONS**.

## 9. Generate the video

Once the user approves the clip prompts, one run per clip:

```
node tools/generate-video.mjs \
  --prompt-file <clip>.txt \
  --image <host-base>.png --image <guest-base>.png \
  --model seedance-2.5 \
  --aspect 9:16 --resolution 480p --duration <within the model's cap> --generate-audio \
  --out workspaces/<WS>/<Brand>/outputs/<ad-name>/<clip>.mp4 --timeout 600
```

- `--image`: the base image of each character who speaks in that clip.
- Keep `--generate-audio` on; the prompt says no music.
- **Always pass `--model seedance-2.5`**; `seedance-2-mini` is the cheap option.
- Resolution follows the 480p ladder (AGENTS.md). Seedance 2.5 reaches 1080p only on the Gateway;
  without a Gateway key, switch only the model to `seedance-2` for the master.
- Check each clip silently with `ffprobe` (duration, streams, audio present); no frame pulls unless
  the user asks.

## 10. Finish

The clips carry no music and no on-screen product; both go in during the edit. Two routes:

- **Self-edit in the harness.** Load **edit-video** and build the cut as an edit document: the clips
  in order, the product graphic at the beat that fits (**search-media**), captions and music as
  wanted (**caption-video**, **add-music**). The user reviews it in Studio and leaves notes there.
- **Hand off to an editor.** Upload the clips (**upload-ads**: e.g. a Drive folder and a Notion page
  linking it) with an **editing instructions** block: the opening hook (the exact script line it
  must match), subtitles, the exact clip order, zoom-in/zoom-out moments, background-music direction
  (trending, copyright-free), and a note to add a little noise and experiment with
  highlights/shadows to reduce the AI look.

Once the cut is approved, write its record to `outputs/json/[id].json` (schema in
`tools/record-ad.mjs` — concept, script, clip prompts + params, final output). Index refresh and R2
push: AGENTS.md; a final cut rendered here needs `--originals` (**edit-video**, Export).

## Naming

Format `Podcast` in **write-prompt**'s naming convention, e.g.
`7_V1_Kitchen-Table-Talk_Podcast_Busy-Parent_Reframe_Acme`.
