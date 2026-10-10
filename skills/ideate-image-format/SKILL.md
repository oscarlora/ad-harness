---
name: ideate-image-format
description: Ideate an image ad's format — pick the image type (photo- vs graphic-centric), set the mandatory background + product + hook, then add layers and lay out the composition. Image ads only; built from the layer toolkit, not a fixed list. Provides 3 differentiated options.
---

# Ideate image format

A format is how an image ad looks: the **image type** it's built on, the **layers** it stacks, and
where each sits. Built from the toolkit, not a fixed list. Image ads only.

## Image type — the base

Every ad starts from one of two bases; layers apply to both:

- **Graphic-centric** — a product cutout on a designed background. You supply the background and
  arrange everything on top of it.
- **Photo-centric** — a scene (lifestyle or studio photo) where the product sits in a real context;
  the photo is the background. You overlay or edit on top of it. **Always build on a real reference
  photo** — pass an actual library shot as a `--ref` so the generator copies its real-world style
  (lighting, grain, depth, imperfection) and adapts the elements. Never describe a scene from
  scratch with no photo ref: that yields a generic, stock-looking image. If no exact scene exists,
  take the closest real shot for its *style* and adapt. And don't just drop a hook on the photo —
  design the type treatment (placement, scale, a knockout/lozenge, a caption block) like a
  designer, without overcrowding the image.

## Layers — the toolkit

Background · hook · product · subline · tertiary · callouts · pills · badges · stamps · icons ·
shapes/panels (lozenges, color bands, blobs, knockout panels behind text) · annotations (hand-drawn
arrows, circles, underlines, scribbles) · lists · tables · diagrams · charts · timelines/sequences ·
cycles · processes · screen splits · people · hands · props (supporting objects that tell the
story — scattered ingredients, a clock, a coffee cup) · faux (documents, UI, mockups) · abstract
visualizations · photos · logo (from the brand kit). **Not exhaustive** — invent new layers, or
research real ad formats online (e.g. search "DTC image ad formats") and translate one into this
toolkit (a split-screen ad → a screen split with photo layers).

A layer counts as **one** no matter how many sub-items it holds: a callouts layer with three
callouts, or a table with five rows, is still a single layer.

**Style is a per-layer attribute.** The default is one treatment over the whole concept — 2D · 3D ·
claymation · pop-art · night-vision · photo filter · cartoon · futuristic, etc. — but any layer may
override it deliberately when the idea calls for it: a 2D illustrated background with the real
product on top, doodle annotations over a photo. Two guardrails: the product layer stays real
(photographic) unless the user explicitly stylizes it, and human layers follow the people rule below.

**Photoreal people are never generated from scratch.** Stylized people (2D, 3D, clay, cartoon)
generate freely. Anything meant to read as real photography of a person — a people or hands layer,
on either image type — is stricter than the scene rule above: a scene borrows a real ref's style; a
person needs the actual closest photo from the brand's media library, edited toward the idea. Ask
the generator to change *that image* — move the bar to the other hand, flip the kid upside down on
the sofa — never describe the person from scratch, even when no photo matches and the edit is big.
Editing a real photo keeps real lighting, grain, and imperfection; describing one gets the AI look.

**Push past the default hero-plus-hook.** The best ads *explain the benefit visually* — a diagram, a
metaphor made literal, a faux UI (text thread, search bar, lock screen), a transformation or
before/after object, an abstract data visual (like an energy curve). Reach for a concept-driven
visual, not a centered product with a line of text. And across a batch, **vary the device** — don't
lean on the same handful of layouts (centered hero, side-by-side comparison, cross-out list). Each ad
should be its own idea, and none should repeat a format already used in the brand's earlier ads.

## Process

1. **Pick the image type.** Graphic-centric or photo-centric — take it from the user, or infer it from
   a reference they give.

2. **Set the mandatory base: background + product + hook.** These three are the floor, and a valid ad
   can stop here. Like design software, start from the background, sourcing from the brand's media
   library (**search-media**):
   - *Graphic-centric* — design or pick the background: a flat color, gradient, texture, or set, in
     brand palette. Then one product cutout (vary the shot/angle across ads only when the library has
     alternatives).
   - *Photo-centric* — the scene photo **is** the background: pick it first, then the hook; from there
     overlay or edit the photo (crop, extend the canvas, swap the pictured product) as the idea
     needs — don't alter its real content unless the user asks or it's part of the ad.

3. **Add layers.** Beyond the base, pull more from the toolkit to sharpen the message (a subline,
   pills, a callouts layer, a stat, a table, a diagram…). Keep the **total between 3 and 7 layers,
   background included** — sub-items inside a layer don't count. Vary how many and which across a
   batch: that's where differentiation comes from.

4. **Write the composition.** Give the format a **2–4 word descriptive name** (e.g. "Horizontal split
   before & after"), then lay it out by **areas**: name each layer with its toolkit name, give every
   text slot an identifiable name (by position or number — `subline-top`, `pill-1`/`pill-2`), and
   position with anchor points or percentages, noting stacking order where layers overlap. Sample:
   - **Name:** Horizontal split before & after
   - **Top 15%:** hook
   - **Bottom 85%:** center divider — left 50% "before"; right 50% "after" with the product

Propose **3 deliberately differentiated** formats (vary the image type, structure, or layer mix). If a
reference ad or photo already locks the format, skip and use it.
