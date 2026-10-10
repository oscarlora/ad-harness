---
name: add-sound-effects
description: Generate and add sound effects for video ads with Seed Audio 1.0 through tools/generate-sfx.mjs. Use when a scene needs clicks, impacts, whooshes, ambience, product sounds, interface sounds, or other timed audio cues.
---

# Add sound effects

First look in the **shared library** (`workspaces/Shared/Library`, see **search-media**): known
meme and stock sounds live there for every brand. Otherwise generate with **Seed Audio 1.0** through
`tools/generate-sfx.mjs`, on Segmind (the Vercel AI Gateway has no sound-effect models).

## Plan the cue

Give each effect one job. Specify the source, action, texture, intensity, environment, duration,
and ending. Describe the literal sound rather than its emotional label.

Good: `One soft laptop-key click, close-miked, dry office room, no reverb, 0.3 seconds.`

Weak: `A satisfying work sound.`

Generate effects separately when their timing will be edited independently. Keep them isolated:
no speech, no music, and no extra ambience unless the scene needs it.

## Generate

```bash
node tools/generate-sfx.mjs \
  --prompt "A small wooden cap clicks onto a glass bottle, close-miked, clean and gentle" \
  --duration 1 \
  --out workspaces/<WS>/<Brand>/outputs/<ad>/sfx/cap-click-a.mp3
```

Preserve alternate takes with letter suffixes. Listen for invented layers, excess reverb, an
unclear transient, and an ending that cannot be cut cleanly. Once approved, reusable sounds go into the
shared library (or the brand's library if brand-specific); keep one-off cues inside the ad output folder.
