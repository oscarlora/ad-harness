---
name: research-brand
description: Research a brand before making ads — the first onboarding step, in two phases. Collect everything (catalog and pages, reviews, the brand's and 3 competitors' Meta ads, posts on Reddit, X and social, the user's own files and media), then write it up as one file per thing — brand, each product with 3 personas and 3 angles, customers, competitors, ads, DESIGN.md. Use when onboarding a brand, when its research or DESIGN.md is missing or thin, or when asked to research a product, its customers, competitors or ads.
---

# Research brand

Two phases: collect, then write up. Quote customers verbatim; never invent quotes or numbers; write
`Unknown` rather than guess. Say in one line what each step is collecting as it starts.

## 1. Collect (into `inputs/sources/`)

Gather only; write nothing up yet.

1. **Ask the user, in one message,** for: the store and product links; any files that add context
   (post-purchase surveys, review exports, past research, briefs, brand guidelines), saved to
   `sources/files/`; the competitors they know; and whether you should pull the brand's photos and
   videos you can find, or they'll provide the product photos, videos and footage.
2. **Catalog and pages:** `node tools/pull-pages.mjs --store <url> --brand <brand dir>`, plus
   `--url` for the about, FAQ, science and landing pages → `sources/pages/` and `products.json`.
3. **Reviews:** **pull-reviews** → `sources/reviews.csv`.
4. **The brand's ads:** `node tools/pull-ads.mjs --advertiser "<its Facebook page>" --brand <brand dir>`
   (the 3 with the most impressions and the 3 newest) → `sources/ads/<brand>/`.
5. **Posts:** web search and your browser for what people say about the brand, the product and the
   problem on Reddit, X, TikTok, YouTube comments and forums → `sources/posts.md`, each post's
   link, date and exact words.
6. **Competitors:** the 3 closest (the user's, else from the research so far). For each, its pages
   (`pull-pages.mjs --competitor <name> --url <home and main product page>`) and its ads
   (`pull-ads.mjs --advertiser "<page>" --name <name>`).
7. **Media,** as the user chose: pull what you found (**pull-media**) or take theirs, then
   **catalog-media**.

## 2. Write up (into `inputs/`)

One file per thing, each in one place:

**`brand.md`** — story, mission, positioning, voice and tone, the market (background, position,
sophistication stage: 1 first-to-market · 2 direct claims · 3 mechanism · 4 better mechanism ·
5 identity/experience), and the product list (from `products.json`).

**`products/<product>.md`** — one per product:
- **Overview** — what it is, link, who it's for, why people buy.
- **Details** — every concrete spec: materials/ingredients with amounts, dimensions, build.
- **Selling points** — each mapped feature → functional benefit → emotional benefit.
- **Why it works** — two parts, each one or two plain sentences a customer could retell after one
  read: (a) the real reason the problem keeps happening — what other fixes miss; (b) how this
  product addresses exactly that. Back each with one common-sense line and one hard line (a study,
  a spec, or a pattern across reviews). Customer words, ready for copy. If it can't be said simply,
  keep digging or write `Unknown`.

**`products/<product>-personas.md`** and **`products/<product>-angles.md`** — 3 of each
(**ideate-personas-angles**).

**`customers.md`** — what customers say, from reviews, posts, surveys and the user's files (each
quote with its source): review count, rating and distribution; then insight + verbatim quote per
physical pains, emotional pains, desired outcomes, reasons to buy, objections (+ counter), what they
tried before (what they liked, what let them down); per product where they differ; ending with the
exact recurring words customers use for the problem and the product.

**`competitors.md`** — a table (competitor · price(s) · their differentiation · ours), then per
competitor: what they sell, how they position it, what their ads say and show, and the gap we can
take.

**`ads.md`** — the brand's ads (most impressions and newest): each one's hook, angle, format and what
it shows; then what's working across them.

**`DESIGN.md`** (brand-level, with its type sheet: **pull-fonts**) — the brand's look and feel, which every image, video, caption and doc follows,
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

**`products.json`** — the catalog (**pull-pages** writes it; add each product's `aliases` and
`look`), plus `inputs/media/_catalog/people.json` when known people (founder, recurring creators)
are obvious — format: **catalog-media**.
