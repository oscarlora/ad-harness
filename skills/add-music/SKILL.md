---
name: add-music
description: Put a music bed under a video edit — source a track (user-supplied, copyright-free, or generated with tools/generate-music.mjs), choose the vibe against the brand voice, and set its levels (gain under dialogue, ducking, fades) in the edit document. Use when a video ad needs background music, someone asks to add or generate music, put a track under it, or gives music direction ("something upbeat"), or when edit-video wants a music bed.
---

# Add music

Put the track on the edit document's Music track (**edit-video**); the export sets the final
loudness. This skill owns the track and the taste.

## Sourcing

- **User-supplied, copyright-free, or generated only.** Never rip a commercial or trending track.
  If the user names one, ask for their licensed file or offer alternatives in the same vibe.
- **Store it findable.** A track the brand will reuse goes into the media library
  (**catalog-media**). A one-off can sit in `outputs/<ad-name>/`.
- **No track? Ship without** and say so — never block an edit on music.

## Generating

`tools/generate-music.mjs` renders a purpose-length instrumental bed with **Seed Audio 1.0** by
default, from the prompt and `--duration`. Use `--provider suno` only when the user explicitly wants
Suno, a full song, or a long-form track; it returns two full-length takes and `--duration` trims them.

- **Trend research first.** Browse TikTok Creative Center's trending sounds or a licensed library's
  viral charts, then translate the sound's anatomy (tempo, drum palette, bounce, vocal treatment)
  into the prompt. Never name artists or songs.
- **Prompt like a producer.** Micro-genre + BPM + production markers ("jersey club, 140bpm,
  sidechained 808s, pitched-up chops"), always ending "hook-first, loopable, no intro".
  Instrumental under dialogue: vocal chops fine, sung lyrics never.
- **Suno length.** Suno ignores length requests. For a short vocal song: tempo ≥140bpm, short
  `[Verse N]`/`[Outro]` tags, and `--negative-tags "intro, instrumental intro, vocalise intro,
  humming, vamp, ad-libs, repeated lines, instrumental break, long outro, fade out"`. The closing
  line lands in about a third of takes — roll several and check by transcript. Keep bracket tags
  short; long ones get sung.
- **3 differentiated rolls per brief**, shown side by side; the user picks.
- **Rights** follow the provider's terms; confirm them when the client asks or the stakes are high.

## Choosing

Match the vibe to the brand voice in the product's `-research.md` (Branding). With no direction,
offer 3 differentiated vibes. Under dialogue, prefer instrumental or vocal-light.

## Levels

- **A bed, not a lead** — the Music track's `volume` about -18 dB under dialogue; a few dB louder
  only where there's no speech.
- **Duck under speech** — `node tools/edit-video.mjs duck <edit.json> --track Music --words <transcript>`.
- **Fades** — `fadeIn` ~0.5 s and `fadeOut` ~1–2 s ending with the video, so the end doesn't sound
  like a cut.
