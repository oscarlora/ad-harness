---
name: make-ai-song
description: Make an AI song video ad — a sung song (Suno) is the whole audio, animated clips act out each line, and word-by-word captions let people sing along. Use whenever someone wants an AI song ad, a singing ad, a jingle-style or music-video ad, or says "make a song ad". Covers concept, lyrics, the song and its word timings, character sheets, storyboard sheets, MiniMax clips, the edit (Palmier Pro or ffmpeg), captions, versions, and delivery.
---

# Make AI song

The song carries the whole pitch; the video just acts it out. Nobody lip-syncs: the singer is the
narrator and the characters act. Every cut lands where a sung line starts. Steal from a swipe file
of song ads that work, if the user has one.

Go step by step. Show what you made at every step and wait for a yes before spending money on the next.

## 1. Concept

Load the product's research files and the brand's `inputs/feedback.md` (**capture-feedback**).
Pick the persona and angle first. Song ads work best on emotion, so default to the brand's most
emotional persona (grief, identity loss) unless told otherwise. Then give 3 concepts, each stealing
one move from the swipe file: a specific age in the first line, a named villain, a story told
backwards, small concrete scenes (a 3am clock, a soaked shirt).

## 2. Lyrics

Follow **write-copy** for voice and claims. Song-specific rules:

- **Length:** about 110–130 sung words gives a 2-minute mid-tempo song. Suno sets the length itself
  and ignores "short" or a BPM, so change the word count, not the prompt.
- **One line = one shot**, and every line must be easy to picture.
- **The first line is the hook:** a person, an age, a moment ("I found a photo of me at thirty-nine").
- **The product enters in someone's words**, a friend or a grandma, named once as brand + category.
- Show the full lyrics after every change. Never generate until they're approved.

## 3. Song

    node tools/generate-music.mjs --lyrics <ad>/music/lyrics.txt --title "<Title>" \
      --prompt "heartfelt mid-tempo pop ballad, 100 BPM, intimate warm female alto vocal, piano and soft drums, strings lift at the final chorus, vocal on the first beat" \
      --out <ad>/music/song-suno.mp3

Each run gives two takes and Suno's own timing for every word. The user picks by ear. Then cut it
to the sung part (with a 5 s outro and a 3 s fade) and write the timings:

    python3 tools/song-edit.py timing --take <ad>/music/song-suno.mp3 --lyrics <ad>/music/lyrics.txt --out <ad>/music/song-final.mp3

Use Suno's timings. Transcribing singing (Gemini, Palmier) drops and mishears lines.

## 4. Look

1. **Hero sheet:** the main character, three angles on one sheet, plus any other age the story needs.
   Show 3 styles (for example Pixar-like, DreamWorks-like, storybook 3D) and let the user pick.
2. **Cast sheet:** everyone else on one sheet, generated with the hero sheet as the style reference.
3. **Product:** never generated; crop it into `sheets/product.png` per **write-prompt**'s product rules.

## 5. Storyboard

Group the lines into clips of up to 15 s (MiniMax's limit), cutting only where a line starts. Split any
line longer than about 6 s into two shots. Make one storyboard sheet per clip, with its shots as
vertical 9:16 panels: three in a 16:9 row, four as a 2×2 grid in 9:16, two side by side in 1:1.

No text in the pictures. References by number, who's in frame, no mirrors and the `--ref` array:
**write-prompt**'s "How a model reads a prompt".

## 6. Clips

One MiniMax H3 Max run per clip, at 480p, with the storyboard sheet and the character sheets as
reference images (where that runs: **write-prompt**, Video models).

    node tools/generate-video.mjs --prompt-file <ad>/prompts/clip-01.txt --image <sheet> --image <hero> \
      [--image <cast>] [--image <product>] --aspect 9:16 --resolution 480p --duration <clip length, rounded up> \
      --out <ad>/clips/clip-01.mp4 --timeout 1500

The prompt lists the shots with rough timings ("Shot 2 (5.1–9.9s): …"). It ends with the rules: match
each panel, hard cuts, never show the sheet or its gutters, no text, nobody speaks or sings.
Every sheet, storyboard and clip prompt follows **write-prompt**'s "How a model reads a prompt".
Check every clip before editing. To fix one bad shot, make a new still for it, then animate it
alone (`--first-frame <still> --duration 6`), instead of regenerating the whole clip.

## 7. Edit

In Palmier Pro, or with **edit-video** without it (which, plus Palmier's connection and pitfalls:
**edit-video**, Editor).

1. Create the project: 9:16, 1080p, 30 fps. Import the song and the clips.
2. Place the shots: write a plan (`{"clips":[{"file","starts":[song seconds of each shot],"end"}]}`), then

       python3 tools/song-edit.py shots --plan <ad>/shots.json --out <ad>/shots-placed.json

   Add each entry with `add_clips` (`includeAudio: false`). Where `rate` is below 1, slow the shot
   with `edit_speed`. Let the last shot run to the end of the outro, slowing it if needed. Then read the
   timeline back to confirm there are no gaps, and look at a few frames.
3. Captions (rules in **caption-video**):

       python3 tools/song-edit.py captions --timing <ad>/music/song-final.mp3.timing.json --out <ad>/captions.json

   Make one `add_texts` call per slot, each on its own new track. The song's look: Permanent Marker,
   white with a black outline, centered, one line of up to 4 words, and the sung word yellow and
   bigger. If the font is missing, ask before downloading it from github.com/google/fonts. Palmier's
   own `add_captions` mishears singing, so don't use it.

**With edit-video:** each placed shot is a timeline entry (`trim` = its `source`, `speed` = its
`rate`), the song is the only sound (strip the clips' audio, song as the music block; see
**edit-video**'s limits), and captions are **caption-video** events timed from Suno's words. The
yellow sung word isn't possible there yet.

## 8. Versions

Copy the timeline (`create_timeline` with `from`; with edit-video, a second plan) and change one
thing, usually the hook.

## 9. Deliver

Export 1080p H.264 into the ad's folder as `<id>_V<n>_…mp4`, format `Song` (naming in
**write-prompt**). Follow the brand's handoff template if it has one (e.g.
`inputs/brief-templates.md`) and update the ad's record. Clips stay 480p drafts until the ad is
approved; a higher tier only when the user asks (AGENTS.md, quality ladder).
