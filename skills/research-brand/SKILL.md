---
name: research-brand
description: Research a brand before making ads — the first onboarding step. From product link(s), reviews, and any notes, produce the brand's source-of-truth files: its DESIGN.md, and per product research, personas, and angles (plus a brand overview for multi-sku brands). Use when onboarding a new brand, when a product's research or the brand's DESIGN.md is missing or thin, or when asked to research a product, build personas, or analyze reviews/market/competitors.
---

# Research brand

Turn product link(s), reviews, and any notes into the brand's source-of-truth files. Quote
customers verbatim; never invent quotes or numbers; write `Unknown` rather than guess.

## Inputs

- **Product link(s)** — one (single-product brand) or many (multi-sku).
- **Reviews CSV** — store-wide or per product (slice by its `product` column). If none, run
  **pull-reviews** first → `inputs/reviews.csv`.
- **Any extra context** — brand doc, brief, notes.

## Process

1. Decide the brand type and identify the product(s).
2. Pull reviews if not supplied (**pull-reviews**).
3. Research each product from its page, web search, and the reviews, and write the files below.
4. Write **`inputs/products.json`**.
5. Optionally ingest the brand's media (**catalog-media**).
6. Write **`inputs/DESIGN.md`** and its type sheet (**pull-fonts**).

## Outputs

Written to `inputs/`.

**`[brand]-overview.md`** (multi-sku only) — brand story + a product list table.

**`[product]-research.md`**
- **Overview** — what it is, link, who it's for, why people buy.
- **Details** — every concrete spec: materials/ingredients with amounts, dimensions, build.
- **Selling points** — each mapped feature → functional benefit → emotional benefit.
- **Why it works** — two parts, each one or two plain sentences a customer could retell after one
  read: (a) the real reason the problem keeps happening — what other fixes miss; (b) how this
  product addresses exactly that. Back each with one common-sense line and one hard line (a study,
  a spec, or a pattern across reviews). Customer words, ready for copy. If it can't be said simply,
  keep digging or write `Unknown`.
- **Market** — background, position, sophistication stage (1 first-to-market · 2 direct claims ·
  3 mechanism · 4 better mechanism · 5 identity/experience).
- **Competitors** — table: competitor · price(s) · their differentiation · ours.
- **Reviews analysis** — count, rating, distribution; then insight + verbatim quote per: physical
  pains, emotional pains, desired outcomes, reasons to buy, objections (+ counter), what they
  tried before (what they liked, what let them down); end with the exact recurring words and
  phrases customers use for the problem and the product.

**`[product]-personas.md`** and **`[product]-angles.md`** — ≥5 of each to start
(**ideate-personas-angles**).

**`DESIGN.md`** (brand-level) — the brand's look and feel, which every image, video and doc follows,
in the DESIGN.md format (github.com/google-labs-code/design.md). Exact values go in the front
matter, everything else in the sections below it, in this order:

```yaml
---
name: Acme
colors:            # hex, keyed by use: primary, accent, background, text, packaging…
  primary: "#1F3A2E"
typography:        # per role: headline, body, any other
  headline: { fontFamily: Big Shoulders Display, fontWeight: 700 }
omitted: [rounded, spacing]
---
```

- **Overview** — personality, tone, the feel (also sets the music and voiceover vibe).
- **Colors** — what each color is for.
- **Typography** — each font's role; headline + body case and punctuation; the type sheet path.
- **Layout** — density and spacing, how the brand's own creative is composed.
- **Shapes** — corners, badges, frames, recurring graphic devices.
- **Components** — recurring pieces: logo lockup, CTA, offer tag, review stars.
- **Imagery** — photo style, lighting, settings, how the product is shown.
- **Motion & Video** — pacing, transitions, caption look.
- **Do's and Don'ts**.

**`products.json`** (brand-level) — one entry per SKU:
`{ "name": canonical full name (no abbreviations), "aliases": ["ASG", …], "look": "packaging colors, wrapper text, shape, distinguishing marks" }`. Read by **catalog-media** and **search-media**. When a name is said differently than it's spelled, use `{ "products": [...], "vocabulary": ["Acme (said \"Ack-mee\")"] }`. When known people (founder, recurring creators) are obvious, also seed `inputs/media/_catalog/people.json` — `{ "name", "description" }`, the description being stable physical traits (age range, build, skin tone, hair, face).
