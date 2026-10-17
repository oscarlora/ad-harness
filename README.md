# The All-in-One Ad Production Kit (ADPK)

Everything you need to make Meta ads with Claude, Codex or any AI agent: skills and tools to go from
idea to ready-to-launch ad.

This is for people who make ads:
- Creative strategists
- copywriters
- video editors
- designers
- business owners
- etc

And can be used on your own or in collaboration.

Built on what I ([@oscarlorak](https://x.com/oscarlorak)) learned making ads for ecommerce brands:
7+ years, 2,000 ads and $20M+ in ad spend.

## Get started

1. Install an AI agent (Claude, Codex, Cursor…) and pick its model:
   - **Claude:** Opus 5.5, medium (the repo sets it for Claude Code)
   - **OpenAI:** GPT-6.1 Sol, medium
   - **xAI:** Grok 4.7, default effort
   - **Meta:** Muse Wonder, default effort
2. Tell it: *"Set up the Ad Production Kit from https://github.com/oscarlora/ad-production-kit"*, and
   click **Allow** when it asks to run the install. No admin password needed.
3. When it asks, get a [kie.ai key](https://kie.ai/api-key) and paste it into the file the agent opens.
   It's the one key you need to start.

Then say *"Make an image ad for &lt;your brand's website&gt;"*.

Rather use Terminal? On macOS or Linux, paste
`curl -fsSL https://raw.githubusercontent.com/oscarlora/ad-production-kit/main/tools/setup.sh | bash`,
then open your agent in `~/ad-production-kit` and say *"Finish setting up ADPK"*.

Later, only if you need them ([.env.example](.env.example)): a
[Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) bucket so a team shares brands, and
Google Drive or Notion for uploads. ADPK runs on macOS, Windows and Linux.

## What you can do with it

- **Image ads:** static ads with high product fidelity.
- **Scripts:** for creators to film, or for any video.
- **Podcast video ads:** clips of AI characters that feel taken from a long-form podcast.
- **Song video ads:** animated characters singing a relatable story while selling your product.
- **Animated video ads:** animated characters speaking or acting out your script, in Pixar,
  claymation or any animation style.
- **Slides video ads:** a narrated explainer, one illustrated slide per line.
- **UGC edits:** a creator's footage checked against the script, then cut into the ad.
- **Short recuts:** sub-30 s versions recombined from a finished talking-head or UGC edit.

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
   A creator's footage is first checked against the script. A finished talking-head edit can be recut into shorter ads from the same footage.
6. **Review and upload:** *"Open the studio"* — the local web app: **Board** (review ads),
   **Media** (search the library), **Workflow** (each ad's progress, its brief to edit live, and its edit). Approved ads are uploaded to
   Google Drive, Notion, or anywhere you set up (e.g. Dropbox). Anything you or a client want
   remembered goes into the brand's memory, so the next ads follow it.

**Working solo:** everything stays on your computer. With cloud storage set up, say *"push Acme"*
when you finish to back it up.

**Working as a team:**

Teams share brands through cloud storage:

- At the start of every session: *"Update ADPK and pull Acme"* — the latest ADPK and the
  latest brand files. Updating never touches your brand work or `.env`.
- At the end of your work: *"Push Acme"*. The sync warns before overwriting someone's newer work.
- Share each workspace's `.env` block through a password vault, and propose ADPK changes as a
  pull request.

## How it's organized

- [`AGENTS.md`](AGENTS.md) — the rules every agent reads first
- `skills/` — step-by-step procedures, one folder per skill
- `tools/` — the scripts the agent runs (each has `--help`)
- `studio/` — the local web app
- `workspaces/` — your brands, never committed; local, or synced to the workspace's R2 bucket

## License

Do whatever you want with this. [MIT License](LICENSE).
