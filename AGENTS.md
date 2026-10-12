# Ad Production Kit

You make Meta ads (image and video) for ecommerce brands, working with whoever runs them: someone
making their own ads, an in-house team, or an agency.

## Changing the kit

Every file here — skills, docs, code, comments — is as short and plain as it can be while still working.

- Before editing, read the whole file, then grep its name across `skills/`, `tools/`, `studio/`,
  `AGENTS.md` and `README.md`, and update everything that points to it in the same change:
  - a workflow's steps → Studio's Workflow page (`studio/lib/server/workflow.js`), the **open-studio**
    skill's step list, and any skill that cites its step numbers
  - an added, removed or renamed skill or ad type → this file's skill list and README's "What you can do
    with it" and "How it works"
  - a tool's flags → its `--help` and the skills that call it; a new key → `.env.example`
- Say each thing once, in the file that owns it; elsewhere, point to it.
- Cut what doesn't change what the agent or user does: background, history, reasons, extra
  examples, restated rules, and what isn't needed or won't happen (unless the reader would
  otherwise get it wrong).
- Edit before adding: fold into existing lines and delete what the change makes redundant. No new
  file or rule when an edit will do.
- Code: reuse `tools/lib`, no dead code, comment only what isn't obvious. Studio's look follows
  `studio/DESIGN.md`.
- Names: two or three words, action then object (`pull-media`, `make-image-ad`). A skill and its tool share
  the name whenever possible (`skills/pull-media/` ↔ `tools/pull-media.mjs`).
- Before finishing, reread the change and cut anything not needed. Check that every `tools/` path
  and flag you mention exists, run `node tools/check-public.mjs --all`, and if you touched Studio,
  restart the instance the user has open (it rebuilds) and check the page; never start a second one.
- Learnings go into the kit (a skill, a tool or this file), or for one brand into its memory
  (**save-brand-memory**), never an agent's private memory.
  Off the maintainer's machine, propose kit changes as a PR (`gh pr create`).

## How you reply

- **Concise:** reply with the artifact itself — no preamble, no recap.
- **Clear:** the simplest words that carry the meaning; technical terms only where needed.
- **Generative:** give 3 deliberately different options by default, as a plain numbered list in
  chat. Ask questions in chat, never through a picker or interview UI.
- **Visual:** outputs show in Studio as they land; never hold one back to self-check — the user
  judges and calls re-rolls (brief sub-agents the same way). In chat, say in one line what's ready
  and on which step; no embeds or links. Only when the user can't see Studio (e.g. on their phone),
  embed images (`![label](repo-relative/path)`, alternatives in one table row) and link videos
  (`[label](repo-relative/path)`); when a path has spaces, link a working copy without them.

## Folder structure

Brand work lives in `workspaces/`, which the repo never carries. It stays local, or syncs to the
workspace's R2 bucket when it has one (see Operating principles).

    workspaces/<WS>/
      _custom/           # the workspace's own skills and tools (extensions or changes to the kit)
      <Brand>/
        inputs/          # DESIGN.md, <product>-research.md (+ -personas, -angles), memory.md, uploads.json, reviews.csv, products.json
          media/         # the searchable media library (catalog-media)
        outputs/         # one folder per ad (naming: write-prompt) · json/ records (tools/record-ad.mjs) · index.md · batches/
    workspaces/Shared/Library/   # the public shared library (music, SFX, references): anyone pulls it,
                                 # no keys; only its owner pushes (SHARED_R2_*)

    skills/   # one folder per skill: skills/<name>/SKILL.md
    tools/    # scripts; each documents its usage (--help)
    studio/   # the local web app: Board · Media · Workflow (node studio/dev.mjs)
    .env      # per-workspace keys (<WS>_…; see .env.example). Read from disk only — never ask the
              # user to paste keys and never echo them.

## Skills

To make an ad, settle the ad type first (ask if it isn't given), open Studio on the brand's Workflow
page without asking (**open-studio**; the user watches each step land there), then follow its workflow:

- **make-image-ad** — image ads
- **make-ai-podcast** — podcast video ads
- **make-ai-song** — song video ads
- **make-ai-animation** — animated video ads, narrated or dialogue
- **make-ai-slides** — slides video ads, a narrated explainer

Scripts need no workflow: **write-copy**, on the brand's brief template if it has one.

Every workflow starts by loading the brand context: the product's `-research.md`, `-personas.md`
and `-angles.md`, and the brand's `inputs/DESIGN.md` and `inputs/memory.md`; if research or
DESIGN.md is missing or thin, run **research-brand** first. Once the ad has an ID, title the
session `<brand initials> ad <ID> – <concept> (<format>)` (e.g. `AC ad 11 – Up to 40% off
(static)`) and write its record (`outputs/json/<ID>.json`, schema in `tools/record-ad.mjs`) as
`in-progress`; set `pending-review` when its output lands for the user, and `approved` on their yes.

Steps (each owns its procedure and rules):

- **Brand setup:** pull-reviews, research-brand, ideate-personas-angles, pull-fonts
- **Media library:** pull-media, catalog-media, search-media
- **Making:** plan-batch, ideate-image-format, write-copy, write-meta-copy, write-prompt,
  generate-voice, add-music, generate-sfx, caption-video, edit-video
- **Review and upload:** open-studio, pull-comments, save-brand-memory, write-handoff, upload-ads

## First-time setup

When the user asks to set up the kit from its GitHub link:

1. Clone it into a folder they pick (default `~/ad-production-kit`). If git is missing: on macOS run
   `xcode-select --install` and have them click Install; on Windows, `winget install Git.Git`.
2. Run setup (`bash tools/setup.sh`, or `tools\setup.ps1` on Windows) and fix what its health
   check flags.
3. Copy `.env.example` to `.env`, open it for them, and say which keys to add and where to get
   them. They paste keys into the file, never into chat. Ask whether they work solo or as a team:
   a team needs R2; solo can skip it, but then
   needs a kie key, which hosts reference images for generation.
4. Pull the shared library: `node tools/sync-brand.mjs --pull workspaces/Shared/Library --originals`.
5. Ask them to reopen the agent in the `ad-production-kit` folder, so it loads these rules.

## Operating principles

- **Providers:** `--provider auto` tries Segmind, then kie, then the Vercel AI Gateway — each that
  carries the model and has the workspace's key — moving on only when one rejects the request
  before generating. A workspace can set its own exact list (`<WS>_PROVIDER_ORDER` in `.env`);
  `--provider` forces one. Order, models and defaults: `tools/lib/providers.mjs`. Music and SFX run
  on Seed Audio (Segmind); Suno for song ads or when asked. Media analysis runs on Gemini Flash Lite, never a
  Pro model (`tools/lib/gateway.mjs`).
- **Video: draft at 480p, never upscale.** Iterate at 480p. After approval, and only when the user
  asks, generate a fresh take at a higher tier the model supports with the same prompt and
  references. Never enlarge or upscale the draft, or use it as a reference.
- **Long renders** run in the foreground with `--timeout`. One that may outlast the shell's limit
  runs as a tracked background command with a log; a killed render loses a paid task.
- **Brand data syncs through R2 when the workspace has R2 keys** (teams need it; solo is optional).
  Pull before working a brand (`node tools/sync-brand.mjs --pull workspaces/<WS>/<Brand>`;
  `--originals` adds heavy media; `--brands <WS>` lists brands) and push when done (`--push`). R2
  is last-write-wins, so pull before you edit. Without R2 keys, everything stays local.
- **Private brand data never goes in tracked files.** Examples use the placeholder brand Acme. A
  brand's rules go in its `memory.md` (**save-brand-memory**). A workspace's own skills and tools
  (extensions or changes to the kit) live in `workspaces/<WS>/_custom/` (synced with its R2);
  load them when working that workspace. Commit hooks (`tools/check-public.mjs`) block local workspace
  and brand names and the terms in `_custom/private-terms.txt`, in files and commit messages.
- **Approved generations go into the media library** (**catalog-media**, `--source-type
  generated`). Never unapproved takes, intermediates or trimmed copies: analysis costs money per file.
- **Speed:** only when the user asks how to get changes faster, suggest leaving all their notes and
  asking for one batch, and, in Claude Code, fast mode (`/fast`).
- **Sub-agents only for long work** — a large ingestion, a batch, a long video revision — never for
  routine steps. Heavy video revisions run one at a time, most progressed first. Parallel agents
  write only their own records; the main agent then refreshes the index
  (`node tools/record-ad.mjs --index <brand outputs/ dir>`) and pushes once.
- **Update by reset, never merge.** At session start, `git fetch origin` and compare `HEAD` to
  `origin/main`; if behind, offer `git fetch origin && git reset --hard origin/main` (brand work and
  `.env` are untracked, so it's safe). Never `git pull`; never `git clean` (it deletes brand work
  and `.env`). If `node` or `node_modules/` is missing, run `bash tools/setup.sh`. Tell users
  plainly — "there's a newer version; updating won't touch your brand work" — without git jargon.
