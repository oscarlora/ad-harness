# The All-in-One Ad Production Kit

Everything you need to make Meta ads with Claude, Codex or any AI agent: skills and tools to go from
idea to ready-to-launch ad. Creative strategists, copywriters, video editors, designers and business
owners use it on their own or as a team.

Built on what I ([@oscarlorak](https://x.com/oscarlorak)) learned making ads for ecommerce brands:
7+ years, 2,000 ads and $20M+ in ad spend.

## Quick start

1. Open Terminal (on a Mac: press ⌘ Space, type *Terminal*, press Enter).
2. Paste this line and press Enter:

   ```
   curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash
   ```

   (On Linux, if it says `curl` is missing, first run `sudo apt install curl`.)
3. Wait a few minutes. You'll see a welcome message that explains how it works and what to say to
   your AI agent. No API keys needed to start.

On Windows, or if you'd rather not use Terminal: install an AI agent (Claude Code, Codex, Cursor…)
and tell it *"Set up the Ad Production Kit from https://github.com/oscarlora/ad-production-kit"*.

## What you can do with it

- **Image ads:** static ads with high product fidelity.
- **Scripts:** for creators to film, or for any video.
- **Podcast video ads:** clips of AI characters that feel taken from a long-form podcast.
- **Song video ads:** animated characters singing a relatable story while selling your product.
- **Animated video ads:** animated characters speaking or acting out your script, in Pixar,
  claymation or any animation style.
- **Slides video ads:** a narrated explainer, one illustrated slide per line.

## How it works

Everything runs through your agent: say what you want in plain words.

1. **Research:** *"Research Acme's greens powder."* The agent reads the brand's site and reviews and
   writes up the product, who buys it (personas) and why (angles).
2. **Concept:** *"Make an image ad for Acme"* — or a script, or a podcast, song, animated or
   slides video ad. The agent offers 3 different concepts (persona, angle, hook); you
   pick one.
3. **Write:** hooks, script and on-screen copy.
4. **Make:** the design or storyboard, then images, voices, music and video clips. You see and
   approve each step before the next.
5. **Edit:** clips, captions, music and effects are cut into the final video. You watch it in the
   studio and click on the video to leave notes; the agent applies them while you watch, then exports.
6. **Review and upload:** *"Open the studio"* — the local web app: **Board** (review ads),
   **Media** (search the library), **Workflow** (each ad's progress and its edit). Approved ads are uploaded to
   Google Drive, Notion, or anywhere you set up (e.g. Dropbox). Anything you or a client want
   remembered goes into the brand's memory, so the next ads follow it.

**Working solo:** everything stays on your computer. With cloud storage set up, say *"push Acme"*
when you finish to back it up.

**Working as a team:**

Teams share brands through cloud storage:

- At the start of every session: *"Update the kit and pull Acme"* — the latest kit and the
  latest brand files. Updating never touches your brand work or `.env`.
- At the end of your work: *"Push Acme"*. The sync warns before overwriting someone's newer work.
- Share each workspace's `.env` block through a password vault, and propose kit changes as a
  pull request.

## Setup details

**Requirements:** macOS, or Linux on x64 or arm64 (glibc; not Alpine) with `curl` and `git`, about
1 GB of disk, and no admin password. On Windows, clone the repo and run
`powershell -ExecutionPolicy Bypass -File tools\setup.ps1`.

**What the command does** ([`tools/setup.sh`](tools/setup.sh); re-run it any time, it skips what's done):

- downloads the kit to `~/ad-production-kit` (`… | bash -s -- <folder>` for another folder; inside
  a checkout, run `bash tools/setup.sh`), asking macOS to install git first if it's missing
- installs Node 24 in `~/.local/node` unless Node 22.15+ is already there, and on macOS ffmpeg 8 in
  `~/.local/bin`
- adds both to your PATH in your shell's startup files (zsh: `~/.zprofile`, `~/.zshrc`; bash:
  `~/.bashrc` and `~/.profile` or `~/.bash_profile`; fish: `conf.d`)
- installs the npm packages of the tools and the studio, and pulls the public shared library (music,
  sound effects, references)
- prints the welcome; on any failure it stops and says how to fix it

**Doing it by hand:** install Node 22.15+, then `git clone https://github.com/oscarlora/ad-production-kit`,
`cd ad-production-kit`, `npm install`, `npm install --prefix studio`, and
`node tools/sync-brand.mjs --pull workspaces/Shared/Library --originals`. Open the studio with `npm run studio`.

**Later, when a step first needs it** (the agent or the tool says how to get it):

- **Keys** ([.env.example](.env.example)):
  - **Generation:** at least one of [Segmind](https://www.segmind.com), [kie.ai](https://kie.ai) or
    the [Vercel AI Gateway](https://vercel.com/ai-gateway); the Gateway also runs the media library.
  - **Cloud storage (teams; optional solo):** a
    [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) bucket the team and their
    agents pull from and push to.
  - **Uploads (optional):** Google Drive, Notion.
- **ffmpeg 8** for video and audio (macOS setup installs it; on Linux, a static build in `~/.local/bin`)
- **Python 3 with Pillow** for the brand's type sheet, and **yt-dlp** for pulling social links
- **A browser** for video export: Chrome or Edge, else a Chromium the first export downloads (on
  Linux it may also need `sudo npx playwright-core install-deps chromium`)

## How it's organized

- [`AGENTS.md`](AGENTS.md) — the rules every agent reads first
- `skills/` — step-by-step procedures, one folder per skill
- `tools/` — the scripts the agent runs (each has `--help`)
- `studio/` — the local web app
- `workspaces/` — your brands, never committed; local, or synced to the workspace's R2 bucket

## License

Do whatever you want with this. [MIT License](LICENSE).
