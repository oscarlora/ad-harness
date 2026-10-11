---
name: edit-video
description: Assemble and revise a video ad in the harness's own editor — an edit document (outputs/<ad>/edit.json) that Studio previews live and tools/edit-video.mjs exports to MP4 with the same engine. Use when cutting rendered clips into a finished video, adding the hook, captions, music, sound effects, transitions, zooms, color or an end card, applying the user's review notes from Studio, or exporting ("tighten the pacing", "fade between these", "grade them to match", "duck the music", "export it").
---

# Edit video

An ad's edit is one JSON document, `outputs/<ad>/edit.json` (a version the user keeps, such as a
second hook, is `edit-v2.json`, `edit-v3.json`…). Studio's Workflow page shows it live in the ad's
**Edit** step: preview, timeline, review notes and an Export button. Change the document and the
preview follows within a second. Schema, flags and every subcommand: `node tools/edit-video.mjs --help`.

## Build

1. **Gather:** clips in `clips/`, voiceover, music (**add-music**), sound effects (**generate-sfx**),
   product graphics (**search-media**). A higher-tier final needs clips generated at that tier
   (AGENTS.md, Video).
2. **Write the document:** tracks top to bottom (hook and text, captions, video, voice, music, SFX),
   every time on the timeline clock. Clips trim with `in`, play at `rate` and get `transition`s.
   Anything that changes over time (zoom, volume, saturation…) takes keyframes.
3. **Captions:** `captions --words <transcript or song timing>` writes word-timed lines (**caption-video**).
4. **Check:** `check` (missing files, black gaps). `frames --at …` makes a contact sheet when you
   need to see a moment.
5. **Show it** right away: point the user to the ad's Edit step in Studio (**open-studio**).

## Revise: live review

The user leaves notes on the preview (a moment, optionally a box on the frame). Work through them as
they come:

1. `node tools/edit-video.mjs comments outputs/<ad> --wait` as a tracked background command: it
   returns the open notes (and marks them seen) the moment there is one, each with what was on
   screen then and a contact sheet of the moments with the marked spots outlined.
2. Look at the sheet: the box says which word, face or object the note means. Make each change on
   what it's about: a clip's look on the clip (it then starts and ends with it), keyframes only for
   change over time, timed to cuts or word times, never by ear.
3. When a change moves or retimes something (a cut, a keyframe, a position), check one `frames`
   sheet for the whole batch at the first and last frame of each change and just outside it. A
   change of wording, color or volume needs no sheet.
4. `comments outputs/<ad> --done <id> --reply "<what changed, in a few words>" --span <from>-<to>`
   (the changed stretch, which Studio's watch button plays). The user watches it and approves it,
   which moves it to the note history, or leaves a new note.
5. Start the wait again.

Notes are one file each in `outputs/<ad>/comments/`, in the language the user writes in; reply in it.

## What to reach for

- **Cuts and pacing** — shots on the voiceover's lines (`place`); `cut` removes a stretch (a pause,
  a line) from every track and closes the gap, captions and keyframes included.
- **Transitions** — `transition` on the incoming clip. Hard cuts by default; fade for a mood shift, a
  directional slide, push or wipe for a jump in place or time; zoom, blur and flip sparingly.
- **Zooms** — keyframe `scale` with an `origin` on the subject: on one clip, or on the track's
  `transform` for punch-ins across cuts (1.06–1.10 on the key words, a handful per 30 s).
- **Color** — `match` grades every clip toward the median look (`--ref` toward one clip); `grade`
  takes exposure, contrast, saturation, temperature, grain, vignette, each keyframable.
- **Sound** — music about −18 dB under speech; `duck` dips a track under speech (`--speaker` for one
  voice in a transcript); `moves` lists where the picture moves, for sound effects on actions.
- **Text** — hook and end card as `text` / `rect` / `image` clips with `enter`/`exit` animations.
  Every graphic sits in clear space, never over a face or the caption band.
- **Other placements** — `reframe --size 1080x1350` (4:5) or `1080x1080` into a new version, then
  check its text on a `frames` sheet.
- **Anything else** — the ad's own `fx.js` (custom layers, transitions, animations; the contract is in
  `studio/engine/draw.js`). Something a second ad needs moves into the engine.

## Export

`node tools/edit-video.mjs export outputs/<ad>/edit.json` (or the user's Export button): H.264 + AAC at
−14 LUFS into `final/<id>_V<n>_…mp4`, about 20 s for 80 s of 1080p. `--scale 0.5` makes a quick
draft, `--from`/`--to` a section. Never grade your own render; hand over the path.

With R2, final cuts are heavy files a plain push skips: push with
`node tools/sync-brand.mjs --push workspaces/<WS>/<Brand> --originals`.
