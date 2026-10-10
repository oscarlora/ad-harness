---
name: caption-video
description: Build the burned-in captions for a video edit — transcribe the rendered clips to exact word timestamps with tools/transcribe-media.mjs --words, group the words into caption events (2–4-word karaoke pace or one line per event), style them (Helvetica Neue Bold on macOS or Inter Bold elsewhere, a heavier CapCut-look Google font, or a licensed brand font), and hand the captions block to the edit plan. Use when a video ad needs captions or subtitles, someone asks for CapCut-style, karaoke, or word-by-word captions, or burned-in text timed to speech, or when edit-video needs its captions block.
---

# Caption video

Produce the `captions` block of an edit plan — timed events plus a style — for **edit-video** to
burn in. Timing truth is the rendered audio, not the script: generated speakers deliver on their
own clock, so transcribe what was actually rendered.

## 1. Transcribe

`node tools/transcribe-media.mjs --in <clip>.mp4 --words` → word timestamps (flags in the tool's
`--help`). The text comes from Gemini 3.1 Flash Lite via the Gateway (sentences, speakers, brand
spellings; a library clip reuses its catalog transcript); word timings come from Gemini 3.5
Transcribe via the Gateway, snapped to the speech energy.

- Caption events run on the **final timeline's clock**. Offset each clip's words by the clip's
  start on the timeline (minding trims) — or simpler, render the cut once without captions,
  transcribe that single file, and re-render with captions; re-renders are free.
- **No Gateway key** (the tool exits with a SKIP)? Fall back to line-level timing: take
  the script's lines, find the speech bounds with `ffmpeg`'s `silencedetect`, spread the lines
  across them, one line per event — and tell the user the timings are approximate, not
  word-accurate.

## 2. Group into events

- **Karaoke pace** — the default for ads: 2–4 words per event, split on the word timestamps, each
  event ending where the next starts. Snappy; holds attention.
- **One idea per event.** Group by phrase, not by count: the word limit is a maximum, and an event
  never carries a word from the next idea ("steady energy" | "deeper sleep", never "steady
  energy deeper"). Break at every comma and clause; a phrase over the limit splits where it still
  reads ("from" | "the root cause").
- **Simple look** — one script line per event, timed from the line's first word to its last.
- **Max 2 lines** per event, and keep events short enough that nothing wraps past that. Stay in
  the title-safe area: the tool's default lower placement and margins already are — don't push
  `marginV` toward the edge.
- **Text truth vs timing truth.** On-screen text follows the brand's text conventions
  (**write-copy**, plus the brand's spellings and product names) even when the spoken line
  differs — fix transcript errors and casing before they burn in; keep the transcript's timings.

## 3. Style

- **Default** — Helvetica Neue Bold on macOS (the system `.ttc`); elsewhere the tool falls back to
  Inter Bold, fetched from Google Fonts.
- **Heavier "CapCut look"** — a Google font by name, e.g. `Archivo Black` or
  `Montserrat ExtraBold`; the tool downloads it by name.
- White fill, black stroke, lower-center is the house default; deviate only with a reason.
- **Hook text overlay** (the opening on-screen line): centered. If it covers a face, the product
  or the scene's key object in any shot it spans, nudge it just enough to clear them; check a frame
  from each of those shots. Captions start only after the hook ends: the two never show at once
  (in a version with a new text hook, remove the captions under it).
- A workflow may set its own font and placement (song, slides); these rules still apply.
- **Brand font** only when a licensed font file exists in the brand kit (`inputs/media/brand/`) —
  point `fontfile` at it. Never hunt the web for a brand's commercial font.

## 4. Hand off

Give **edit-video** the finished `style` + `events` block for its plan (schema in
`tools/edit-video.mjs --help`); the caption text shows verbatim in that plan's sign-off.
