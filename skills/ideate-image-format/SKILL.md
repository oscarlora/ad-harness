---
name: ideate-image-format
description: Ideate an image ad's format and design — pick the image type (photo- vs graphic-centric), set the mandatory background + product + hook, add layers, lay out the composition in bands, then decide colors, fonts, hierarchy and legibility. Image ads only; built from the layer toolkit, not a fixed list. Use when choosing an ad's format, or when an ad looks off-brand, hard to read or cluttered. Feeds write-prompt's Composition and Design sections.
---

# Ideate image format

A format is how an image ad looks: the **image type**, the **layers** it stacks, where each sits,
and its **design**. Image ads only.

## Image type — the base

- **Graphic-centric** — a product cutout on a designed background you supply.
- **Photo-centric** — a lifestyle or studio scene with the product in context; the photo is the
  background. **Always build on a real library photo** passed as a `--ref`, so the generator copies
  its real style; never describe a scene from scratch. If no exact scene exists, take the closest
  shot for its style and adapt. Design the type treatment (placement, scale, a knockout or lozenge,
  a caption block) without overcrowding the photo.

## Layers — the toolkit

Background · hook · product · subline · tertiary · callouts · pills · badges · stamps · icons ·
shapes/panels (lozenges, color bands, blobs, knockout panels behind text) · annotations (hand-drawn
arrows, circles, underlines, scribbles) · lists · tables · diagrams · charts · timelines/sequences ·
cycles · processes · screen splits · people · hands · props (supporting objects that tell the
story) · faux (documents, UI, mockups) · abstract visualizations · photos · logo (from the brand
kit). **Not exhaustive** — invent layers, or translate real ad formats found online into this
toolkit.

A layer counts as **one** however many sub-items it holds (three callouts, a five-row table).

**Style is per layer.** Default to one treatment for the whole concept (2D · 3D · claymation ·
pop-art · night-vision · photo filter · cartoon · futuristic…); a layer may override it on purpose.
The product stays real (photographic) unless the user stylizes it.

**Photoreal people are never generated from scratch.** Stylized people generate freely. A person
meant to read as real photography needs the closest real photo from the brand's media library,
edited toward the idea ("move the bar to the other hand") — even when the edit is big.

**Push past the default hero-plus-hook.** Explain the benefit visually: a diagram, a literal
metaphor, a faux UI (text thread, search bar, lock screen), a before/after object, an abstract data
visual. Across a batch, vary the device, and never repeat a format from the brand's earlier ads.

## Process

1. **Pick the image type** — from the user, or inferred from their reference.

2. **Set the mandatory base: background + product + hook.** A valid ad can stop here. Start from
   the background, sourcing from the media library (**search-media**):
   - *Graphic-centric* — a flat color, gradient, texture, or set in brand palette, then one product
     cutout (vary the shot across ads when the library has alternatives).
   - *Photo-centric* — pick the scene photo first, then the hook; overlay or edit it (crop, extend,
     swap the pictured product) as the idea needs. Don't alter its real content unless the user
     asks or the ad needs it.

3. **Add layers** to sharpen the message. Keep **3 to 7 layers in total, background included**.
   Vary how many and which across a batch.

4. **Write the composition.** A **2–4 word name**, then the layout: each layer by its toolkit
   name, each text slot with an identifiable name (`subline-top`, `pill-1`/`pill-2`), stacking
   order where layers overlap. Place a portrait ad in **five equal horizontal bands**, 1 at the
   bottom to 5 at the top, never percentages; keep essential text and action in bands 2–4 so they
   survive feed crops, and give subject and overlay bands separately when needed. Other layouts use
   anchor points. Sample:
   - **Name:** Horizontal split before & after
   - **Band 5:** hook
   - **Bands 1–4:** center divider — left half "before"; right half "after" with the product

Options vary image type, structure, or layer mix. If a reference ad or photo already locks the
format, use it.

## Design

On-brand (`inputs/DESIGN.md`), instantly scannable, legible at thumbnail size. Decide per ad, and
state the concrete choices (hex colors, fonts, hierarchy order, legibility treatments) for
**write-prompt**'s Design section:

- **Colors** — start from the product and packaging colors; an on-brand or near-on-brand
  background that gives the product strong contrast, never one that flattens it.
- **Fonts** — the brand's (**pull-fonts**). Always write the word "font" when naming one ("bold
  grotesque sans font").
- **Hierarchy** — the eye lands on the hook, then the product, then supporting text; size, weight
  and position set the order. Consistent margins; nothing crowded, nothing adrift.
- **Text over photo** — on the calmest part of the photo. On a long hook, emphasize the key
  word(s), not the whole line: an accent color, a marker swash, an underline, a lozenge or knockout
  panel, heavier weight; shadows, strokes, gradients or scrims for legibility. On UGC and lifestyle
  photos, make overlays **social-organic** (native story-editor text, stickers, slightly imperfect
  placement) so the ad reads as a post, not a banner.
- **Layers that explain** (charts, diagrams, timelines, tables) — few elements, clear labels,
  generous spacing. If it needs study, simplify it.
- **Assortment** — a variety or multi-pack shows the full set somewhere (the hero, an explaining
  graphic, the footer band), never a single unit.
