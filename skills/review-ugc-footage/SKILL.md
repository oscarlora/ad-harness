---
name: review-ugc-footage
description: Review a creator's delivered UGC footage against the script before editing — ingest it, confirm every scene is there, each line says the scripted message, framing fits the safe zones and the product reads right, then give the user an approve-or-reshoot verdict, prepare the clips and lay out a review cut per hook, B-roll on its lines, in Studio. Use when a creator sends their footage (an Air, Drive or folder link) or the user asks whether a delivery is good to approve.
---

# Review UGC footage

## 1. Ingest

Run **catalog-media** on the delivery link (`--source-type brand`, `--source-name "Ad <ID> <concept>
creator footage"`). Each record keeps the clip's original file name (the scene, e.g. `Body 3`) and a
transcript; map every scene to its record.

## 2. Check against the script

Read the ad's brief (`outputs/<ad>/<ID>_V1_….md`) and check each scene:

- **All there:** every hook, body line, CTA and B-roll in the brief has a clip.
- **Lines:** each says the scripted line or the same message in the creator's words; flag a changed
  meaning, a missing claim, or a claim that isn't in the script.
- **Framing:** a contact sheet of each clip (start, middle, end) with the safe area drawn — face and
  product inside the 4:5 crop and above the Reels UI (zones in **edit-video**, Text).
- **Product:** the label reads the right way round (front cameras mirror it) and in focus.
- **Start and end:** no line cut off at the start (listen for a missing first word; transcribe
  with `tools/transcribe-media.mjs --words`), no line said twice across clips.

Give the user a short verdict — good to approve, or what needs a reshoot — with each issue and its
fix. Don't edit before they answer.

## 3. Prepare the clips

Copy each clip into `outputs/<ad>/clips/` named by scene (`hook1.mp4`, `body01.mp4`, `cta.mp4`) and
transcribe it with `--words`. Check every product shot, B-roll and end card included, on a frame
where the label faces the camera. If any label is mirrored, flip **every** clip of that camera
(`ffmpeg -vf hflip`), so the creator never jumps sides between cuts.

Fixes the edit can make, so they need no reshoot:

- **The reach for the phone** at each clip's start and end, and phone taps: each clip starts on its
  first word and ends on its last; wordless sound is dropped.
- **Repeats and filler openers** ("Let me explain" twice, a stray "Okay"): cut.
- **A missing, clipped or mumbled word:** the creator's cloned voice re-says it (`tools/fix-voice.mjs patch`,
  **generate-voice**) over B-roll, or over their own face when it's only a word or two.

## 4. Review cut

One edit document (**edit-video**) per hook: `edit.json` with Hook 1, then hook versions on it
(`edit-v2.json` with Hook 2, and so on), plus one for each alternate the brief gives a hook (e.g. its B-roll). Each is a Video
track with the hook, the bodies and the CTA back to back, every talking clip from its first word to
its last with the fixes above applied, and a muted B-roll track above it with each shot over the
line the brief's storyboard gives it (two shots on one line split it at a word near the middle).
No text, captions or music. Show it in Studio and wait for the user's go. Then build the real edit on it in **edit-video** (plain style
unless the brief asks for more).
