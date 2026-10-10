---
name: write-handoff
description: Write the short, conversational message that goes to a brand with a batch of ads (image, video, or both). Two paths — a per-ad sample list, or a high-level note for a new batch dropped into a folder the brand already has. Produces the message only, not the files.
---

# Write handoff

A short, friendly message goes out whenever Ad Harness hands a brand ads. Pick the path that fits:

- **Sample list** — a first look or small set; walk through each ad, one line apiece.
- **New batch drop** — a larger batch added to a folder the brand already has access to; high-level only, one beat per line, no per-ad list.

Both are friendly, conversational, and concise. No em dashes.

## Inputs

- **Brand name** (use a `[name]` placeholder if unknown).
- **Media type** — image, video, or both. Say "image ads", "video ads", or "image and video ads", never "static image ads". Use "ad" (singular) if there's only one.
- **Per ad** (sample-list path): **format**, **product**, **persona**, **angle** — from the name `<id>_<Variation>_<Concept>_<Format>_<Persona>_<Angle>_<Product>` or known from the run.
- **Folder URL** (new-batch path): the folder the batch was dropped into.

## Path 1 — Sample list (one line per ad)

```
Hey [name],

Here are [N] sample [image / video / image and video] ads we put together for you.

1. [line for ad 1]
2. [line for ad 2]
...
```

- **One numbered item per ad.** Single list — never segment under product headers; if there are multiple products, group same-product ads together.
- **Each line** is a natural sentence, **format first**, then product, then who it's for, then what it does:
  > A two-photo split-screen for Acme Focus, aimed at someone fighting neck and shoulder tension, showing how it delivers pinpoint relief right where it hurts.
- Vary the connectors so it doesn't read repetitively (aimed at · for · speaking to · built for · showing how · leaning on · driving home · back to).

### Example (7 image ads, two products)

Hey [name],

Here are 7 sample image ads we put together for you.

1. A two-photo split-screen for Acme Focus, aimed at someone fighting neck and shoulder tension, showing how it delivers pinpoint relief right where it hurts.
2. A single photo fading into a headline for Acme Deep, speaking to the frustrated massage-gun owner, showing how it finally gets the knot a massage gun keeps missing.
3. A body-map diagram for Acme Deep, made for chronic-pain sufferers, mapping the range of conditions it treats from jaw to foot.
4. A proof-stat card for Acme Deep, built for the skeptic, leaning on the clinical proof behind it: 10,000+ physios and pro sports teams, and a 90-day guarantee.
5. A side-by-side comparison for Acme Deep, back to the massage-gun owner, putting it head-to-head in a pound-vs-pinpoint match-up.
6. A bold, type-led ad for Acme Deep, for that same gun owner, driving home that massage guns miss the one spot that actually hurts.
7. An annotated product callout for Acme Deep, also for the gun owner, explaining why it reaches what a massage gun simply can't.

## Path 2 — New batch drop (high-level, one beat per line)

Use when adding a batch, especially a big one, to a folder the brand already has. **Hyperlink the folder.** Keep it short and readable — each beat on its own line, no per-ad list, no offer, no product-page link.

The beats, in order: greeting · what was done (count + product + folder) · personas · angles · formats · feedback.

```
Hey [name],

I just added [N] new [Product] ads to the [folder](folder link).

They span [K] personas, from [one persona] to [two or three more].

Each runs the angle that lands for that persona, from [one angle] to [two or three more].

Every ad is a different format, across [a sweep of the formats and styles].

If anything needs tweaking, let me know.
```

- **Line 2** packs what was done, how many, the product, and the folder (the folder word is the link).
- **Personas, angles, formats** each get their own line — a "from X to Y" sweep, never a full list.
- Close with an open door to tweak.

### Example (20-ad Acme Greens batch)

Hey [name],

I just added 20 new Acme Greens ads to the [100-statics folder](folder link).

They span seven personas, from the 3pm crasher who reaches for coffee to breakfast skippers, busy parents, and label readers.

Each runs the angle that lands for that persona, from no afternoon crash to clean ingredients, real fruit, and honest taste.

Every ad is a different format, across clean product layouts, lifestyle photos, illustrated comics, pop-art, and 3D scenes.

If anything needs tweaking, let me know.
