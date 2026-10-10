---
name: write-meta-copy
description: Write the Meta ad's in-platform text — the headline and primary text that run in Ads Manager, not on the creative. Optional. Use when preparing an ad for Meta. Follows the writing rules in the write-copy skill; provides 3 differentiated options per piece.
---

# Write Meta copy

The text that runs in Meta Ads Manager, not on the creative. Voice and rules follow the
**write-copy** skill; this owns the Meta-specific formats. Pull wording from the product's
`-research.md` Reviews analysis. Give **3 differentiated options** per piece.

## Headline

Acts as a call to action. 3 to 6 words. Start with a verb and carry a concrete benefit, offer,
or number — "Switch To Steady Energy", "Get 20% Off Today". No curiosity bait the ad or page
doesn't pay off.

## Primary text

- **The first ~125 characters must work on their own** — that's all Meta shows before
  "See more". Front-load the hook; never open with the brand name or warm-up words.
- **Format**: one sentence per line, blank line between (`\n\n`).
- **Deliver all three lengths**; recommend which to run by the persona's awareness stage
  (in the product's `-personas.md`): product- and most-aware → short, unaware and
  problem-aware → long.

**Short (~50 words)** — hook line → one proof line → the offer → a call to action. For
personas who already know the product or the product type.

**Medium (~150 words)** — the short structure, plus the why-it-works in one plain sentence
and the persona's top objection answered.

**Long (~300 words)** — reads like a very short article: hook → the problem in the customer's
own words → what they've tried and why it fell short → what actually works, said plainly →
one or two benefits set in scenes the persona can feel → a customer quote with a number or
timeframe → a soft call to action. For colder personas, keep the product out of the first third.

## Where it lives

The locked headline and primary text go in the ad's record as `meta: { headline, primary_text }`
(`outputs/json/[ID].json`, schema in `tools/record-ad.mjs`); the studio Board shows both.

## Claims

Every claim follows **write-copy**'s Claims section — it already carries the Meta rules
(positive framing, ad review); nothing extra applies here.
