# Ad Harness

AI ad agent for ecommerce brands — image and video Meta ads, made with any coding agent (Claude Code,
Codex, Cursor…). [AGENTS.md](AGENTS.md) is how the system thinks and the rules the agent follows;
this is how humans set up and work.

## Where things live

- **This repo** — skills and tools. `main` is the source of truth; only the maintainer merges.
- **Brand work** — Cloudflare R2, one bucket per workspace (`tools/sync-brand.mjs`). Never in the repo.
- **Keys** — your local `.env`, assembled from the team vault. Never in the repo.
- **Client delivery** — Google Drive + Notion, pushed when ads are approved.

## Setup (once — macOS or Windows)

1. Install a coding agent that reads `AGENTS.md` (Claude Code, Codex, Cursor…).
2. Install git — macOS: run `git` once in Terminal and accept the tools install · Windows: `winget install Git.Git`.
3. `git clone https://github.com/oscarlora/ad-harness.git && cd ad-harness`
   — a **fresh clone into a new folder**; never reuse an older Ad Harness or brand-share copy.
4. Create `.env` from `.env.example` and paste the block the maintainer sent you. **Never paste keys
   into the chat** — the agent reads `.env` from disk.
5. Run setup — macOS: `bash tools/setup.sh` · Windows: `powershell -ExecutionPolicy Bypass -File tools\setup.ps1`.
   macOS: installs Node, the GitHub CLI, ffmpeg, and app deps. Windows: installs
   Node and app deps, and checks the rest (ffmpeg, Python) with install hints. Both print a health
   check. Re-run any time.
6. Drive, if your workspace uses it: `node tools/connect-drive.mjs <oauth-client.json> <WORKSPACE>`
   — sign in with your own Google account. The maintainer sends the json.
7. Optional, macOS: install [Palmier Pro](https://www.palmier.io), the recommended video editor
   (the agent drives it). Without it, videos are edited with ffmpeg (**edit-video**).
8. **Open your agent in the Ad Harness folder itself** — not a parent folder. Its project config only
   works from the repo root.
9. Test: say *"pull \<brand\> and open the studio."*

GitHub sign-in (`gh auth login`) is optional — only needed the first time you propose a harness
change. Run it **yourself in Terminal** when that day comes; it needs a real keyboard and can't be
driven by the agent.

## Daily use

Everything runs through your agent — no git commands, ever.

- **"Update Ad Harness"** — get the latest version. Never touches brand work or `.env`.
- **"Pull \<brand\>"** to start, **"push \<brand\>"** to stop — work lives in R2, so anyone can take over.
- **"\<skill\> should …"** — your agent opens a PR. Once merged, everyone gets it on next update.
- **"Open the studio"** — the local app (`node studio/dev.mjs`) for every brand: the ads **Board**,
  the **Media** library and the **Workflow** page (each ad's progress); it updates live as ads render.

## Rules

- Harness changes go through a PR, never a direct edit.
- One driver per brand at a time. The sync warns you before overwriting someone's newer work.
- Push to R2 when you stop.
- The rest (updating, keys, client data) the agent follows from [AGENTS.md](AGENTS.md).

## Maintainer

- Merging to `main` is releasing; the team gets it at next update.
- New teammate: mint their R2 token (scoped to their workspace's bucket) and generation keys (Segmind,
  kie and the AI Gateway, which the media library needs; order in AGENTS.md), share the Drive folders
  with their Google account, add their `.env` block to the vault, invite them to this repo, run setup
  together.
- Offboarding: revoke their tokens, unshare Drive, remove from the repo.

## License

MIT. See [LICENSE](LICENSE).
