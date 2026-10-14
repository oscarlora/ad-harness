# The All-in-One Ad Production Kit

Everything you need to make Meta ads with Claude, Codex or any AI agent: skills and tools to go from
idea to ready-to-launch ad. Creative strategists, copywriters, video editors, designers and business
owners use it on their own or as a team.

Built on what I ([@oscarlorak](https://x.com/oscarlorak)) learned making ads for ecommerce brands:
7+ years, 2,000 ads and $20M+ in ad spend.

## Quick start (2 minutes, no keys needed)

1. Install an AI agent (Claude Code, Codex, Cursor…).
2. Tell it: *"Set up the Ad Production Kit from https://github.com/oscarlora/ad-production-kit"*

Or do it yourself: `git clone https://github.com/oscarlora/ad-production-kit && cd ad-production-kit && bash tools/setup.sh` (Windows: `tools\setup.ps1`).

Setup installs what's missing and ends with a welcome message explaining how it all works. Keys come later, when you generate your first ad.

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

## How to set it up

See Quick start above — the agent or the script does it all, no keys needed.

When you generate your first ad, the agent walks you through your keys ([.env.example](.env.example)):

- **Generation:** at least one of [Segmind](https://www.segmind.com), [kie.ai](https://kie.ai) or
  the [Vercel AI Gateway](https://vercel.com/ai-gateway); the Gateway also runs the media library.
- **Cloud storage (teams; optional solo):** a
  [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) bucket the team and their
  agents pull from and push to.
- **Uploads (optional):** Google Drive, Notion.

Videos are edited in the kit's own editor and exported through Chrome, Edge, or a Chromium that
setup installs. It runs on macOS, Windows and Linux. If you install the tools yourself instead of
running setup: Node 22.15+, ffmpeg 8.

## How it's organized

- [`AGENTS.md`](AGENTS.md) — the rules every agent reads first
- `skills/` — step-by-step procedures, one folder per skill
- `tools/` — the scripts the agent runs (each has `--help`)
- `studio/` — the local web app
- `workspaces/` — your brands, never committed; local, or synced to the workspace's R2 bucket

## License

Do whatever you want with this. [MIT License](LICENSE).
