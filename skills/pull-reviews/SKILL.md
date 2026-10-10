---
name: pull-reviews
description: Get a brand's reviews into a CSV when none was supplied. Detects the store's review platform (Okendo, Stamped, Judge.me, Loox, Yotpo, Reviews.io) and pulls the public review feed to inputs/reviews.csv. Use at the start of research when the brand is a DTC/Shopify store and no reviews CSV was handed over.
---

# Pull reviews

Pull a store's public reviews into `inputs/reviews.csv` — only what the storefront already
serves; never invent reviews, quotes, or counts. Run before the **research-brand** skill, which
assumes the CSV exists.

## When to use

- A DTC/Shopify brand with no reviews CSV.
- The user asks to pull or refresh a brand's reviews.

## Pull

1. Auto-detect, pull, write the CSV:
   ```
   node tools/pull-reviews.mjs --store <url> --out "workspaces/<Workspace>/<Brand>/inputs/reviews.csv"
   ```
   `--detect-only` prints the platform + id without writing.
2. Sanity-check the printed count and average against the public product page.
3. Hand off to research.

## If it doesn't pull

Route by what detection reports:

- **Listed, adapter built** (Okendo, Stamped, Judge.me, Loox) — the pull just works.
- **Listed, not built yet** (Yotpo, Reviews.io; tool exits 2) — build the
  adapter (below), then pull. Expected work; no need to ask.
- **Unlisted / UNKNOWN** (tool exits 1) — don't grind. Escalate in order:
  1. **Ask first** — the platform is unrecognized; ask whether to attempt a one-time pull.
  2. **One attempt** — if yes, try once to get the reviews (its public feed, or by reading the
     reviews page by hand) and write the CSV.
  3. **Hand back** — if that fails, say plainly it couldn't be pulled and ask the user to supply
     them instead: the CSV (best), else screenshots or a counts + key-quotes summary.

  Don't turn an unknown one-off into a permanent adapter — only listed platforms earn one.

## Platforms

Reviews live in a third-party widget. Its store id sits in the page HTML, served by a public
feed (no API key — the same one the widget reads).

| Platform | Status | Key fact |
|---|---|---|
| Okendo | Working | Subscriber id in page as `subscriberId":"<uuid>"`. Feed: `api.okendo.io/v1/stores/<sub>/reviews?limit=100`, follow `nextUrl`. |
| Stamped | Working | Keyed by the store's `.myshopify.com` domain; `getappkey` → `apiKey`+`sId`; `/widget` returns rendered HTML, parsed per page (no JSON feed). |
| Judge.me | Working | Keyed by the store's `.myshopify.com` domain (in page HTML). JSON feed: `api.judge.me/reviews/reviews_for_widget?shop_domain=<dom>&platform=shopify&product_id=<id>&page=N&per_page=30` (caps at 30), `pagination.total_pages`. Reviews are shared across grouped sister products — crawl every id in `/products.json` and dedupe by `uuid`. No incentivized flag; invitation-collected reviews are marked `store_invitation` (check the page's `jdgmSettings.coupon_*` for whether invites carry a coupon). |
| Loox | Working | Store id in the page's `loox.io/widget/<id>/loox.js` URL. No JSON: `loox.io/widget/<id>/reviews?limit=20&page=N` returns rendered HTML (20/page cap), parsed per page. Two tabs: product reviews (default) and store reviews (`&currentTab=store`, product = "Store review"); page 1 embeds both totals. |
| Yotpo | Detect only | Keyed by an `app_key` in the page. |
| Reviews.io | Detect only | Keyed by a store token in the page. |

## Adding an adapter

Building a new adapter for a listed platform is expected work — the full guide (finding the feed,
wiring it in, verifying the count) lives in the header of `tools/pull-reviews.mjs`. When one lands,
flip its row to "Working" in the table above.

## CSV

`review_number, date, product, rating, reviewer, verified, recommended, incentivized, title, body,
helpful_count, language, review_id, product_url` — newest first (`review_number` 1..N), one row
per review, all products store-wide (sister-product reviews share the persona).

## Rules

- **Never fabricate.** Only rows the feed returns. If it's unreachable, say so.
- **Verify provenance** when a set looks too clean: re-fetch a few `review_id`s live, confirm the
  bodies match, and cross-check the total + star breakdown against the public count.
- **Flag incentivized reviews.** Sets often mix organic with templated, incentivized ones. Use the
  `incentivized` column, quote the concrete reviews, and note the caveat in the product's `-research.md`.
