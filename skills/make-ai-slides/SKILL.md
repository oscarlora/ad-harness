---
name: make-ai-slides
description: Make an AI slides video ad — a narrated explainer where each voiceover line becomes a simple illustrated slide (vintage textbook, flat cartoon and more) that lights up each thing as it is said, on a black 9:16 canvas with the hook above and captions below. Use when someone wants a slides, explainer or "visualize what she's saying" ad, or wants a script or a past winner's audio turned into illustrated slides.
---

# Make AI slides

One narrator, one 16:9 slide per line, each thing on the slide highlighted on its word. Work in
`outputs/<ad>/` (format `Slides` in the **write-prompt** name): `script.md`, `voice/`,
`storyboard.md`, `sheets/`, `frames/`, `prompts/`, `clips/`, `music/`.

## 1. Concept

Load the brand context (AGENTS.md). Persona, angle and claims as in **make-ai-podcast** step 1.
Then the slide style, unless one is named (a 1950s school textbook, a flat cartoon explainer, an
old anatomy plate…).

## 2. Script

Write it with **write-copy**, or reuse a winner word for word: transcribe it
(`node tools/transcribe-media.mjs --in <ref>.mp4`), fix mishearings and brand names, and get the
user's yes on the exact text before voicing it.

## 3. Voiceover and timestamps

Generate takes with **generate-voice** (which also re-voices a reference with its exact delivery).

Then take the chosen take's word timestamps (`node tools/transcribe-media.mjs --in <take>.mp3 --words`).
All later timing comes from them.

## 4. Storyboard

Split the script into phrases that each carry one picture. Write `storyboard.md` as one table and
nothing else, `| # | Start | End | s | Line | What we see | What moves | What we hear | Camera | Transition |`,
with each phrase's span from the timestamps; the shots tile the voiceover with no gaps. Name recurring
characters (and one recurring stage, such as a side view of a pore) the same way in every row.

Each column takes the simplest answer that reinforces the line:

- **What we see:** one idea per slide: a short heading, the picture, a few labels. Literal means
  literal: "bloating, gone" is a belly deflating. Apply **make-ai-animation**
  step 4's one-story rules across the whole board before any frame.
- **What moves:** the thing being said, on its word, in a way that fits it (a process bounces each
  step as it's named). No motion for its own sake. Only things already
  drawn move; text never moves, appears or changes; nothing turns into something else; nothing new
  enters.
- **What we hear:** the motion's most literal sound (pills rattle). Repeats within one line
  share a sound; a motion with no real sound (a smile, a glance) gets "—".
- **Camera:** **Locked**.
- **Transition:** a hard cut by default. A richer ad gives each cut its own natural move into the next
  frame (push into an object that opens the next slide, a match on shape, a whip), never one move
  repeated.

Then read the board top to bottom and vary the motions, sounds and transitions from slide to slide
wherever the line allows; the examples above aren't defaults.

## 5. Frames

Frame 1 first; the chosen take locks the look. Make a sheet for any recurring
character (**make-ai-animation** step 5), then generate the rest in parallel, each with frame 1 as
reference 1, plus the sheet or the real product (`sheets/product.png`, per **write-prompt**'s product
rules):

    node tools/generate-image.mjs --prompt-file <ad>/prompts/frame-02.txt --ref <ad>/frames/frame-01.png \
      --aspect 16:9 --resolution 2K --out <ad>/frames/frame-02.png

Each prompt gives the heading, what is drawn, its labels and a `Fig. N` caption, then one shared style
paragraph ending "only the elements listed, all text spelled exactly as written". Describe bodies as
a person in plain clothes ("body outline" trips the content filter). Pass a character sheet only to
frames that use its characters, and tell the model to use only the ones the frame names.

For a full-bleed 9:16 frame instead of a slide, generate at 4:5 with the bottom subject running off
the lower edge (Meta's feed crops 9:16 to 4:5, and prompted safe rows don't hold). Only once the user
approves it (each extension is paid), extend it to 9:16, art pixel-identical:
`node tools/extend-to-story.mjs --in <frame>-4x5.png --out <frame>.png --above "<background>" --below
"<what runs off the bottom>" --paste`.

Check all frames side by side (an ffmpeg `xstack` contact sheet) against step 4.

## 6. Clips

MiniMax H3 Max (**write-prompt**, Video models), 3–6 minutes a clip. Group whole shots into chunks of
up to 15 s (never split a shot), pass their frames in order, and run every chunk at once (long renders:
AGENTS.md):

    node tools/generate-video.mjs --model minimax-h3-max --prompt-file <ad>/prompts/chunk-01.txt \
      --image <ad>/frames/frame-01.png --image <ad>/frames/frame-02.png --image <ad>/frames/frame-03.png \
      --aspect 16:9 --duration <chunk seconds, rounded up> --out <ad>/clips/chunk-01.mp4 --timeout 1500

The prompt says:

- Images 1…N are the slides, reproduced exactly, each filling the 16:9 frame edge to edge (no bars),
  shown in order with hard cuts at the given seconds; the last runs to the end.
- Camera locked; text stays exactly as printed; never write any words on screen.
- Sound, said outright (MiniMax has no audio control: **write-prompt**, Video models). When the sound effects
  go on in the edit (**generate-sfx**): "Silent video: no sound, music or voice at all." When the
  clip carries them: each beat's **What we hear** sound at its time, next to its motion.
- Lively: something always moving (blinks, breathing, bobbing icons).
- Per slide, a timeline in chunk seconds of its **What moves** beats, each at its word's time. Seconds
  only; quoted narration gets written onto the slide.

Make chunk 1 first and preview it with the voiceover muxed under it
(`ffmpeg -i chunk-01.mp4 -i <take>.mp3 -map 0:v -map 1:a -c:v copy -shortest`). A one-shot clip, such as
a hook variant, uses `--first-frame` instead of `--image`.

## 7. Edit

With **edit-video**: one edit document, 9:16, 1080p, 30 fps, black `background`.

1. Tracks, top down: the captions and the hook; the chunks in order on the Video track, each trimmed
   to its shots' span and `fit: "contain"` (they fit full width, centered); the voiceover; the
   sound effects (**generate-sfx**); a music bed (**add-music**).
2. Retime: the model's cuts drift up to half a second. Find them
   (`ffmpeg -i <chunk> -vf "select='gt(scene,0.06)',showinfo" -f null -`), split each chunk there into
   its own clip, and set each slide's `rate` so it fills its shot's span.
3. Text, white Montserrat Bold about 60 px: the hook above the slide (`y` ≈ 520) through shot 1, then
   captions below it (`y` ≈ 1350), built with **caption-video** from the word timestamps.
4. Hook variants: versions (**edit-video**) that swap only shot 1's clip.
5. Export only when asked (**edit-video**).
