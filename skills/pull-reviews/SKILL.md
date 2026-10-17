---
name: pull-reviews
description: Get a brand's reviews into a CSV when none was supplied. Detects the store's review platform (Okendo, Stamped, Judge.me, Loox, Yotpo, Reviews.io) and pulls the public review feed to inputs/sources/reviews.csv. Use at the start of research when the brand is a DTC/Shopify store and no reviews CSV was handed over, or when asked to pull or refresh reviews.
---

# Pull reviews

Pull a store's public reviews into `inputs/sources/reviews.csv`, during **research-brand**'s collection.

## Pull

1. Auto-detect, pull, write the CSV:
   ```
   node tools/pull-reviews.mjs --store <url> --out "workspaces/<Workspace>/<Brand>/inputs/sources/reviews.csv"
   ```
   `--detect-only` prints the platform + id without writing.
2. Sanity-check the printed count and average against the public product page.

## If it doesn't pull

- **Listed, not built yet** (tool exits 2) — build the adapter (below), then pull. No need to ask.
- **Unlisted / UNKNOWN** (tool exits 1) — don't grind:
  1. Ask whether to attempt a one-time pull.
  2. If yes, try once (its public feed, or reading the reviews page by hand) and write the CSV.
  3. If that fails, say so and ask the user for the CSV, else screenshots or a counts + key-quotes summary.

  Never turn an unlisted one-off into a permanent adapter.

## Platforms

Which work, how each feed is read, and how to add an adapter: the header and code of
`tools/pull-reviews.mjs`.

## CSV

`review_number, date, product, rating, reviewer, verified, recommended, incentivized, title, body,
helpful_count, language, review_id, product_url` — newest first (`review_number` 1..N), one row
per review, all products store-wide.

## Rules

- **Never fabricate.** Only rows the feed returns. If it's unreachable, say so.
- **Verify provenance** when a set looks too clean: re-fetch a few `review_id`s live, confirm the
  bodies match, and cross-check the total + star breakdown against the public count.
- **Flag incentivized reviews** via the `incentivized` column, quote the concrete reviews, and note
  the caveat in `customers.md`.
