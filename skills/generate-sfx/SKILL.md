---
name: generate-sfx
description: Generate and add sound effects for video ads with Seed Audio 1.0 through tools/generate-sfx.mjs. Use when a scene needs clicks, impacts, whooshes, ambience, product sounds, interface sounds, or other timed audio cues.
---

# Generate SFX

First look in the **shared library** (`workspaces/Shared/Library`, see **search-media**) for known
meme and stock sounds. Otherwise generate with **Seed Audio 1.0** via `tools/generate-sfx.mjs`.

## Plan the cue

One job per effect. Specify the source, action, texture, intensity, environment, duration, and
ending — the literal sound, not its emotional label.

Good: `One soft laptop-key click, close-miked, dry office room, no reverb, 0.3 seconds.`

Weak: `A satisfying work sound.`

Generate effects separately when their timing will be edited independently. Keep them isolated: no
speech, no music, no extra ambience unless the scene needs it.

## Generate

```bash
node tools/generate-sfx.mjs \
  --prompt "A small wooden cap clicks onto a glass bottle, close-miked, clean and gentle" \
  --duration 1 \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/sfx/cap-click-a.mp3
```

Keep alternate takes with letter suffixes. Listen for invented layers, excess reverb, an unclear
transient, and an ending that can't be cut cleanly. Approved reusable sounds go into the shared
library (or the brand's, if brand-specific); one-off cues stay in the ad's folder.

## Place

Each effect is an audio clip on the edit document's SFX track (**edit-video**), starting a beat
before its action. `node tools/edit-video.mjs moves <edit.json> --from <s> --to <s>` lists where the
picture moves most, to find the actions; check them on a `frames` sheet.
