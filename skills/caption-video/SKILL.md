---
name: caption-video
description: Build the captions and hook text of a video edit — transcribe the cut to word timestamps, group them into caption lines with tools/edit-video.mjs captions, and style them (plain, karaoke, lyric, word by word). Use when a video ad needs captions or subtitles, someone asks for CapCut-style, karaoke, lyric or word-by-word captions, or burned-in text timed to speech, or when edit-video needs its captions.
---

# Caption video

Captions are a `captions` clip in the ad's edit document (**edit-video**): word-timed lines plus a
style. Time from the rendered audio, not the script.

## 1. Transcribe

`node tools/transcribe-media.mjs --in <voiceover or cut> --words` → word timestamps (flags in `--help`).
A song uses its Suno timing file (`<out>.timing.json` from `tools/edit-song.py`, e.g.
`music/song-final.mp3.timing.json`; **make-ai-song**).

- Words run on the **timeline clock**: a voiceover placed at 0 already is; otherwise transcribe an
  export of the cut.
- **No Gateway key** (the tool exits with a SKIP)? Use line-level timing: find the speech bounds
  with `ffmpeg`'s `silencedetect`, spread the script's lines across them as caption lines without
  word times, and tell the user the timings are approximate.

## 2. Group into lines

`node tools/edit-video.mjs captions <edit.json> --words <transcript> [--max 3] [--from <hook end>]`
breaks at punctuation, pauses and the word limit, and writes the lines into the Captions track.
Then fix by hand:

- **One idea per line.** Group by phrase, not count; the limit is a maximum, and a line never carries
  a word from the next idea ("steady energy" | "deeper sleep"). Split a long phrase where it still
  reads ("from" | "the root cause").
- **Text from the brand, timing from the transcript.** On-screen text follows **write-copy** and the
  brand's spellings and product names even when the spoken line differs: fix transcript errors and
  casing, keep the times.
- `--max 1` makes word-by-word captions.

## 3. Style

- **Default:** Inter Bold, white with a black outline, lower-center (`y` about 1250 on 1920);
  deviate only with a reason. Any Google font by name (`Archivo Black` for a heavier look).
- **Karaoke / lyric:** `active` styles the word being said (`color`, `scale` 1.2–1.3), `upcoming`
  the words still to come (`opacity` 0.5; 0 reveals them word by word); `enter: "pop"` per line.
- **Hook** (the opening on-screen line): a `text` clip, centered, `{braces}` around the words in the
  accent color. If it covers a face, the product or the scene's key object in any shot it spans,
  nudge it just enough to clear them; check a frame from each of those shots. Captions start only
  after the hook ends; the two never show at once.
- A workflow may set its own font and placement (song, slides); these rules still apply.
- **Brand font** (from `inputs/DESIGN.md`) only when a licensed font file exists in `inputs/media/brand/`: map it in the
  document's `fonts`. Never hunt the web for a brand's commercial font.
