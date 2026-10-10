---
name: design-ad
description: Make the visual design decisions for an image ad — colors, fonts, spacing, hierarchy, contrast, legibility, and how layers (charts, diagrams, callouts) should look. Use before writing the generation prompt, or when an ad looks off-brand, hard to read, or cluttered. Decisions feed the Design section of the write-prompt skill.
---

# Design ad

Think like an expert designer. The ad must be on-brand (per the Branding section of the product's `-research.md`), instantly scannable, and legible at thumbnail size in a feed.

## Decide, per ad

- **Colors** — start from the product and packaging colors in the product's `-research.md`. Pick on-brand or close-to-on-brand background colors and styles that give the product strong contrast. Don't put the product on a background that flattens it.
- **Fonts** — choose font(s) consistent with the brand. Always write the word "font" when naming one (e.g. "bold grotesque sans font"), since the prompt depends on it.
- **Spacing & rhythm** — consistent margins and gaps between elements, even pacing; give everything room. Nothing crowded, nothing adrift. For portrait feed creatives, describe each shot as five equal horizontal bands, numbered 1 at the bottom through 5 at the top, rather than percentage coordinates. Keep essential action and text in the middle three so they survive feed crops; specify the subject and overlay bands separately when the scene calls for it. Apply this to each storyboard frame, not the storyboard sheet as a whole.
- **Hierarchy** — rank elements so the eye lands on the hook, then the product, then supporting text. Size, weight, and position encode the order.
- **Readability** — easy to read and scan. One clear focal path.
- **Contrast & emphasis** — every text legible over its background. When a hook runs long, highlight the key word(s) — accent color, heavier weight, a marker swash or lozenge — so the core message reads at a glance.
- **Assortment coverage** — if the product is a variety or multi-pack, every ad must show the full set somewhere: as the hero, in an explaining graphic, or in the footer band. Never let an ad represent a multi-pack with a single unit.

## Text over photo

Make overlay text legible and high-contrast the way a designer would, and when more contrast or emphasis is called for, don't just recolor the whole line. Reach for the real toolkit: an accent color on the key word(s), a highlighter or marker swash behind them, an underline, a solid background lozenge or knockout panel, heavier weight, plus shadows, strokes, gradients, or scrims so the text never fights the image. Place text over the calmest part of the photo.

On UGC and lifestyle photos, make overlays look **social-organic** — native story-editor text blocks, stickers, slightly imperfect placement — not polished graphic-design panels. The ad should read as a post, not a banner.

## Layers that explain an idea

Charts, diagrams, timelines, cycles, processes, tables: keep them **simple and easy to scan**. Few elements, clear labels, generous spacing. Never crowded. If it needs study, simplify it.

## Output

State the concrete choices (hex colors, font descriptions, spacing, hierarchy order, legibility treatments). These map directly into the **Design** section of the generation prompt. Where a creative choice is open, offer 3 differentiated directions.
