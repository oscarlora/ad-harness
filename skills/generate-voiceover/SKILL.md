---
name: generate-voiceover
description: Design and generate natural voiceovers with Gemini 3.8 Flash TTS or Seed Audio 1.0 through tools/generate-voice.mjs. Use when an ad needs narration, dialogue, a voice take, a pronunciation correction, a pacing change, or a designed speaker voice.
---

# Generate voiceover

`tools/generate-voice.mjs` sends a `--script-file` with one or two speakers to **Gemini 3.8 Flash
TTS** (provider order: AGENTS.md; the Gateway takes one speaker only), with each voice from
`voice_name` / `--voice-name` and delivery from the speakers' `description`. Raw prompts
(`--prompt-file`), 3+ speakers and `[DIRECTIVE]` lines switch to **Seed Audio 1.0** on Segmind
automatically; `--model seed-audio` forces it (e.g. to clone a `reference_audio`). There, kie's
ElevenLabs is the outage fallback, or an explicit choice (`--model elevenlabs/...`) when a known voice
ID is required.

## Design the voice

For Gemini TTS, pick a prebuilt voice per speaker — `voice_name:` in the `--voices-file` block or
`--voice-name Kore,Puck` in speaker order (default Kore, then Puck); the `description` becomes the
delivery direction, so describe it as below. Seed Audio voices are designed, not selected. Describe:

- where the speaker grew up and her accent, first and outright, with two or three concrete features
  of that accent: a voice model otherwise infers the accent from the name, the face or the setting;
- age and speaker persona;
- register and timbre;
- pace and rhythm;
- intonation and sentence endings;
- energy;
- one or two natural quirks, such as light vocal fry or small breaths. When the same description
  is pasted into many generations (video clips), keep only what must sound the same every time
  (accent, pitch, timbre, pace, energy) and leave out one-off sounds (a gasp, a laugh, a sigh, an
  inhale): every generation performs them, so they pile up. Write a one-off sound into the one line
  that needs it.

Write performance direction that describes natural human behavior, not vague labels such as
“conversational.” For example: speaks like a friend explaining something across a table; connects
clauses fluidly; takes small breaths at thought breaks; never sounds like an announcer.

Use this prompt structure:

```text
voice:
A woman in her mid-30s with a low, warm alto voice and a General American accent.

delivery:
Natural and connected, with calm confidence, falling sentence endings, small breaths at thought
breaks, and no announcer cadence. About 4 words per second.

script:
The exact spoken copy goes here.
```

Treat the script as verbatim. When the Seed Audio prompt exceeds its 2,048-character limit,
compress the voice and delivery directions; do not cut or paraphrase the spoken copy.

## Pronunciation

Put difficult pronunciations directly into the spoken script in phonetic form. For example, write
`tee-ong` or `ex-tah` where those sounds must be spoken. Do not rely only on a pronunciation note.
Listen to the generated phrase and regenerate when it is wrong.

## Generate

One or two speakers (Gemini TTS) — save the script, then run:

```bash
node tools/generate-voice.mjs \
  --script-file workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-script.txt \
  --voice-name Kore \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-a.mp3
```

A raw scene prompt (Seed Audio on Segmind) — save the prompt, then run:

```bash
node tools/generate-voice.mjs \
  --prompt-file workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-prompt.txt \
  --target-length 30 \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-seed1-a.mp3
```

For labeled dialogue, use `--script-file` plus `--voices-file` (add `--model seed-audio` for a
designed or cloned cast); their formats are documented in the
tool header (`--help`). Preserve earlier takes with `-a`, `-b`, `-c` suffixes. Show every take as soon as it renders; the
user picks by ear (pacing, naturalness, pronunciation, missing words, stray music or effects) and
calls any re-roll.
