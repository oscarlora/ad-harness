---
name: research-brand
description: Research a brand before making ads — the first onboarding step. From product link(s), reviews, and any notes, produce the brand's source-of-truth files per product: research, personas, and angles (plus a brand overview for multi-sku brands). Use when onboarding a new brand, when a product's research is missing or thin, or when asked to research a product, build personas, or analyze reviews/market/competitors.
---

# Research brand

The first step when onboarding a brand. Turn product link(s), reviews, and any notes into
the brand's source-of-truth files. Quote customers verbatim; never invent quotes or numbers;
write `Unknown` rather than guess.

## Inputs

- **Product link(s)** — one (hero / single-product brand) or many (multi-sku).
- **Reviews CSV** — store-wide or per product (slice by its `product` column). If none, pull it
  first with **pull-reviews** → `inputs/reviews.csv`.
- **Any extra context** — brand doc, brief, notes.

## Process

1. Decide the brand type and identify the product(s).
2. Pull reviews if not supplied (**pull-reviews**).
3. Research each product from its page, web search, and the reviews, and write the files below.
4. Write **`inputs/products.json`** — the product fingerprints the media catalog matches against.
5. Optionally ingest the brand's media (**catalog-media**).
6. Build the brand **type sheet** once fonts + cases are known (**pull-fonts**).

## Outputs

Written to `inputs/`. Multi-sku brands also get one brand-level overview.

**`[brand]-overview.md`** (multi-sku only) — brand story + a product list table.

**`[product]-research.md`**
- **Overview** — what it is, link, who it's for, why people buy.
- **Details** — every concrete spec: materials/ingredients with amounts, dimensions, build.
- **Selling points** — the details that sell, each mapped to benefit: feature → functional benefit
  → emotional benefit. Raw material for angles and copy.
- **Why it works** — two short parts, each one or two plain sentences a customer could retell to a
  friend after one read: (a) the real reason the problem keeps happening for them — the thing
  other fixes miss; (b) how this product addresses exactly that. Back each part with one
  common-sense line (why it rings true) and one hard line (a study, a spec, or a pattern across
  reviews). Write it in customer words, ready to lift straight into copy. If it can't be said
  simply, it isn't understood yet — keep digging or write `Unknown`.
- **Market** — background, position, sophistication stage (1–5).
- **Competitors** — table: competitor · price(s) · their differentiation · ours.
- **Branding** — colors (each in hex, labeled by use: primary, accent, background, text, etc.); font(s); headline + body case; headline + body punctuation; spacing/layout feel; tone.
- **Reviews analysis** — count, rating, distribution; then insight + verbatim quote per: physical
  pains, emotional pains, desired outcomes, reasons to buy, objections (+ counter), what they
  tried before (other products and fixes customers mention — what they liked, what let them
  down, any bad experiences); end with their words — a short list of the exact recurring words
  and phrases customers use for the problem and the product, to lift into copy.

**`[product]-personas.md`** — the product's persona set, ≥5 to start (see **ideate-personas**).

**`[product]-angles.md`** — the product's angle set, ≥5 to start (see **ideate-angles**).

**`products.json`** (brand-level) — one entry per SKU, used to identify products in media:
`{ "name": canonical full name (no abbreviations), "aliases": ["ASG", …], "look": "packaging colors, wrapper text, shape, distinguishing marks" }`. Read by **catalog-media**'s analysis (to tag products with the canonical name and spell them right in transcripts) and **search-media** (alias-aware search). When the brand or a name is said differently than it's spelled, write the file as `{ "products": [...], "vocabulary": ["Acme (said \"Ack-mee\")", "acme.co (said \"Acme dot co\")"] }`. Seed the people registry `inputs/media/_catalog/people.json` here too when known people (founder, recurring creators) are obvious — `{ "name", "description" }`, the description being stable physical traits (age range, build, skin tone, hair, face).

## Notes

- Sophistication stages: 1 first-to-market · 2 direct claims · 3 mechanism · 4 better mechanism · 5 identity/experience.
- The `-research.md`, personas, angles, and review quotes are what every later skill draws from.
  Keep them specific and concrete; **ideate-personas** and **ideate-angles** grow the sets as new ads are made.
