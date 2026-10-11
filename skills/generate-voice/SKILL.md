---
name: generate-voice
description: Design and generate natural voiceovers with Gemini 3.8 Flash TTS or Seed Audio 1.0 through tools/generate-voice.mjs. Use when an ad needs narration, dialogue, a voice take, a pronunciation correction, a pacing change, or a designed speaker voice.
---

# Generate voice

`tools/generate-voice.mjs` sends a `--script-file` with one or two speakers to **Gemini 3.8 Flash
TTS** (the Gateway takes one speaker only). Raw prompts (`--prompt-file`), 3+ speakers and
`[DIRECTIVE]` lines switch to **Seed Audio 1.0** on Segmind automatically; `--model seed-audio`
forces it (e.g. to clone a `reference_audio`). Use `--model elevenlabs/...` (kie) only when a known
voice ID is required.

## Design the voice

For Gemini TTS, pick a prebuilt voice per speaker — `voice_name:` in the `--voices-file` block or
`--voice-name Kore,Puck` in speaker order (default Kore, then Puck); the `description` becomes the
delivery direction. Seed Audio voices are designed, not selected. Describe:

- where the speaker grew up and their accent, first and outright, with two or three concrete
  features of that accent (otherwise the model guesses from the name, face or setting);
- age and speaker persona;
- register and timbre;
- pace and rhythm;
- intonation and sentence endings;
- energy;
- one or two natural quirks (light vocal fry, small breaths). When the same description is pasted
  into many generations, keep only what must sound the same every time (accent, pitch, timbre, pace,
  energy); write a one-off sound (a gasp, a laugh) into the one line that needs it.

Describe natural human behavior, not vague labels like "conversational": speaks like a friend
explaining something across a table; takes small breaths at thought breaks; never sounds like an
announcer.

Prompt structure:

```text
voice:
A woman in her mid-30s with a low, warm alto voice and a General American accent.

delivery:
Natural and connected, with calm confidence, falling sentence endings, small breaths at thought
breaks, and no announcer cadence. About 4 words per second.

script:
The exact spoken copy goes here.
```

The script is verbatim. Over Seed Audio's 2,048-character limit, compress the voice and delivery
directions; never cut or paraphrase the spoken copy.

## Pronunciation

Write difficult words phonetically in the script itself (`tee-ong`, `ex-tah`), not only in a note.
Regenerate when it comes out wrong.

## Generate

One or two speakers (Gemini TTS):

```bash
node tools/generate-voice.mjs \
  --script-file workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-script.txt \
  --voice-name Kore \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-a.mp3
```

A raw scene prompt (Seed Audio):

```bash
node tools/generate-voice.mjs \
  --prompt-file workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-prompt.txt \
  --target-length 30 \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/voice/vo-seed1-a.mp3
```

For labeled dialogue, use `--script-file` plus `--voices-file` (add `--model seed-audio` for a
designed or cloned cast); formats in the tool's `--help`. Keep earlier takes with `-a`, `-b`, `-c`
suffixes. Show every take as it renders; the user picks by ear and calls any re-roll.
