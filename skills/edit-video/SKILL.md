---
name: edit-video
description: Assemble the final video ad from rendered clips — in Palmier Pro on macOS when it's installed, otherwise with an edit-plan JSON (clip timeline with trims and punch-in zooms, product-graphic overlays, burned-in captions, a music bed, a finishing grade) and render it in one ffmpeg pass with tools/edit-video.mjs. Use when assembling, stitching, or cutting generated clips into a finished video, finishing a podcast ad in the harness (make-ai-podcast's self-edit route), adding the product graphic, captions, or music to footage, or revising a cut ("tighten the pacing", "move the overlay", "add grain"). Captions come from caption-video, music from add-music; a revision is a JSON tweak plus a re-render — seconds, free.
---

# Edit video

## Editor: Palmier Pro or ffmpeg

**Palmier Pro** (a Mac video editor the agent drives over MCP) is the recommended editor on macOS
when it's installed; the song, animation and slides workflows are written around it. Without it,
and always on Windows or Linux, edit with this skill's ffmpeg plan (the rest of this file). Every
video workflow's edit step points here.

**Connect.** If the Palmier tools aren't connected, open the app (macOS: `open -a PalmierPro`) and
talk to `http://127.0.0.1:19789/mcp` directly. Start with `initialize`, keep the `Mcp-Session-Id`
header, then `tools/call`; replies come back as SSE `data:` lines.

**Pitfalls** (they hold for every Palmier edit):

- **Track indexes shift** when text tracks are added on top; read `get_timeline` and target tracks by
  name or id before any `trackIndex` edit, or a clip lands on the hook's track and overwrites it.
- **`add_clips` may report the clip it trimmed**, not the one it added: read the new clip's id back
  from the timeline by its start frame before `edit_speed`.
- **`edit_speed` ripples** the clips right after it and refuses when they have no room: add and speed
  shots one at a time, in order. `swap_clip_media` can reset a clip's volume; set it again.
- **Media is linked by path.** Renaming or moving a file or folder breaks the project: import the new
  path and `swap_clip_media` every clip that used it, in every timeline, then delete the old assets.
- One text box takes one color: to color one line of a hook, make each line its own text box.
- **The user edits in the app too.** A setting that changed since your last write is theirs: never
  restore it on your own. Re-read the timeline before each change and ask if something looks off.

**What the ffmpeg plan can't do yet.** Its sound is the clips' own audio plus one music bed: no
separate voiceover, song or SFX track, and no muting a clip. Until it can, strip the clips' audio
(`ffmpeg -i in.mp4 -an -c:v copy out.mp4`), premix voiceover or song, SFX and music into one track,
and pass that as the music block with `gain_db` 0 and `duck_db` 0. Captions take one style: no
highlighted active word, and no second text style (render the hook as a PNG overlay instead).

## The ffmpeg plan

Turn rendered clips into the finished ad through one **edit-plan JSON**: the clip timeline (trims,
zooms), still overlays, burned-in captions, a music bed, and a finishing grade, rendered in a
single ffmpeg pass by `tools/edit-video.mjs`. The plan schema and flags live in the tool's header
and `--help` — read them there. The economics drive the workflow: generation costs money, the edit
costs nothing — a revision is a JSON tweak and a re-render measured in seconds, so iterate freely.

### Procedure

1. **Gather inputs.** The rendered clips sit in the ad's working folder (`outputs/<ad-name>/`).
   Product graphic or brand footage to overlay: **search-media**. Captions: **caption-video**.
   Music, if the ad wants any: **add-music**. A higher-tier final needs source clips generated at
   that tier — never a resize or upscale of 480p drafts (AGENTS.md, video quality ladder).
2. **Build the plan** at `outputs/<ad-name>/edit-plan.json`, applying the craft rules below —
   **one plan per ad, edited in place**: no versioned copies, no variant plans (a version the
   user keeps, such as a second hook, gets its own plan and output); a transient A/B pair gets
   deleted the moment the user picks. Relative paths resolve against the plan's
   directory; `output.path` is `edit-final.mp4` — the single canonical render, overwritten on
   every iteration (the ad's folder name already carries **write-prompt**'s filename convention).
3. **Show the plan; the user signs off.** A readable summary in chat, never raw JSON: a timeline
   table (clip · trim · zoom · seconds), the caption text **verbatim**, and the overlay, music,
   and finish choices. `--dry-run` sanity-checks the plan without writing anything. Render only
   after the sign-off.
4. **Render** with a generous timeout: `node tools/edit-video.mjs --plan <…>/edit-plan.json
   --timeout 1800` (how to run long renders: AGENTS.md, operating principles).
5. **Verify silently.** `ffprobe` the output — duration, streams, resolution — and hand over the
   path. No frame extractions, no QA images, no QA pass of any kind unless the user explicitly
   asks to see frames; the speed of the iteration loop wins. The user judges the render itself;
   never grade your own.
6. **Revise.** Every note maps to a plan tweak — retime a caption, nudge an overlay, cut a beat —
   then re-render over the same `edit-final.mp4`. Delete superseded takes and renders as the user
   replaces them — the working folder stays lean; R2 and the ad record carry history. Loop until
   approved.

### Craft

- **Pacing** — cut on the dialogue's beats and trim dead air at clip heads and tails; the word
  timestamps from **caption-video**'s transcript mark the exact cut points. Hard cuts stay the
  default for podcast-style ads; where a beat needs softening, a `transition` earns its place at
  0.12–0.2s (fade for a mood shift, a directional wipe for a location/time jump) — much longer
  reads as slow, not smooth.
- **Punch-ins** — `zoomEvents` on emphasis beats: the key claim, a reaction, the payoff, aligned to
  the claim word via the clips' transcripts. Subtle wins: `to` 1.06–1.10; stronger reads as a
  glitch, not emphasis. A handful per 30s at most — every beat punched is no beat punched.
- **Slow-mo** — a product beat (the pour, the unboxing, the reveal) can drop to 50–70% `speed`;
  much slower starts to look like a technical glitch rather than a deliberate hold.
- **Stills as motion** — a still used as b-roll (product shot, screenshot) wants Ken Burns
  (`zoom` at 1.03–1.08 drift) instead of sitting frozen — as a full timeline segment or an overlay,
  either way barely-there drift reads as intentional, anything faster reads as an effect.
- **Overlays** — every graphic overlay (product, hook text, stat pop-ups, badges) goes in clear
  negative space: never over a face, never over the caption band. Legible at thumbnail size but
  supporting, not dominating; a short fade in/out (~0.2s) keeps it from popping on, and a graphic
  entering the frame reads better sliding in (`slideIn`, ~0.3s) than appearing on the spot. When two
  overlays meet with zero gap, drop the earlier one's `fadeOut` and the later one's `fadeIn` at that
  seam — otherwise both cross alpha 0 together and the layer beneath flashes through. A transparent
  overlay PNG must actually carry alpha: `ffprobe` its `pix_fmt` (`rgba`), don't trust the command.
  **design-ad**'s legibility and hierarchy principles apply on video exactly as on image.
- **CTA end card** — bake it as one designed still, never a caption event over a product shot (the
  plan has one caption style, built for footage, so it goes illegible on a light card). Compose it
  in one ffmpeg pass: logo top, real product photo centre, headline in near-black and CTA in a
  darkened brand color at the bottom, with real side margin (on 1080 wide, ~62px for a seven-word
  line; 74px overran). `drawtext` needs `expansion=none` or a `%` in the copy errors. Save as PNG —
  JPEG rings around a logo on flat white. Run it as a plain still with a 1.0→1.05 Ken Burns.
- **Finish** — a light pass takes the AI edge off: grain 0.2–0.4 plus a light contrast touch.
  It should read as footage, not a filter.

## After approval

Final cuts are heavy-class in R2 — a plain push skips them. Push with
`node tools/sync-brand.mjs --push workspaces/<WS>/<Brand> --originals`, or the mp4 strands on this
machine.
