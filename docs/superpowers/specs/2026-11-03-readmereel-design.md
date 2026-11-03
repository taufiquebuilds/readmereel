# readmereel: design

Date: 2026-11-03
Status: approved, implemented in v0.1.0

## Goal

An open-source agent skill that turns any code repository's README into a short launch video. Inside a repo, the user tells their agent "make a launch video for this repo" and gets a wide video, a vertical video and a GIF, rendered locally for free.

v1 is done when the skill, run by Claude Code on each of four real repos (nopurple, agencyrecap, repoheat, launchday), produces both videos and the GIF with no hand edits, and those four videos are in the readmereel README.

## Decisions

| Topic | Decision |
| --- | --- |
| Shape | Agent skill (Claude Code, Codex, Cursor), installed like nopurple |
| Output | `video-16x9.mp4` (1920×1080), `video-9x16.mp4` (1080×1920), `video.gif`, plus editable source |
| Length | About 25 seconds, 30 fps |
| Audio | Silent by default; optional user-supplied music file |
| Engine | HyperFrames (Apache-2.0) renders HTML + GSAP to MP4 locally; ffmpeg makes the GIF |
| Scenes | Fixed templates filled from data; the agent does not write animation code |
| Branding | Small "made with readmereel" line on the last scene, on by default, removable |
| Licence | MIT |
| Repo | `taufiquebuilds/readmereel` |

## Not in v1

Voiceover or TTS, AI video-generation models, a hosted web app, screen recordings of a live demo, languages other than English, more than one visual style.

## User flow

1. Install the skill (plugin marketplace for Claude Code; copy the skill folder for other agents).
2. In a repo, ask: "make a launch video for this repo". Optional: "use music.mp3", "no end card".
3. The agent reads the repo, writes `launch-video/story.json`, shows the user the six scene texts and waits for "ok" or edits.
4. The agent runs the render script. About 1–3 minutes later `launch-video/` holds both MP4s and the GIF.
5. The user can edit `story.json` and run the render script again without the agent.

## The story

The agent extracts these fields into `launch-video/story.json`. A JSON Schema file in the skill defines them, and the render script refuses to run if the file does not match.

| Field | Rule | Example |
| --- | --- | --- |
| `name` | Repo or product name, 1–24 chars | `nopurple` |
| `promise` | One sentence, ≤ 60 chars | `Slides that look designed by a person` |
| `problem` | The pain, ≤ 70 chars | `Every AI deck looks the same` |
| `features` | Exactly 3 items, each `{title ≤ 40 chars, detail ≤ 80 chars, image?}` | |
| `install` | One shell command, ≤ 70 chars | `/plugin install nopurple@nopurple` |
| `url` | The repo URL | `github.com/taufiquebuilds/nopurple` |
| `stars` | Integer or null; shown only when ≥ 10 | `null` |
| `logo` | Optional path to a PNG or SVG in the repo | `docs/logo.svg` |
| `accent` | Hex colour; taken from the logo or brand, else a default | `#0f766e` |
| `music` | Optional path to an audio file | |
| `endCard` | `true` by default | |

`image` on a feature is a path to a real screenshot or GIF frame found in the repo. If a feature has no image, its scene shows the detail text as a large typographic card. The agent never invents screenshots.

## Scenes

Six scenes, 25 seconds at 30 fps. Each scene is one HyperFrames sub-composition with a wide and a vertical layout, styled from `accent` and two bundled fonts.

| # | Scene | Length | Shows |
| --- | --- | --- | --- |
| 1 | Hook | 3 s | `problem` in large type |
| 2 | Title | 3 s | logo (if any), `name`, `promise` |
| 3–5 | Feature 1–3 | 4 s each | feature `title`, `detail`, and `image` in a device-style frame when present |
| 6 | Install + CTA | 7 s | `install` typed out in a terminal card, then `url`, "Star on GitHub", `stars` when ≥ 10, and the end-card line |

Text never shrinks below 28 px at 1080 wide. The length limits in the schema exist so every allowed string fits both layouts; a test renders the longest allowed strings to prove it.

## Architecture

```
readmereel/
  .claude-plugin/          plugin + marketplace manifests
  skills/readmereel/
    SKILL.md               what to read in the repo, how to write story.json, when to ask the user
    story.schema.json      the story contract
    template/              HyperFrames project: index.html + compositions/ (6 scenes × 2 layouts) + assets/fonts
    scripts/
      render.mjs           validate story.json → copy template → inject story → render 16:9 and 9:16 → make GIF
  examples/                story.json + rendered videos for the four real repos
  tests/                   schema tests, longest-text render, output checks with ffprobe
  docs/                    images for the README
  README.md, LICENSE
```

- `render.mjs` is Node (HyperFrames is an npm tool). It needs Node 20+, ffmpeg and Chrome, and checks for them first with a clear message for each missing one.
- The story is injected through HyperFrames variables, so the scene HTML stays unchanged per run and the user's `launch-video/` folder holds an editable HyperFrames project.
- The GIF is made from the 16:9 render: 960 px wide, 12 fps, a two-pass palette, kept under 8 MB by cutting to the first 12 seconds if needed.

## Errors

- Missing tool (Node, ffmpeg, Chrome) → stop with the install command for that tool.
- `story.json` fails the schema → print each failing field and its rule; render nothing.
- A referenced image or music file is missing → stop and name the file.
- A render fails → keep the HyperFrames log in `launch-video/render.log` and say where it is.

## Testing

- Schema tests: valid and invalid stories.
- Longest-text test: render a story where every field is at its maximum length, in both layouts, and assert with HyperFrames' layout check that nothing overflows.
- Output test: `ffprobe` confirms each MP4's size (1920×1080, 1080×1920), 30 fps and 24.5–25.5 s; the GIF exists and is under 8 MB.
- CI: a GitHub Actions job runs the tests and renders one example on every push.
- Manual: run the skill end to end in Claude Code on the four example repos and watch every video.

## Risks

- **HyperFrames is young (v0.9) and run by HeyGen.** The first build task proves it renders locally with no account and no usage limit. If it does not, stop and switch to a small own renderer (headless Chrome + ffmpeg).
- **Repos without screenshots** get text-only feature scenes, which are less striking. The README tells users that adding a screenshot to their repo improves the video.
- **The agent might write weak copy.** SKILL.md gives concrete rules and examples (problem as the user's pain, promise as an outcome, features as results) and always shows the scene texts to the user before rendering.
