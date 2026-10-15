# Studio design

How Studio looks. Values live once, as variables in `:root` of `app/globals.css`; this file names
them and says how to use them. Sections follow the DESIGN.md format
(github.com/google-labs-code/design.md).

## Overview

A quiet tool for reviewing ads. The ads carry the color; the interface stays out of their way:
warm white, near-black text, hairlines, one font. Structure is felt rather than seen. Dense and
calm, built for scanning many ads fast.

## Colors

- Surfaces: `--bg` content · `--bg-subtle` viewer stage and empty frames · `--fill` segmented-control
  tracks and hover · `--fill-soft` the editor timeline's track bands · `--fill-strong` pressed and timeline clips · `--media-bg` behind media ·
  `--glass` the translucent white of bars and controls floating over content or media
- Text: `--fg` primary (`--fg-hover` on the primary button) · `--muted-emphasis` body in tables and
  panels · `--muted` labels and meta · `--faint` placeholders, to-do steps, hollow dots, waveforms ·
  `--on-media` text and marks over media
- Lines: `--line` dividers and table rules · `--line-strong` hover borders and empty dots
- Status, only as 7px dots, never as fills: `--success` Approved / done, `--info` Pending Review /
  current, `--warning` errors. In Progress is a hollow dot.
- Video stages sit on `--stage` (pure black). The only solid dark fill is the primary button.

## Typography

- Inter only (`--font-sans`), weights 400, 500, 600. Body 14px, line height 1.55.
- Scale: `--text-xs` 12 labels, meta and dense marks (`.eyebrow`, timeline, key hints) · `--text-sm`
  13 controls, tables, panels · `--text-md` 14 body and prose (the page default) · `--text-lg` 16
  names · `--text-2xl` 24 page titles.
- 400 body · 500 labels, buttons, hooks · 600 headings and names. Headings track -0.015em to -0.02em.
- Tabular numbers for IDs, times and counts. Sentence case everywhere; slugs shown as words.
- Headings balance, paragraphs wrap pretty.

## Layout

- Pages pad by `--page-pad` (20px). Every brand page has two translucent bars (`--bar-h`): the
  navigation bar on top (home / workspace / brand on the left, page tabs on the right) and the control bar fixed at
  the bottom (the page's count on the left, its search centered, its filters and actions on the right). Navigation
  never goes in the bottom bar, page controls never in the top one. An ad's page has no control bar: one row
  under the navigation holds back, ID and name, and the step tabs; its editor keeps the timeline fixed at the
  bottom, with the preview and notes filling the space above (preview and notes on `--bg-subtle`, the
  timeline on `--fill`).
- The Board and the media library are masonry grids: 4 columns from 1200px, 3 from 900, 2 from
  640, else 1; each item keeps its own shape. The Workflow list caps at 64rem, centered; prose caps
  at 46rem.
- Long text (copy, design, prompts, persona detail) lives in the viewer's side panel, not in lists.
- Spacing steps of 2, 4, 6, 8, 10, 12, 16, 20, 24, 32px. Grids use `auto-fill`.
- Under 900px the editor and viewer narrow.

## Elevation & Depth

Mostly flat. Buttons and cards are drawn with `--shadow-border` (a hairline plus a trace of
shadow), which darkens on hover (`--shadow-border-hover`). Things floating over content — the
hover preview, the note composer, the toast, play buttons — use `--shadow-float`.
Media gets an inset hairline (`--media-outline`) so white images keep their edge. Never a border
and a shadow on the same element.

## Shapes

`--radius-sm` (6px) for controls, thumbnails and small marks; `--radius` (10px) for cards, frames
and panels. A segmented track is 8px around 6px segments. Circles only for status dots, round play
and nav buttons. A dashed border means empty or a draft.

## Components

- **Button** `.btn`: white with a shadow border; `--primary` near-black fill; `--mini` small;
  `--icon` square. Presses scale to 0.97. Toggle buttons use `aria-pressed`. Small controls are
  `--control-h-sm` (26px) tall, the rest `--control-h` (32px).
- **Segmented control** `.tabs` / `.chips`: a `--fill` track; the selected segment is white and
  raised. Used for page tabs, status filters, clip takes and plan versions.
- **Step bar** `.flow-steps`: underlined tabs with a progress dot and count.
- **Markdown editor** `.mde`: rendered markdown; a block or table cell turns into its raw text on click, framed
  by a hairline (a cell by a 1.5px `--fg` inset). Grips (`--faint`) sit in a margin outside the content and show on hover: left of a block; for a table, the
  hovered column's in a strip above the header, the hovered row's in a left gutter.
  A 2px `--fg` line marks where a drag drops. A clicked grip selects its block, row or column (`--fill`) and opens a
  floating menu (`--shadow-float`), Delete last under a hairline. "New row" shows under a hovered table. Selected text gets a floating Comment button; notes on the text list
  beside it like the editor's, their quotes marked with `--fill-strong` and an underline.
- **Input / select** `.input` `.select` `.field`: 32px, 1px `--line` border that darkens on hover.
  `.select--ghost` drops the border (navigation bar switcher).
- **Badge** `.badge`: status dot and word. **Pill mark** `.pill-mark`: a `--fill` tag.
- **Media card** (Board and Media): a media frame at the render's own ratio; name, ID or status show
  on hover over a dark fade. Media cards add select and action buttons on hover.
- **Media frame** `.media-frame`: media on `--media-bg` with the inset hairline; zooms 2% on hover.
- **Details** `.param`: side panels list everything as a small muted label over its value, grouped
  by space, never by dividers. Copy buttons show on hover.
- **Viewer** `.vw`: the media fills the left side (full height or full width) on `--bg-subtle`; the
  top bar and round prev/next float over it, shown only while the pointer is on the media (always on
  touch screens); 420px panel on the right. Prev/next wrap around at the ends.
- **Player** `Player.js`: every video and audio uses Studio's own controls, never the browser's:
  play, time, progress, mute and full screen, each its own floating round or pill control. On video
  they float at the bottom and show only while the pointer is on the picture; clicking the picture plays or pauses.
  In the viewers: Space plays / pauses; once a video is started, ← / → step one frame (Shift: 5 s),
  otherwise they and ↑ / ↓ move between files. Library videos mark scene cuts on the progress bar
  (hover shows that moment's frame, time and scene) and show their transcript as captions (toggle);
  library audio shows its waveform and transcript (the word being said lit) above the controls.
  The guide button cycles overlays on any video or image, and on the editor's preview: the 4:5 and 1:1
  feed crops it can be cut to, then (9:16 only) Meta's Reels safe zone, then off.
- **Trim panel** `.trim`: a floating panel above the editor's timeline: the clip's picture, its whole source as two
  strips (frames, waveform), and the part it plays as a dark-edged selection over both to drag (edges, or the middle
  to slide); letting go plays the new cut.
- **Toast** `.toast`: near-black, bottom center, slides up 6px.
- **Focus**: always visible, `--focus-ring`.

## Motion

Only to show a change of state; nothing animates on page load. Ease-out (`--ease-out`): `--dur`
150ms for color, shadow and hover reveals, `--dur-press` 120ms for presses, `--dur-enter` 180ms for
a panel or toast appearing and the media zoom. Animate transform and opacity, never `all`.
Everything stops under reduced motion.

## Do's and Don'ts

- Do use the `:root` variables; add one there before using a new value.
- Do keep color for status; show selection with the raised segment or the underline.
- Do put long text in the viewer panel and keep lists to one line per field.
- Don't add gradients, tints, colored icon backgrounds or a second accent.
- Don't add a second font, a third radius, or a border plus a shadow.
- Don't let the interface compete with the ads: no decoration, icons 13–16px and muted.
