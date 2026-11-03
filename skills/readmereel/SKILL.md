---
name: readmereel
description: Turn a code repository's README into a 25-second launch video, a wide 16:9 MP4 for the README and launch sites, a vertical 9:16 MP4 for X, LinkedIn, Reels and TikTok, and a GIF, rendered locally for free with HyperFrames. Use this whenever someone asks for a launch video, promo video, demo reel, announcement video, README GIF, or a video or clip to share their project, repo, library, CLI or app, even if they don't say "readmereel".
license: MIT
metadata:
  version: 0.1.0
  author: taufiquebuilds
---

# readmereel

You turn the repo you are in into a short launch video. You write the words; a script renders the video. Never write animation code: the scenes are fixed templates.

## 1. Read the repo

Read the README first, then the package manifest (package.json, pyproject.toml, Cargo.toml, go.mod), the docs folder and the image files in the repo. Look for:

- what it is called and what it does in one line
- the pain it removes, in the user's words
- three things it does for the user
- the command a user runs first (install or quick start)
- real screenshots or diagrams (`docs/`, `assets/`, `.github/`, `images/`, `screenshots/`, image links in the README that point to files in the repo)
- a logo (PNG or SVG) and a brand colour (from the logo, the README badges or the CSS)
- the GitHub URL (from `git remote get-url origin`) and, if `gh` works, the star count: `gh repo view --json stargazerCount -q .stargazerCount`

## 2. Write launch-video/story.json

Create the folder `launch-video/` at the repo root and write `launch-video/story.json`. Paths are relative to the repo root. Fields, with hard limits the script enforces:

| Field | Limit | Write it as |
| --- | --- | --- |
| `name` | 24 characters | The product name exactly as the README writes it |
| `problem` | 70 characters | The user's pain, not the product: "Every AI deck looks the same". Aim for about 6-9 words so viewers can read it |
| `promise` | 60 characters | The outcome the user gets: "Slides that look designed by a person". About 6-9 words |
| `features` | exactly 3 | Each `{ "title", "detail", "image" }` |
| feature `title` | 40 characters | A result, not a component name: "Never sends a month twice" |
| feature `detail` | 80 characters | One plain sentence on how or why, about 12 words |
| feature `image` | optional | Path to a real screenshot in the repo that shows this feature: PNG, JPG, WebP or SVG. An animated GIF shows as a single frame, and video files are not accepted. Prefer images whose text is large enough to read at small size; skip ones that are mostly empty or unreadable. Leave it out if there is none. Never make or fetch one. |
| `install` | 48 characters | One command, one line, exactly as the README gives it; if it is longer, use the shortest real first command. Never use a placeholder like `<your-username>`: use a real example value the README itself uses, e.g. `repoheat dashboard --user ratatui` |
| `url` | 60 characters | `github.com/owner/repo`: no `https://`, no `.git`. Turn `git remote` output such as `git@github.com:o/r.git` or `https://github.com/o/r.git` into `github.com/o/r` |
| `stars` | | The star count, or `null`. Shown only when 10 or more |
| `logo` | optional | Path to a PNG or SVG logo |
| `accent` | | Hex colour like `#0f766e`; the brand colour, else leave it out |
| `music` | optional | Only if the user gives you an audio file (mp3, m4a, wav or ogg) |
| `endCard` | | Leave it out (true). Set `false` only if the user asks for no "made with readmereel" line |

Example:

```json
{
  "name": "agencyrecap",
  "problem": "Monthly client reports, built and sent by hand",
  "promise": "Monthly client reports that send themselves",
  "features": [
    { "title": "Branded PDF every month", "detail": "Your logo and colour, emailed to each client on the day you pick", "image": "docs/images/report-page-2.png" },
    { "title": "One dashboard", "detail": "See which reports went out and send again in one click", "image": "docs/images/dashboard.png" },
    { "title": "Never sends twice", "detail": "Holds and retries when Google or email fails, then tells you" }
  ],
  "install": "docker compose up -d",
  "url": "github.com/taufiquebuilds/agencyrecap",
  "stars": null,
  "accent": "#0f766e"
}
```

Any field not in this table is rejected, so a typo is caught. Copy rules: short words, no hype ("revolutionary", "supercharge", "seamless", "unlock"), no emoji, no exclamation marks, sentence case, numbers as digits. Every claim must be something the repo shows.

## 3. Show the user the scenes and wait

Before rendering, show the six scenes as a numbered list and ask for "ok" or changes:

1. Hook (3 s): `problem`
2. Title (3 s): `name`, `promise`
3. Feature 1 (4 s): title, detail, image file or "text card"
4. Feature 2 (4 s): same
5. Feature 3 (4 s): same
6. Install + star (7 s): `install`, "Star on GitHub", `url`

## 4. Render

`scripts/render.mjs` lives in the folder that contains this SKILL.md. Work out its absolute path and run this from the repo root:

```bash
node <absolute-path-to-this-skill-folder>/scripts/render.mjs launch-video/story.json
```

It needs Node 22+ and ffmpeg and prints how to install either if missing. It needs internet access on every run: npm (HyperFrames), a one-time Chrome download, Google Fonts and the GSAP CDN. Rendering takes 3-10 minutes, so run the command with a timeout of at least 15 minutes, or in the background and wait for it to finish. If the sandbox blocks the network, ask the user to allow it, or give them the exact command above and ask them to run it themselves.

Add `--draft` for a faster, lower-quality render when the user only wants a quick look.

If it prints story problems or layout problems, fix `story.json` (shorten the named text) and run it again. If a render fails, read the end of `launch-video/render.log`.

## 5. Hand over

Tell the user what was made:

- `launch-video/video-16x9.mp4`: README, Product Hunt, Show HN, YouTube
- `launch-video/video-9x16.mp4`: X, LinkedIn, Instagram Reels, TikTok
- `launch-video/video.gif`: paste at the top of the README with `![<name> launch video](launch-video/video.gif)`
- `launch-video/wide/` and `launch-video/tall/`: editable HyperFrames projects. They are rebuilt on every run, so copy one elsewhere before editing it in HyperFrames Studio (`cd launch-video/wide && npx --yes hyperframes@0.9.9 preview`)

Give the user the exact absolute command you ran (with its `launch-video/story.json` path) so they can re-render without an agent. To change words later, they edit `story.json` and run the same command again. Suggest adding `launch-video/wide/`, `launch-video/tall/` and `launch-video/render.log` to `.gitignore`. If no feature had a real image, say that adding a screenshot to the repo makes the video stronger.
