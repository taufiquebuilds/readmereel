---
name: readmereel
description: Turn a code repository's README into a 15 to 35 second launch film with kinetic type, camera moves on the real product, sound effects and automatic transitions, a wide 16:9 MP4 for the README and launch sites, a vertical 9:16 MP4 for X, LinkedIn, Reels and TikTok, a GIF, a poster and a contact sheet, rendered locally for free with HyperFrames. Use this whenever someone asks for a launch video, promo video, demo reel, announcement video, README GIF, or a video or clip to share their project, repo, library, CLI or app, even if they don't say "readmereel".
license: MIT
metadata:
  version: 0.2.0
  author: taufiquebuilds
---

# readmereel

You turn the repo you are in into a short launch film. You pick the scenes and write the words, and for a web app you may also rebuild one real screen as HTML. A script plans the timing, picks the transitions, adds sound, checks the layout and renders. Never write animation code: the scenes are fixed templates.

## 1. Read the repo

Read the README first, then the package manifest (package.json, pyproject.toml, Cargo.toml, go.mod), the docs folder and the image files in the repo. Look for:

- what it is called and what it does in one line
- the pain it removes, in the user's words
- what it does for the user, as results
- the command a user runs first (install or quick start)
- real screenshots or diagrams (`docs/`, `assets/`, `.github/`, `images/`, `screenshots/`, image links in the README that point to files in the repo)
- for a CLI: a command you can really run, and its real output
- real numbers the repo states or can print (stars, test counts, speed, sizes, supported formats)
- for a web app: the real HTML templates and CSS of its main screen
- a logo (PNG or SVG) and a brand colour (from the logo, the README badges or the CSS)
- the GitHub URL (from `git remote get-url origin`)

## 2. Choose 5 to 8 scenes

A film has 5 to 8 scenes. The first must be a `hook` and the last must be an `end`. `title` can appear once; every other type can appear twice. The film is 15 to 35 seconds: its length comes from how much text there is to read. If there is too much to read in 35 seconds, the script names the scene to cut or shorten.

| Type | Shows | Use it for |
| --- | --- | --- |
| `hook` | 1 to 3 big lines, optionally one rolling number | The pain, in the user's words. Always first |
| `title` | Logo badge, the name, one promise line | Who you are and the outcome |
| `ui` | The real product in a window; the camera pushes in on 1 to 3 boxes | A screenshot or a rebuilt screen |
| `terminal` | A command typing out and its output streaming in | A CLI or a library's usage |
| `counter` | 1 to 3 numbers counting up | Real numbers from the repo |
| `compare` | A wipe from "before" to "after" | Without and with, old way and new way |
| `list` | Exactly 3 short items, one per beat | Three results |
| `end` | Logo, name, install command typed out, "Star on GitHub", the URL. Always last | The call to action |

A starting shape for each kind of repo (adjust to what the repo really has):

- Web app: `hook, title, ui (html or image), ui or compare, counter or list, end`
- CLI: `hook, title, terminal, terminal or compare, list, end`
- Library: `hook, title, terminal (usage), compare, counter, end`

The script picks the transitions (whip, zoom, flood, blur, carry) and places the sound effects by itself. You do not choose them.

## 3. Write launch-video/story.json

Create the folder `launch-video/` at the repo root and write `launch-video/story.json`. Paths in it are relative to the repo root, the folder you render from. The script rejects any field not listed here, so a typo is caught.

### Top level

| Field | Limit | Write it as |
| --- | --- | --- |
| `version` | | `2` |
| `name` | 24 characters | The product name exactly as the README writes it |
| `url` | 60 characters | `github.com/owner/repo`: no `https://`, no `.git`. Turn `git@github.com:o/r.git` or `https://github.com/o/r.git` into `github.com/o/r` |
| `install` | 48 characters | One command, one line, exactly as the README gives it; if it is longer, use the shortest real first command. Never a placeholder like `<your-username>`: use a real example value the README itself uses, e.g. `repoheat dashboard --user ratatui` |
| `accent` | | Hex colour like `#0f766e`; the brand colour. Leave it out if there is none |
| `style` | | `midnight` (dark, the default), `paper` (light) or `signal` (the accent colour as the ground for hook, list and end). Pick `paper` or `signal` only if the brand is light or loud |
| `logo` | optional | Path to a PNG or SVG logo |
| `music` | optional | A path to an audio file the user gave you (mp3, m4a, wav or ogg), or `"heygen"`, or `null`. See "Sound" below |
| `sfx` | optional | `true` (default) or `false`. Sound effects are on unless the user asks for none |
| `endCard` | optional | Leave it out (true). Set `false` only if the user asks for no "made with readmereel" line |
| `scenes` | 5 to 8 | The list of scenes |

### Scene fields

Every scene is an object with a `type`. Each text field has a hard limit, and the limits keep every line readable in both video sizes.

| Scene | Field | Limit | Write it as |
| --- | --- | --- | --- |
| `hook` | `lines` | 1 to 3 lines; 22 characters and 4 words each | Short punchy lines: "40 clients.", "40 reports.", "Every single month." |
| `hook` | `accentWords` | optional | Words, spelled exactly as they appear in `lines`, to colour with the accent |
| `hook` | `count` | optional | `{ "line": 0, "to": 40 }`: rolls a number up to `to` in that line. The line must contain the number |
| `title` | `promise` | 60 characters | The outcome: "Monthly client reports that send themselves". About 6 to 9 words |
| `ui` | `image` or `html` | exactly one | A real screenshot in the repo, or a rebuilt screen (see below) |
| `ui` | `focus` | 1 to 3 boxes | `{ "box": [x, y, width, height], "label": "..." }`. `label` is optional, 28 characters. The camera pushes in on each box in turn |
| `ui` | `caption` | 32 characters, optional | What the viewer should take away: "Sent. By itself." |
| `ui` | `states` | up to 8, `html` only | The product acting: `{ "at": 1.2, "selector": "#row1 .status", "set": "sent" }` |
| `terminal` | `command` | 48 characters | The command, as a user types it |
| `terminal` | `output` | 1 to 12 lines; 64 characters each | Copied from really running the command |
| `terminal` | `highlight` | optional | Line numbers in `output`, counting from 0, to mark with an accent bar |
| `counter` | `items` | 1 to 3 | `{ "value": 4812, "label": "Sessions", "suffix": "%", "note": "up 10%" }` |
| `counter` item | `value` | a whole number up to 9,999,999, or one with a single decimal place | A real number from the repo |
| `counter` item | `label` | 20 characters | What is counted |
| `counter` item | `suffix` | 3 characters, optional | `%`, `×`, `ms` |
| `counter` item | `note` | 24 characters, optional | A short extra: "up 10%" |
| `compare` | `before`, `after` | one each | Each side has a `label` and either an `image` or `points` |
| `compare` side | `label` | 24 characters | "Without", "With nopurple" |
| `compare` side | `points` | 1 to 3 lines; 40 characters each | Used instead of `image` |
| `list` | `items` | exactly 3; 32 characters each | Results, not component names: "Never sends a month twice" |
| `end` | (none) | | Uses the top-level `name`, `install`, `url`, `logo` and `endCard` |

Image files for `ui.image` and `compare.image`: PNG, JPG, WebP or SVG. Prefer images whose text is large enough to read at small size. A GIF is read as a single frame, and video files are not accepted.

Example, for a small CLI (the `output` line is a placeholder: use the real output):

```json
{
  "version": 2,
  "name": "repoheat",
  "url": "github.com/taufiquebuilds/repoheat",
  "install": "repoheat dashboard --user ratatui",
  "accent": "#ea580c",
  "style": "midnight",
  "music": null,
  "scenes": [
    { "type": "hook", "lines": ["Whose repos", "are really alive?"], "accentWords": ["alive?"] },
    { "type": "title", "promise": "A heat map of any GitHub user's repos" },
    { "type": "terminal", "command": "repoheat dashboard --user ratatui", "output": ["<the real output, line by line>"], "highlight": [0] },
    { "type": "list", "items": ["One command", "No token needed", "Runs offline"] },
    { "type": "end" }
  ]
}
```

Copy rules: short words, no hype ("revolutionary", "supercharge", "seamless", "unlock"), no emoji, no exclamation marks, sentence case, numbers as digits.

### Real material only

Every claim must be something the repo shows. The film must never contain anything you made up.

- **Terminal:** run the command and copy the real output. If you cannot run it (it needs a key or a service), use the sample output the README itself shows. Keep each line to 64 characters and shorten by dropping lines, not by editing them. If the output has too many lines or lines too wide to read, the script warns you: use fewer or shorter lines.
- **Numbers:** only from the repo: its docs, its tests, its real output, or `gh repo view --json stargazerCount -q .stargazerCount`. Never round up, never guess.
- **Screenshots:** only images that are already in the repo. Never make, fetch or edit one. If there is none, use `terminal`, `list` or `counter` instead, or rebuild a screen (below).
- **Logo and colours:** only from the repo.

### Focus boxes for an image

A `box` is `[x, y, width, height]` in the image's own pixels, measured from its top-left corner. Get the image size first: `sips -g pixelWidth -g pixelHeight docs/dashboard.png` on macOS, `file docs/dashboard.png` anywhere, or read the PNG itself. Then pick the part of the screenshot the label is about, with a little space around it. Keep the box inside the image. Give each box a `label` (28 characters or less) that says what the viewer is looking at.

### Rebuilt screens (`ui` with `html`)

For a web app you can rebuild one real screen as a static HTML file, such as `launch-video/screens/dashboard.html`, and set `"html"` to its path. Do this when the product has no good screenshot or when you want to show it acting.

- Copy the markup and CSS from the repo's real templates and stylesheets. Keep the real labels, columns and layout.
- Fill it with the repo's own demo or seed data. Where you need an email address or a domain, use ones on `.example`, like `team@cobalt.example`. Never use real customer data.
- It is a still page. Scripts, iframes, forms, remote URLs and web fonts are removed. The CSS must not use `@media`, `@keyframes`, `@font-face` or `@import` (any at-rule is refused). Images must be local files in the repo and cannot be animated. A screen over 256 KB is refused.
- The screen is drawn in a window 1460 by 806 CSS pixels. `focus` boxes are in those pixels, measured from the top-left of the screen.
- Do not rely on scrolling: everything the viewer should see must fit in that window.

**States** make the product act. A state adds the class in `set` to every element the `selector` matches, at `at` seconds into the scene. Define what the class looks like in the screen's own CSS. For example, each status cell holds a `.was` span ("Scheduled") and a `.now` span ("Sent"); the CSS says `.sent .was { opacity: 0 }` and `.sent .now { opacity: 1 }`; and the story says `{ "at": 1.2, "selector": "#row1 .status", "set": "sent" }`. The template animates the change with a blur swap and a pop: inside the element, `.was` or `[data-was]` blurs out, `.now` or `[data-now]` blurs in, and `.tick` or `[data-pop]` pops from nothing.

Rules for states: at most 8, each at least 0.4 seconds after the one before, and `set` is a plain class name (letters, digits, `-` and `_`) that the templates do not use (not `hero`, `clip`, `root`, and nothing starting with `hook-`, `title-`, `ui-`, `terminal-`, `counter-`, `compare-`, `list-`, `end-`, `zoom-` or `screen-`).

**Keep each state's selector on distinct elements.** Error findings inside a rebuilt screen still block the render; only small-text warnings are allowed there. The usual cause is one element flipped by many `states`, which the layout check reads as an element that keeps changing. Give each state its own element (`#row1`, `#row2`), or use one selector that matches several elements that are each flipped once.

## 4. Show the user the shot list and wait

Before rendering, show the scenes as a numbered list and ask for "ok" or changes. For each scene give its type and the words or file it uses, for example:

1. Hook: "40 clients." / "40 reports." / "Every single month."
2. Title: agencyrecap, "Monthly client reports that send themselves"
3. UI: rebuilt dashboard, rows flip to "Sent", caption "Sent. By itself."
4. Counter: 4,812 sessions
5. List: three results
6. End: `docker compose up -d`, "Star on GitHub"

Also say which style you chose and whether the film has music (see Sound below). Do not render until the user says ok.

## 5. Render

`scripts/render.mjs` lives in the folder that contains this SKILL.md. Work out its absolute path and run this from the repo root:

```bash
node <absolute-path-to-this-skill-folder>/scripts/render.mjs launch-video/story.json
```

It needs Node 22+ and ffmpeg and prints how to install either if missing. It needs internet access on every run: npm (HyperFrames), a one-time Chrome download, Google Fonts and the GSAP CDN. A render takes several minutes, so run the command with a timeout of at least 15 minutes, or in the background and wait for it to finish. If the sandbox blocks the network, ask the user to allow it, or give them the exact command and ask them to run it themselves.

Add `--draft` for a faster, lower-quality render when the user only wants a quick look.

What the script does, in order: it checks the story and plans the film, gets Chrome and the sound effects, builds the wide and the tall project, and runs the quality gate on both. The gate is strict: any error blocks the render, and so does scene text that is too small or too low in contrast to read. A problem is printed with the story field behind it, such as `scenes[2].caption`. Fix `story.json` (shorten the named text, or change the screen) and run it again. If a render fails, read the end of `launch-video/render.log`.

### Sound

- **Effects:** whooshes on transitions, pops, clicks, key taps and a bass hit on the end card. They are bundled by HyperFrames and resolved when the film is built, under the Pixabay licence. They are not part of this repo and are not redistributed. Set `"sfx": false` for a silent film.
- **Music:** from the user's own file (`"music": "<path>"`) or from HeyGen (`"music": "heygen"`), which only works if the user is signed in to the HeyGen CLI (`heygen auth login --oauth`). Never choose or download a track yourself.
- **Neither:** the film has effects only. If `music` is `"heygen"` and HeyGen is not signed in, the script prints `Music skipped: sign in to HeyGen (heygen auth login --oauth) or give a music file.` and renders effects-only. If a music file is missing it prints `Music skipped: <path> not found.`

## 6. Look at the result before you hand over

When the render finishes, the script prints a list of files and any notes. Read `launch-video/contact.png`: one frame from the middle of every scene, in both sizes. Also read `launch-video/poster.png`. Look for text cut off, text too small, a screen that looks wrong, a focus box on the wrong spot, a number that is not the repo's, or a blank scene. If anything is wrong, fix `story.json` (or the screen) and render again. Do not hand over a film you have not looked at.

## 7. Hand over

Tell the user what was made:

- `launch-video/video-16x9.mp4`: README, Product Hunt, Show HN, YouTube
- `launch-video/video-9x16.mp4`: X, LinkedIn, Instagram Reels, TikTok
- `launch-video/video.gif`: paste at the top of the README with `![<name> launch video](launch-video/video.gif)`. It is cut to the first 12 seconds if the full GIF would be over 8 MB
- `launch-video/poster.png`: a still for link previews
- `launch-video/contact.png`: the contact sheet you checked
- `launch-video/wide/` and `launch-video/tall/`: editable HyperFrames projects. They are rebuilt on every run, so copy one elsewhere before editing it in HyperFrames Studio (`cd launch-video/wide && npx --yes hyperframes@0.9.9 preview`)

Give the user the exact absolute command so they can re-render without an agent. Paths in `story.json` are relative to the repo root, so the command changes directory first:

```bash
cd <absolute-path-to-the-repo> && node <absolute-path-to-this-skill-folder>/scripts/render.mjs launch-video/story.json
```

To change words later, they edit `story.json` and run the same command again. Repeat any notes the script printed. If there was no music, say so and tell them how to add some: put `"music": "<an mp3, m4a, wav or ogg file>"` in `story.json`, or `"music": "heygen"` once the HeyGen CLI is signed in. Suggest adding `launch-video/wide/`, `launch-video/tall/`, `launch-video/.sfx/` and `launch-video/render.log` to `.gitignore`. If the film has no real screenshot or rebuilt screen, say that adding a screenshot to the repo makes the video stronger.

A story written for readmereel 0.1 (with `problem`, `promise` and `features`) still renders: the script converts it to a v2 film and leaves the file as it is.
