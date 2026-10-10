---
name: pull-fonts
description: Capture a brand's fonts as one typography reference image so generated ads render the real fonts. Identify the site's fonts (headline/display, H1–H3, body, any additional) and headline case, render them all onto a single type sheet with tools/make-type-sheet.py, record it in the product's `-research.md`, and attach it as a --ref on every generation. Runs as part of research; also use when an ad's type looks off-brand.
---

# Pull fonts

Image generators don't load font files, but they follow a font shown in a reference image. So we render the brand's fonts onto one type sheet, attach it when generating, and name the font in the prompt — hooks come out in the brand's real typeface instead of a generic sans. Build it as part of research, once the Branding section's fonts are known.

## Process

1. **Identify the real fonts — never guess from how the text looks.** Read them off the site's code, most reliable first:
   - **Computed styles (ground truth).** In a browser, inspect real elements: `getComputedStyle(document.querySelector('h1')).fontFamily`. Check `h1`, `h2`, `h3`, a body paragraph, and a button/label. The **first** name in each stack is the font; ignore generic fallbacks (`sans-serif`, `Arial`).
   - **The page CSS.** `@font-face { font-family; src: url(...) }` (the fonts actually loaded + their files), the Google Fonts `<link>` / `@import` families, which selectors use them, and any font CSS variables (`--font-heading`).
   - **The user**, if they already know it ("the H1 is Big Shoulders").

   Capture per role: **headline / display**, **H1 / H2 / H3** (note where they share or differ), **body / UI**, and **any additional** font with where it's used. Note the **case** (watch `text-transform: uppercase` — it forces ALL CAPS regardless of the font) and weights. If a font can't be resolved from the site, mark it **Unknown** and ask the user — never substitute a similar one.
2. **Render one type sheet with every font:**
   ```
   python3 tools/make-type-sheet.py --out "workspaces/<Workspace>/<Brand>/inputs/media/brand/type_sheet.png" \
     --font "Big Shoulders Display|700|H1 / headline|<a real hook>" \
     --font "Poppins|500|Body / UI|<a real support line>"
   ```
   One `--font` per font: `Source|weight|role|sample`; write the H1 `sample` in the brand's headline case so the sheet shows it. Source is a Google family name, a font-file URL, or a local `.ttf`/`.otf` (see Font sources). Defaults render white-on-dark; pass `--bg`/`--fg` hex to match the brand.
3. **Record in the product's `-research.md`** Branding → Font(s): each font, role, weight, and the sheet path.

## Use in generation

- Set hooks in the **H1** font and the brand's headline case (ALL CAPS or sentence case), and support copy in the **body** font; name the font in the prompt (see **design-ad**).
- Attach `inputs/media/brand/type_sheet.png` as a `--ref` on every ad, and in the prompt mark it a **FONT reference only — do not place it in the ad** (so the generator copies the letterforms, not the image).

## Font sources

Pick by where the font lives. **Never substitute a similar font** — use the real one, or a screenshot of it. If a source can't be resolved the tool stops with a clear message rather than swapping in the wrong font.

- **Google Fonts** — pass the exact family name; fetched automatically.
- **Self-hosted on the site** — take the `.ttf`/`.otf` from the page's `@font-face { src: url(...) }` (pass the URL or a copy). `.woff2` (now common) needs fontTools + brotli to convert, which aren't installed here — get the `.ttf`/`.otf` or desktop file instead.
- **Paid font, file in hand** — pass the local `.ttf`/`.otf` path.
- **Paid font you can't get** (Adobe Fonts, Typekit, Monotype) — **ask the user for the file.**
- **Last resort** — if it still can't render, **ask the user for a screenshot** of the site showing all the fonts together; save it to `inputs/media/brand/` and attach that as the `--ref` instead of the type sheet. It carries the real letterforms.
