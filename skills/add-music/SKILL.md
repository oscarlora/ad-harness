---
name: add-music
description: Put a music bed under a video edit — source a track (user-supplied, copyright-free, or generated with tools/generate-music.mjs), choose the vibe against the brand voice, and set the music block's levels (gain under dialogue, ducking, fades) for the edit plan. Use when a video ad needs background music, someone asks to add or generate music, put a track under it, or gives music direction ("something upbeat"), or when edit-video wants a music bed.
---

# Add music

Produce the `music` block of an edit plan for **edit-video**. The tool does the engineering —
sidechain ducking under the dialogue and loudness-normalizing the master (see
`tools/edit-video.mjs`'s header); this skill owns the track and the taste.

## Sourcing

- **Three clean paths: user-supplied, copyright-free, or generated.** Never rip a commercial or
  trending track — an unlicensed song in a client's ad is a copyright claim waiting. If the user
  names one, ask for their licensed file or offer alternatives in the same vibe (generated
  included).
- **Store it findable.** A track the brand will reuse — supplied or generated — goes into the
  brand's media library: ingest it (**catalog-media**) so **search-media** finds it next time. A
  one-off can sit ad-local in `outputs/<ad-name>/`.
- **No track? Ship without.** Render with no music block and say so plainly — never block an edit
  on music.

## Generating

`tools/generate-music.mjs` renders beds with **Seed Audio 1.0 by default** on Segmind (the Vercel AI Gateway has no music models). It generates a
purpose-length instrumental bed from the prompt and `--duration`. Use `--provider suno` only when
the user explicitly wants Suno, a full song, or a long-form track; Suno returns two full-length
takes and `--duration` trims them.

- **Trend research first.** Browse TikTok Creative Center's trending sounds (public) or a
  licensed library's viral charts, then translate the trending sound's anatomy — tempo, drum
  palette, bounce, vocal treatment — into the prompt. Never reference artist or song names:
  murky rights, and Suno's word filter rejects them.
- **Prompt like a producer.** Micro-genre vocabulary + BPM + production markers ("jersey club,
  140bpm, sidechained 808s, pitched-up chops"), always ending "hook-first, loopable, no intro" —
  the slow stock-music intro is the boring tell. Instrumental under dialogue (the tool's
  default): vocal chops fine, sung lyrics never.
- **Suno length.** Suno has no length control and ignores "under 60 seconds". For a short vocal
  song: tempo ≥140bpm, short `[Verse N]`/`[Outro]` structure tags, and `--negative-tags "intro,
  instrumental intro, vocalise intro, humming, vamp, ad-libs, repeated lines, instrumental break,
  long outro, fade out"` (takes drop from ~1:15–1:45 to ~0:50–1:10). The closing line lands in about
  a third of takes — roll several and check by transcript. Keep bracket tags short; long ones get
  sung.
- **3 differentiated rolls per brief, the user picks.** Roll three deliberately different
  directions and show them side by side — never grade the rolls yourself.
- **Rights.** Generated-track commercial rights follow the selected provider's terms. Confirm the
  current terms when the client asks or the stakes are high.

## Choosing

Pick the vibe against the brand voice descriptors in the product's `-research.md` (Branding) —
energy, genre, mood, in a few words. When the user hasn't set a direction, offer 3 deliberately
differentiated vibes. Under dialogue, prefer instrumental or vocal-light: sung lyrics fight spoken
lines.

## Levels

- **A bed, not a lead** — default `gain_db` -18 under dialogue; a few dB louder only when a
  stretch has no speech.
- **Keep ducking on** (`duck_db`) so the music dips under every spoken line on its own.
- **Fades** — a short fade-in (~0.5s), a longer fade-out (~1s) timed so the music ends together
  with the video: the tool trims the track to the timeline, and the fade-out is what keeps that
  trim from sounding like a cut.
