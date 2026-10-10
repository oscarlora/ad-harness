---
name: make-ai-slides
description: Make an AI slides video ad — a narrated explainer where every line of the voiceover becomes a simple illustrated slide (vintage textbook, flat cartoon and more), animated so each thing lights up as it is said, on a black 9:16 canvas with the hook above and captions below. Use when someone wants a slides, explainer or "visualize what she's saying" ad, or wants a script or a past winner's audio turned into illustrated slides.
---

# Make AI slides

One narrator, one 16:9 slide per line, each thing on the slide highlighted on its word. Work in
`outputs/<ad>/` (format `Slides` in the **write-prompt** name): `script.md`, `voice/`,
`storyboard.md`, `sheets/`, `frames/`, `prompts/`, `clips/`, `music/`. Show every output as it lands and wait for a yes before paying for the next step.

## 1. Concept

Persona, angle and claims as in **make-ai-podcast** step 1, with the brand's `inputs/feedback.md`
(**capture-feedback**). Then the look: offer 3 slide styles unless one is named (a 1950s school
textbook, a flat cartoon explainer, a modern biology textbook, an old anatomy plate…).

## 2. Script

Write it with **write-copy** (pace in its Length rule), or reuse a winner word for word: transcribe
the reference (`node tools/transcribe-media.mjs --in <ref>.mp4`), fix mishearings and brand names,
and get the user's yes on the exact text before voicing it.

## 3. Voiceover and timestamps

Generate 3 takes with **generate-voiceover**; the user picks. To keep a reference's exact delivery
and only change the voice, swap it on ElevenLabs with the workspace's `<WS>_ELEVENLABS_API_KEY`:
`POST /v1/audio-isolation` (strips the music), then `POST /v1/speech-to-speech/<voice_id>`
(`model_id=eleven_multilingual_sts_v2`).

Then take the chosen take's word timestamps: `node tools/transcribe-media.mjs --in <take>.mp3 --words`.
Every time after this comes from them.

## 4. Storyboard

Split the script into the phrases that each carry one picture, and write `storyboard.md` as one table
and nothing else, `| # | Start | End | s | Line | What we see | What moves | What we hear | Camera | Transition |`,
where the times are the phrase's span from the timestamps. The shots tile the voiceover with no gaps.
Recurring characters (and one recurring stage, such as a side view of a pore) are named the same way in
every row they appear.

The columns answer one question each, always the simplest, easiest-to-understand answer that
reinforces the line:

- **What we see:** what picture shows this line? One idea per slide: a short heading, the picture, a
  few labels. Literal means literal: B12 is its molecule, "bloating, gone" is a belly deflating. Apply
  **make-ai-animation** step 4's one-story rules across the whole board before any frame.
- **What moves:** how do we animate that picture so it says the line? Move the thing being said, on its
  word, in the way that fits it: a process ("his skin turns some of it into DHT") can bounce each step
  as it's named, a rise fills up, a burn flickers, a crowd wiggles, a hand pushes forward. Never motion
  for its own sake. Keep the physics easy: only things already drawn move; text never moves, appears or
  changes; nothing turns into something else; nothing new enters.
- **What we hear:** what sound does that motion make? Its most literal sound (oil glugs, flames sizzle,
  pills rattle). Repeats within one line share a sound (each step of a list); a motion with no real
  sound (a smile, a glance) gets none: write "—".
- **Camera:** what does the camera do: stay locked, push in or pull out (how fast), follow something,
  change angle? It is separate from what moves in the scene. Slides keep it **Locked**: they are slides,
  and a still camera keeps the model's physics simple.
- **Transition:** how does the shot come in? A hard cut is the simple default. A richer ad gives each
  cut its own natural move that carries the eye into the next frame (push into an object that opens the
  next slide, a match on shape, a whip or a twist), never one move repeated.

Keep variety across the board. Simple doesn't mean the same: the examples above are illustrations, not
defaults. Read the board top to bottom and make sure the motions, sounds and transitions differ from
slide to slide wherever the line allows, so the ad stays engaging.

## 5. Frames

Frame 1 first, in 3 takes of the style; the chosen one locks the look. Then make a sheet for any
character who recurs (**make-ai-animation** step 5), and generate the rest in parallel, each with frame 1
as reference 1, plus the sheet or the real product (`sheets/product.png`, per **write-prompt**'s product rules):

    node tools/generate-image.mjs --prompt-file <ad>/prompts/frame-02.txt --ref <ad>/frames/frame-01.png \
      --aspect 16:9 --resolution 2K --out <ad>/frames/frame-02.png

Each prompt gives the heading, what is drawn, its labels and a `Fig. N` caption, then one shared style
paragraph ending "only the elements listed, all text spelled exactly as written". Describe bodies as
a person in plain clothes: "body outline" trips the content filter. With a character sheet as a
reference, pass it only to frames that use its characters, and tell the model to use only the ones the
frame names: otherwise it pastes the whole cast in. A full-bleed 9:16 frame (instead
of a 16:9 slide on the black canvas) gets cropped to 4:5 in Meta's feed, losing about the top and bottom
15%. Prompting the 9:16 canvas as safe rows (in words or with a row-guide reference) doesn't hold:
the model still puts headings at the very top. Generate the frame at 4:5 instead, with the bottom
subject running off the lower edge. Only once the user approves a 4:5 frame, extend it to 9:16 with
AI, keeping the art pixel-identical (never extend unapproved frames; each extension is a paid render):
`node tools/extend-to-story.mjs --in <frame>-4x5.png --out <frame>.png --above "<background>" --below
"<what runs off the bottom>" --paste`. Lay all frames side by side
(an ffmpeg `xstack` contact sheet) and check them against step 4 before showing them in table rows.

## 6. Clips

MiniMax H3 Max (where it runs: **write-prompt**, Video models), 3–6 minutes a clip. Group whole shots
into chunks of up to 15 s (never part of a shot), pass their frames in order, and run every chunk at
once (long renders: AGENTS.md, operating principles):

    node tools/generate-video.mjs --model minimax-h3-max --prompt-file <ad>/prompts/chunk-01.txt \
      --image <ad>/frames/frame-01.png --image <ad>/frames/frame-02.png --image <ad>/frames/frame-03.png \
      --aspect 16:9 --duration <chunk seconds, rounded up> --no-audio --out <ad>/clips/chunk-01.mp4 --timeout 1500

The prompt says:

- Images 1…N are the slides, reproduced exactly, each filling the 16:9 frame edge to edge (no bars),
  shown in order with hard cuts at the given seconds; the last runs to the end.
- Camera locked; text stays exactly as printed; never write any words on screen.
- Sound, said outright: kie's base H3 adds its own audio even with `--no-audio`. When the sound
  effects go on in the edit (**add-sound-effects**), write "Silent video: no sound, music or voice
  at all." When the clip should carry them, give each beat its
  **What we hear** sound at its time, next to its motion.
- Lively: something always moving (blinks, breathing, bobbing icons).
- Per slide, a timeline in chunk seconds: its storyboard **What moves** beats, each at its word's
  time. Seconds only; quoted narration gets written onto the slide.

Make chunk 1 first and show it with the voiceover muxed under it
(`ffmpeg -i chunk-01.mp4 -i <take>.mp3 -map 0:v -map 1:a -c:v copy -shortest`). A one-shot clip, such as
a hook variant, uses `--first-frame` instead of `--image`.

## 7. Edit

In Palmier Pro, or with **edit-video** without it (which, plus Palmier's connection and pitfalls:
**edit-video**, Editor). 9:16, 1080p, 30 fps. The steps are written for Palmier; with edit-video
each slide is a timeline entry (the 16:9 chunk is padded onto the black 9:16 canvas, `trim` and
`speed` per slide), the voiceover, effects and music go in premixed as one track, and the hook is a
PNG overlay (**edit-video**'s limits).

1. Tracks, bottom up: a black matte for the whole length; the chunks in order, each trimmed to its
   shots' span (they auto-fit full width, centered); then the hook and the captions. Audio: the
   voiceover, the sound effects (**add-sound-effects**), and a music bed (**add-music**) around
   −18 dB with short fades.
2. Retime: the model's cuts drift up to half a second. Find them
   (`ffmpeg -i <chunk> -vf "select='gt(scene,0.06)',showinfo" -f null -`), split each chunk there, and
   `edit_speed` each slide to its shot's span.
3. Text, white Montserrat Bold about 34 pt: the hook above the slide (y ≈ 0.27) through shot 1, then
   captions below it (y ≈ 0.70), built with **caption-video** from the word timestamps.
4. Hook variants: duplicate the timeline (`create_timeline` with `from`) and swap only shot 1's clip.
5. Export only when asked, named per **write-prompt**, or per the brand's handoff template if it
   has one (e.g. `inputs/brief-templates.md`).

Then record the ad (`tools/record-ad.mjs`), ingest the approved frames and clips (**catalog-media**),
and push the brand.
