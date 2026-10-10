---
name: make-ai-animation
description: Make an AI animation video ad — an animated scripted scene (Pixar-like, stop-motion, claymation, anime and more), either narrated (a voiceover over characters who act it out, no spoken lines) or dialogue (the characters speak their own lines), or both. Built shot by shot — sheets lock the look, one approved still per shot, then the stills are animated. Use whenever someone wants an animated ad, a cartoon or Pixar-style ad, a skit or drama ad, a narrated animated story, or wants a scripted scene brought to life — even if they just hand over a script or a reference ad. Covers concept and style, script, voice, storyboard, sheets, frames, clips with their sound effects, and the edit (Palmier Pro or ffmpeg: captions, versions, export) or a handoff folder.
---

# Make AI animation

A scripted scene, animated. Two paths, decided in step 1:

- **Narrated:** a voiceover tells the story; the characters act it out and never speak. The voiceover
  comes first and sets every shot's timing; shots are grouped into multi-shot clips, and each clip
  carries its own sound effects.
- **Dialogue:** the characters speak their lines on screen, one clip per shot. **Both** (characters
  speak, a narrator talks over) follows the dialogue path and adds the narrator from the narrated one.

Every shot is approved as a still before it becomes a clip, so money goes only into motion the user
has already signed off. Go step by step: show what you made at every step and wait for a yes before
spending on the next. Work in the ad's folder, `outputs/<ad>/`: `script.md`, `storyboard.md`,
`voice/`, `sheets/`, `frames/`, `prompts/`, `clips/`, `audio/`, `drafts/`, `final/`. Keep replaced
takes beside the new ones with a letter suffix (`frame-03-a.png`, `clip-01-b.mp4`).

## 1. Concept

Who it's for and what it says: persona, angle, and the 2–4 claims it carries, from the product's
research files and the brand's `inputs/feedback.md` (as in **make-ai-podcast** step 1). If the brief
or a reference already sets them, they're locked; otherwise give 3 options for each. The product's own lines carry only signed-off
claims; bigger reactions ("she can't be fifty-nine") stay in the characters' mouths, never the
narrator's or the end card's. Settle the **path** (narrated or dialogue) here: it shapes the script.

Look for **one visual device that carries the angle** for the whole film, and let the solution break
it: a tired mom drawn as a juggler whose plates keep multiplying (overwhelm), who sets them all down
when the answer arrives. Use it only in the beats that are about it; other lines get their own picture.

Then lock the **style**. Offer 3 from this list that suit the persona and tone, unless the user named one:

1. **Pixar-like 3D** — warm, soft light, rounded faces, big expressive eyes.
2. **DreamWorks-like 3D** — punchier and cheekier: smirks, raised brows, comic timing.
3. **Claymation** — Aardman-like plasticine, thumbprints, slightly jerky stop-motion.
4. **Puppet stop-motion** — Laika-like (Coraline) felt, fabric and wood, handmade miniature sets; spooky works well here.
5. **Classic Disney 2D** — hand-drawn, clean ink lines, painted backgrounds.
6. **Ghibli-like anime** — soft watercolor skies, gentle, detailed everyday life.
7. **Spider-Verse comic 3D** — halftone dots, bold ink lines, on-twos motion.
8. **Painterly 3D** — Arcane-like, brushstroke textures over 3D forms.
9. **Flat 2D cartoon** — modern TV animation: simple shapes, bold flat color, thick outlines.
10. **Storybook** — soft 3D or 2D like a children's picture book, pastel and cozy.

## 2. Script

Locked if the brief has one, or if the user writes it: use it word for word (**write-copy**'s
user-written rule: grammar and flow only, raise unsupported claims once in chat). Otherwise write it
with **write-copy**.

- **Narrated:** one voice to the viewer, one line per idea, every line something you can picture.
  Pace and word count as in **write-copy** (Length).
- **Dialogue:** the craft in **make-ai-podcast** step 7 (open mid-conflict, short lines,
  interruptions, overheard, not written). Label every line `NAME (ROLE):`, narrator lines `VO:`.
  Same pace (**write-copy**, Length).

## 3. Voice

- **Narrated:** generate the voiceover now with **generate-voiceover**: 3 deliberately different
  takes (voice and delivery), the user picks by ear. Then take its word timings
  (`node tools/transcribe-media.mjs --in <take> --words`) and map each script line to its start and
  end: those times set the shots.
- **Dialogue:** the clips make the voices (step 7). Write a voice block per speaking character
  (checklist in **generate-voiceover**), opening with where she grew up and her accent, clearly
  contrasting so they read as different people, and paste it word for word into every clip prompt,
  under the same label. Lock the blocks before the first clip: change one later and that character's
  earlier clips no longer match. Even identical text only narrows the voice, so plan to even the
  voices out in the edit. **Both:** this, plus the narrator generated as above and laid in at the edit.

## 4. Storyboard

A numbered shot list in `storyboard.md`. Studio's Workflow page reads the **first table** in the file
as the shot list, so it comes first, with the columns `# | s | Line | What we see | Camera | Into the
next shot`; cast, symbols, blocking and direction go above it as notes, and any other table (clips,
sound) below it.

- **Shot length.** Narrated: cut where each line starts, on the voiceover's timings. A line that
  lists things gets a shot per item, cut on each word ("sharper focus, steady energy, deeper sleep");
  items that belong together share one frame and are emphasized one at a time on their words (three
  nutrients glowing in turn). Dialogue: one line = one shot, seconds = words ÷ 4 (**write-copy**'s
  pace), rounded up, minimum 4; fold quick back-and-forth in one setup into one shot; silent action gets its own shot.
- A brief's scene directions are the starting point, not the shot list: fill in a picture for every line.
- **Read the board as one story before any frame.** Each shot shows one thing, the thing its line
  says, as literally as possible. No two shots repeat a picture, heading or idea unless the repeat
  is the point (a callback: the juggled plates reappear stacked neatly on a shelf). A symbol
  keeps one meaning throughout, and a recurring character keeps one role. Say exactly who is in each
  shot. Name every setting and prop that recurs; step 5 makes a sheet for each.
- **Block each setting once**, above the shot table: where everyone stands, which way they face, and
  which side the camera stays on. Name each setting's first frame as its master.
- **Direct the motion.** One main camera move per shot, smooth like a motion-control rig. Every cut
  is motivated: the camera follows something (a thrown plate, falling coins, rising sparks, a whip
  pan) out of one shot and lands on it in the next. Keep one screen direction per side of the story (the
  problem moves right to left; once free, she moves left to right). Fast, never frantic: the thing
  to watch stays near the same spot in frame across a cut.
- **Narrated: plan the clips** in a table under the shots: consecutive shots grouped into clips no
  longer than the model allows (MiniMax H3 15 s, Seedance 2.5 30 s), whole lines only, never part of one.
- **Sound effects**, effects only: each shot's sounds, specific to its action and timed to it (a
  lamp clicking on, a plate clattering, a jar into a paper bag). A sound that recurs is described in
  the same words every time, so it comes out alike. No music, voices or ambience.

## 5. Characters, settings and props

Make a sheet for every character, setting and prop that appears in more than one shot, before any
frame. Anything in a single shot is described in that frame's prompt instead.

1. **Hero first, alone:** the main character in the locked style (front, three-quarter, side, full
   body, a few expressions). The user approves it as the style lock before any other sheet is made.
2. **Then the rest, in parallel**, each with the hero sheet as style reference: one sheet per
   recurring character (varied in age, build and skin tone when the brief asks), one per recurring
   setting (a wide shot plus the reverse angle), and props that must match.
3. **Props that stand for an idea carry their word** when a word reads faster than a symbol:
   three jars labeled FOCUS, ENERGY, SLEEP, spelled exactly as given. Otherwise no text on sheets.
4. **The product is never generated:** crop it into `sheets/product.png` per **write-prompt**'s
   product rules. Nobody presents it to the camera: she shows it to the people she's talking to, or
   holds it beside her face in a narrated close.

    node tools/generate-image.mjs --prompt-file <ad>/sheets/<name>.txt [--ref <ad>/sheets/hero.png] \
      --aspect 16:9 --resolution 2K --out <ad>/sheets/<name>-a.png

Generate each sheet once and show it; reroll only what the user rejects.

## 6. Storyboard frames

One 9:16 still per shot: its opening moment, generated from the sheets of everyone and everything in
it. Make each setting's master first, then the rest in parallel with the master as a reference.

    R=(); R+=(--ref <ad>/sheets/hero.png); R+=(--ref <ad>/sheets/<setting>.png)
    node tools/generate-image.mjs --prompt-file <ad>/frames/frame-01.txt "${R[@]}" \
      --aspect 9:16 --resolution 1K --out <ad>/frames/frame-01.png

- References by number, who's in frame, no mirrors and the `--ref` array: **write-prompt**'s "How a
  model reads a prompt".
- **Draw the moment the clip starts from**, and only what the clip can animate from: whoever speaks
  first is about to talk, a body in motion is caught where the motion begins, and anything the
  action needs is already there (the jars already on the counter, the cup already in her hand).
  The clip can't bring in what the frame lacks (step 7).
- **The product:** `sheets/product.png` goes first in the references, label to the camera, placed
  as-is with only the scene's light and material on it (**write-prompt**'s product rules).
- **Each frame picks up where the previous shot ends.** A cut changes the camera, never the moment:
  poses, hands, gaze, what each person holds and who is mid-action carry straight across. Once the
  previous clip exists, pass its last frame as a reference for continuity only ("match the poses,
  hands, gaze and expressions; do not copy its framing"). The new shot changes size or angle
  clearly (a full step, or about 30°), given in absolute terms ("from the collarbones up, the two
  heads fill most of the frame") plus "much closer than reference image 1". A gesture a line calls
  for happens in the clip on its word, never pre-set in the frame. If an earlier shot is
  regenerated, recheck the cut after it.
- Pass the setting's master frame as a reference too. Once a character's look is set in an approved
  frame, that frame outranks her sheet. Restate each character's defining wardrobe in every frame prompt.
- Before showing a scene's frames, check them against the blocking and each other (seats, screen
  sides, camera side, eyelines, wardrobe, props, light) and against step 4's one-story rules.
- No text beyond prop labels and the product.

Show the frames scene by scene in table rows. The user approves each one; reroll only the ones flagged.

## 7. Clips

Every clip prompt follows **write-prompt**'s "How a model reads a prompt", above all **animate from
the frame, not against it**: simple, physically easy motions (point, pick up, lift, turn, straighten,
light up), one clear beat after another, each timed to its word, and plenty of them so the shot
stays busy. Each prompt stands alone, written like a director's notes:

- **TASK:** animate the frame(s) for N seconds in their exact style; don't redraw, restyle or relight.
- **CAMERA:** the move, its feel and where it ends up, with timings.
- **WHO IS WHO:** each person by position and look, since the frame may not match the storyboard.
- **ACTION:** a timeline of beats, each tied to a second (the word's time minus the clip's start). When
  several people act in turn, only one moves at a time and the others stay still. Nothing repeats,
  nobody freezes at the end.
- **SOUND:** only this shot's sounds, placed in time. Nothing that has to carry across cuts: no music,
  no crowd chatter, no room tone or ambience; say so in the prompt.

**Narrated:** MiniMax H3 Max, or Seedance 2.5 for chunks up to 30 s (where each runs:
**write-prompt**, Video models). One run per planned clip, its shots' frames passed in order
as `--image` refs, then the sheets of who's in it (9 images at most on MiniMax). The prompt lists
`SHOT n (a–b s), image n:` with a hard cut at each, and SOUND carries the effects, so every clip
comes back with its own sound. Name each clip after its first shot
(`clips/clip-07.mp4` covers shots 07–12). Run independent clips in parallel (long renders:
AGENTS.md, operating principles).

    node tools/generate-video.mjs --model minimax-h3-max --prompt-file <ad>/prompts/clip-07.txt \
      --image <ad>/frames/frame-07.png --image <ad>/frames/frame-08.png --image <ad>/sheets/<setting>.png \
      --aspect 9:16 --duration <clip seconds, rounded up> --out <ad>/clips/clip-07.mp4 --timeout 1500

**Dialogue:** one Seedance 2.5 run per shot at 480p, starting from its frame; it makes the voices
and sound too (Seedance 2 Mini is the budget fallback). Leave `--aspect` off (the 9:16 frame sets
the shape).

    node tools/generate-video.mjs --prompt-file <ad>/prompts/clip-01.txt \
      --model seedance-2.5 --first-frame <ad>/frames/frame-01.png --resolution 480p \
      --duration <shot seconds> --generate-audio --out <ad>/clips/clip-01.mp4 --timeout 900

Dialogue prompts add two sections:

- **LINES:** who speaks, the exact words, roughly when, and who stays silent (off-screen voices
  included). Direct the delivery of any line the script means a certain way, syllables included
  ("slower and louder, hitting each syllable: FIF-TY-EIGHT"). Tag every line with the speaker's
  position and look (`LEFT, green dress:`). Introduce a very short line as speech ("she says the
  single word 'Stop.'"). An off-screen voice gets lip-synced onto whatever mouth is visible, so keep
  every on-screen mouth closed while it speaks and describe it as coming from behind the camera. In
  a shot where someone else talks, the listeners make no sound at all (a gasp makes her a voice, and
  she may get the lines), and the prompt says so. Breaths written into the action come out audible.
  The speaker's face is at least as open to the camera as any listener's: get there by placing the
  camera on her listeners' side, never by turning her.
- **VOICES:** the step 3 blocks, word for word, for whoever speaks.

**Show each clip as it lands**, with a preview that mixes the clip's own sound, the voiceover span and
the music under it, so the user hears the effects. When one shot misses, troubleshoot its prompt the
way **write-prompt** says and regenerate **that shot alone** from its frame (`--first-frame`, at least
the model's minimum length; fix the frame first when the frame set it up), then splice it in at the
clip's real cut; keep the shots that worked. Clips stay at the draft tier until the ad is approved
and the user asks for a higher one (AGENTS.md, quality ladder).

## 8. Edit

Ask whether to edit here or hand off.

**Here:** in Palmier Pro, or with **edit-video** without it (which, plus Palmier's connection and
pitfalls: **edit-video**, Editor). 9:16, 1080p, 30 fps. The steps below are written for Palmier;
with edit-video, each placed shot is a timeline entry (`trim` = its `source`, `speed` = its
`rate`), and the voiceover, `sfx.wav` and music go in premixed as one track (**edit-video**'s
limits), so dialogue sound design can't be done there yet.

- **Narrated: place every shot on its line.** Plan each clip's shot starts in voiceover seconds, then

      python3 tools/song-edit.py shots --plan <ad>/shots.json --out <ad>/shots-placed.json --scene 0.15 --max-rate 1.35
      python3 tools/song-edit.py sfx --placed <ad>/shots-placed.json --out <ad>/audio/sfx.wav

  `shots` finds each clip's real cuts and fits every shot to its line (slowed, or sped up to 1.35×
  so an action at its end still plays, trimmed beyond that); check its shot-count warnings by eye.
  Add the shots one at a time on the Main track (`includeAudio: false`), each followed by its
  `edit_speed`. When an action still lands off its word (people moving in turn), measure when it
  happens in the clip (frame differences per region) and retime the still stretches between the
  actions, never the actions themselves. Tracks: Main, Voiceover, Music (**add-music**; about
  −18 dB, a 2 s fade out), SFX (`sfx.wav` at 0 dB; any extra effect: **add-sound-effects**).
- **Dialogue: sound design** treats the film as one place heard from different spots. First audit
  every clip's audio (Gemini, as in **catalog-media**): clips often bake in music and chatter despite
  the prompt, and invent lines in silent shots. Then build four stems lined up to the timeline:
  dialogue (voice-isolated where anything is baked in: ElevenLabs `POST /v1/audio-isolation` with
  the workspace's `<WS>_ELEVENLABS_API_KEY`; invented lines muted; every shot leveled to one
  loudness), ambience (one bed per location from the same
  recording, filtered for distance, crossfading at location changes; conversations sit "far" so the
  lines carry), music (one diegetic track, muffled by distance, ducked gently under dialogue: about
  3:1, a quarter-second attack, 1.5 s release) and SFX for transitions only (**add-sound-effects**).
  Leave about −15.5 LUFS and 0.5 dB of peak headroom; put the stems on named tracks of a copy of the timeline, the clips'
  own audio muted.
- **Hook and captions:** **caption-video**.
- **Versions:** copy the timeline (`create_timeline` with `from`) and change one thing, usually the hook.
- While a Palmier edit is in progress, update Palmier only; for a quick look, render a draft with
  ffmpeg into `drafts/`. Export (H.264, 1080p) into `final/` as `<id>_V<n>_…mp4` only when the user asks.

**Hand off:** one folder with the clips in order, the frames, sheets, voiceover, script, storyboard
and a short edit note (order, end card, music, captions); deliver it with **sync-to-drive** and
**write-handoff**.

Then record the ad (`tools/record-ad.mjs`, as in **make-ai-podcast** step 10) and follow the brand's
handoff template if it has one (e.g. `inputs/brief-templates.md`). Naming follows **write-prompt**
with format `Animation`. Renaming an ad later means renaming its folder and files, re-linking
Palmier (**edit-video**'s pitfalls) and removing the old folder from R2.
