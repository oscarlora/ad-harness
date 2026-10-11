---
name: ideate-image-format
description: Ideate an image ad's format — pick the image type (photo- vs graphic-centric), set the mandatory background + product + hook, then add layers and lay out the composition. Image ads only; built from the layer toolkit, not a fixed list. Provides 3 differentiated options.
---

# Ideate image format

A format is how an image ad looks: the **image type**, the **layers** it stacks, and where each
sits. Image ads only.

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

4. **Write the composition.** A **2–4 word name**, then a layout by **areas**: each layer by its
   toolkit name, each text slot with an identifiable name (`subline-top`, `pill-1`/`pill-2`),
   positions as anchor points or percentages, stacking order where layers overlap. Sample:
   - **Name:** Horizontal split before & after
   - **Top 15%:** hook
   - **Bottom 85%:** center divider — left 50% "before"; right 50% "after" with the product

Propose **3 deliberately differentiated** formats (vary image type, structure, or layer mix). If a
reference ad or photo already locks the format, use it.
