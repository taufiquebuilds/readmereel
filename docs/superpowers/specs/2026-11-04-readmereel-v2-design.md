# readmereel v2: design

Date: 2026-11-04
Status: approved design, waiting for spec review

## Goal

Raise readmereel's output from a fixed 25-second slideshow to a premium 15–35 second launch film, at the level of the agencyrecap prototype (kinetic type, camera moves on real product screens, the product visibly acting, transitions with a cause, sound on every action). The user still just says "make a launch video for this repo".

v2 is done when all five examples (readmereel, agencyrecap, nopurple, repoheat, launchday) are re-made with the v2 skill, each passes the quality gate with no hand edits to generated files, the agencyrecap example reaches the prototype's level (real dashboard rebuilt as HTML, statuses flipping to "Sent", zoom-through into the report), and v0.2.0 is published.

## Decisions

| Topic | Decision |
| --- | --- |
| Approach | A scene library: the agent picks scenes and fills them with real data; it never writes animation code |
| Scene types | 8: `hook`, `title`, `ui`, `terminal`, `counter`, `compare`, `list`, `end` |
| Length | 15–35 s, derived from the text; 30 fps |
| Sizes | Every scene has a 16:9 (1920×1080) and a 9:16 (1080×1920) layout |
| Styles | 3: `midnight` (dark), `paper` (light), `signal` (bold accent ground); all tinted by `accent` |
| Transitions | Picked automatically from 5 kinds; 3–5 kinds per film; never the same kind twice in a row |
| Sound | Sound effects on by default, resolved at build time from HyperFrames' bundled library (not redistributed); music from a user file, or HeyGen's catalog when signed in; else effects only |
| Engine | HyperFrames 0.9.9, GSAP, one sub-composition per scene, motion blur on |
| Gate | Layout checked at ≥ 1 sample per second; overflow and our own readability warnings block the render |
| Compatibility | v1 `story.json` files convert to v2 automatically |
| Platforms | macOS and Linux; Node 22+; ffmpeg; internet |

## Not in v2

AI-generated video, voiceover, live screen recording of a running app, Windows, languages other than English, user-written animation code.

## story.json v2

```json
{
  "version": 2,
  "name": "agencyrecap",
  "url": "github.com/taufiquebuilds/agencyrecap",
  "install": "docker compose up -d",
  "accent": "#1f7a4d",
  "style": "midnight",
  "logo": "docs/logo.svg",
  "music": null,
  "sfx": true,
  "endCard": true,
  "scenes": [ { "type": "hook", "...": "..." } ]
}
```

Top-level rules: `version` 2; `name` ≤ 24 chars; `url` ≤ 60, no `.git`; `install` ≤ 48, one line, no placeholders like `<name>`; `accent` hex; `style` one of the three; `logo` PNG/SVG path; `music` audio path, `"heygen"`, or null; `sfx` boolean (default true); `endCard` boolean (default true). `scenes`: 5–8 entries, first is `hook`, last is `end`, `title` appears at most once, every other type at most twice. Unknown fields are rejected. Paths are relative to the folder the render command runs in.

### Scene types

Text limits keep every allowed string inside both layouts at ≥ 28 px; the template also shrinks one-line text to fit, never below 28 px.

**`hook`** `{ "lines": ["40 clients.", "40 reports.", "Every single month."], "accentWords": ["single", "month."], "count": { "line": 0, "to": 40 } }`
1–3 lines, each ≤ 22 chars and ≤ 4 words. One line may roll a number from 1 to `to` (the number must appear in that line). Each line enters with a whip from below; the next line whips the previous one out.

**`title`** `{ "promise": "Monthly client reports that send themselves" }`
`promise` ≤ 60 chars. Logo badge snaps in (spring), `name` sharpens letter by letter, promise blurs in.

**`ui`** — the product on screen. Exactly one of `image` or `html`.
- With `image`: `{ "image": "docs/dashboard.png", "focus": [ { "box": [x, y, w, h], "label": "07:00 on the 4th" } ], "caption": "Sent. By itself." }`. `box` is in the image's own pixels; 1–3 focus boxes; `label` ≤ 28 chars; `caption` ≤ 32 chars. The camera establishes the whole screen in a window frame, then pushes in to each box in turn (0.6 s `power2.inOut`, then a hold while the label chip lands), then pulls back slightly for the caption.
- With `html`: `{ "html": "launch-video/screens/dashboard.html", "focus": [...], "states": [ { "at": 1.2, "selector": "#st1", "set": "sent" } ], "caption": "..." }`. The HTML is a static rebuild of one real screen from the repo's own templates with real labels and example data (see Safety). `states` toggle a class on matching elements at scene-relative times (≥ 0.4 s apart, ≤ 8 states); the HTML's own CSS defines what the class looks like (e.g. `.sent .was {opacity:0} .sent .now {opacity:1}`); the template animates the change with a blur swap and a pop. `focus` boxes are CSS pixels of the rebuilt screen (rendered at 1460×860).

**`terminal`** `{ "command": "repoheat dashboard --user ratatui", "output": ["…", "…"], "highlight": [3] }`
`command` ≤ 48 chars; `output` 1–12 lines, each ≤ 64 chars, copied from really running the command (or from the README's own sample output); `highlight` line indexes. The command types out, output streams in line by line (60–90 ms apart), highlighted lines get an accent bar.

**`counter`** `{ "items": [ { "value": 4812, "label": "Sessions", "suffix": "", "note": "up 10%" } ] }`
1–3 items; `value` a real number from the repo (integer ≤ 9,999,999 or decimal with ≤ 1 decimal place); `label` ≤ 20 chars; `suffix` ≤ 3 chars (e.g. `%`, `×`, `ms`); `note` ≤ 24 chars. Numbers count up with `power3.out`, staggered 0.12 s.

**`compare`** `{ "before": { "label": "Without", "image": "a.png" }, "after": { "label": "With nopurple", "image": "b.png" } }`
Each side has `label` ≤ 24 chars and either `image` or `points` (1–3 lines, ≤ 40 chars each). A wipe reveals `after` over `before` from left to right (vertical layout: top to bottom).

**`list`** `{ "items": ["Branded PDF every month", "Never sends twice", "Free to self-host"] }`
Exactly 3 items, each ≤ 32 chars. Fast kinetic cuts, one item per beat, with a running index (01–03).

**`end`** `{}` (uses top-level `name`, `install`, `url`, `logo`, `endCard`). Logo hit, name letter by letter, install command typed, "Star on GitHub" pill, URL; holds at least 2.5 s after the last element lands.

## Timing

Each scene computes its own length from its content, then the film is laid out end to end with transition overlaps:

- A line the viewer must read holds 0.5 s + 0.3 s per word after it lands (HyperFrames' readability rule).
- `hook`: per line 0.35 s entrance + hold; `title`: 1.0 s + promise hold; `ui`: 0.8 s establish + per focus 0.6 s move + label hold, + caption hold, + 0.15 s per state; `terminal`: typing at 0.05 s/char (max 1.6 s) + 0.075 s per output line + 1.2 s hold; `counter`: 1.0 s count + label holds; `compare`: 0.6 s + wipe 0.8 s + label holds; `list`: 3 × (0.25 s + hold); `end`: 2.5 s minimum hold + entrances.
- Total is clamped to 15–35 s: if under 15 s, holds stretch evenly; if over 35 s, the build fails with "Too much to read in 35 s: remove a scene or shorten text in <scene>".

## Transitions

Between each pair of scenes the engine picks one of:

| Kind | Built as | Allowed when |
| --- | --- | --- |
| `whip` | outgoing smears up/left 0.2 s `power3.in`, incoming lands blurred and sharpens 0.13 s | any |
| `zoom` | camera dives into the outgoing scene's last focus point, which scales past the frame and becomes the next ground (the green-tick move) | outgoing is `ui`, `counter` or `title` |
| `flood` | the ground changes colour in 0.4 s `power2.inOut` while the hero object stays | next scene's ground colour differs |
| `blur` | out: opacity → 0 with 8 px blur 0.15 s; in: blur → 0 0.13 s | any |
| `carry` | the outgoing hero shrinks 1 → 0.6 and slides out as the next builds | outgoing has a hero card (`ui`, `compare`) |

Rules: 3–5 distinct kinds in a film of ≥ 5 scenes; never the same kind twice in a row; at most a third hard-ish (`blur`); the choice is deterministic for a given story (seeded by the story's text), so re-rendering the same story gives the same film.

## Styles

| Style | Ground | Ink | Use |
| --- | --- | --- | --- |
| `midnight` | `#08090b`, light product worlds on `#e9edf1` | `#f5f6f8` | default |
| `paper` | `#f6f5f1` | `#111418` | light brands |
| `signal` | the accent itself (hook and end on accent; product scenes on light) | white or black by contrast | loud brands |

Fonts: Inter (900 for display, 400–600 for text) and JetBrains Mono, both bundled with HyperFrames. One accent colour, used for one thing per scene.

## Sound

- Effects are placed by rule: a whoosh on each `whip`/`zoom`/`carry` transition, a pop on each counter landing and each `ui` state change, a soft click on each focus push, a key tick when a command starts typing, a bass impact on the end card's logo. Repeated effects rotate between takes (`whoosh`, `whoosh-short`; `pop`, `click-soft`).
- Each effect's peak lands one frame after its picture.
- Effects come from `npx hyperframes media-use resolve --type sfx --local-only` into the generated project's `assets/sfx/` with their credits file; readmereel's repo ships no audio files.
- Music: a user file (faded in over 1 s, out over 2 s, under the effects at about −6 dB) or, when `music` is `"heygen"` and the HeyGen CLI is signed in, a catalog track chosen from the film's feel. Without either, effects only, and the hand-over says how to add music.
- The mix is checked with `hyperframes audio --json`: no clipping, true peak ≤ −1 dBTP.

## Architecture

```
skills/readmereel/
  SKILL.md
  scripts/render.mjs              CLI: validate → plan → build wide + tall → gate → render → GIF + poster
  scripts/lib/story.mjs           v2 validation; v1 → v2 conversion
  scripts/lib/plan.mjs            timing, transition choice, total length → a film plan (pure data)
  scripts/lib/build.mjs           film plan → HyperFrames project (root index.html + one sub-composition per scene)
  scripts/lib/sanitize.mjs        cleans rebuilt HTML screens
  scripts/lib/sound.mjs           effect placement + resolving files + music
  scripts/lib/hf.mjs, gif.mjs, tools.mjs   (kept from v1; gate extended)
  template/
    root.html                     root composition shell (styles, fonts, motion blur, scene hosts)
    scenes/<type>.html            one sub-composition per scene type, wide + tall in one file (body class)
    transitions.js                the five transition builders
    styles.css                    style tokens for the three styles
```

The film plan is plain data (scene list with start, duration, transition in/out, sound cues), so timing and transition rules are unit-tested without rendering.

## Safety

Rebuilt HTML screens are cleaned before use: `<script>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<form>` and inline event handlers (`on*`) removed; `javascript:` and any `http(s):`/`//` URLs in `href`, `src`, `style` and `<style>` removed; images must be local files copied into the project. The cleaner is unit-tested with hostile input.

## Quality gate

- `hyperframes check --json --samples <film length in whole seconds, at least 25>`; any error finding blocks the render.
- Also blocking: `line_unread` and `text_below_floor` findings whose selector is inside our scene templates (not inside a rebuilt `ui` HTML screen, whose small UI text is allowed), and `contrast_aa_failure` on our text.
- Problems map back to the story field (`scenes[2].caption`, `scenes[0].lines[1]`).
- After rendering, the script writes a contact sheet (`launch-video/contact.png`, one frame per scene midpoint, both sizes) and SKILL.md tells the agent to look at it and fix anything wrong before handing over.

## Outputs

`launch-video/video-16x9.mp4`, `video-9x16.mp4`, `video.gif` (≤ 8 MB, cut to the first 12 s if larger), `poster.png` (16:9 frame at the `title` scene's midpoint, 960 px wide), `contact.png`, `render.log`, and the editable projects `wide/` and `tall/` (rebuilt on every run).

## Testing

- Unit: v2 validation (every rule above), v1 → v2 conversion, timing (holds per word, clamping, the 35 s error), transition choice (rules hold for 1,000 random stories; deterministic for a given story), sanitizer (hostile HTML), sound placement (cues match transitions and actions, takes rotate).
- Render integration: a fixture film using all 8 scene types renders in both sizes; ffprobe size/fps/duration matches the plan ± 0.1 s; the longest allowed text in every scene passes the gate in both sizes; a negative control proves the gate catches overflow.
- Manual: all five examples re-made with the skill; frames reviewed at every scene and transition.

## Risks

- **More moving parts.** Eight scene types × two layouts is most of the work; the plan builds and gates them one at a time, each against its longest-text fixture.
- **Agent-rebuilt HTML screens can drift from the real product.** SKILL.md requires copying markup and CSS from the repo's real templates and using real labels; the sanitizer removes anything active.
- **Render time grows** with longer films (about 2–5 minutes per size on a laptop). SKILL.md keeps the long-timeout guidance.
- **HeyGen music is optional** and needs the user's own account; effects-only must still feel finished.
