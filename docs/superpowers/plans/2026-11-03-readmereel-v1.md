# readmereel v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent skill that turns a repo's README into a 25-second launch video in 16:9 and 9:16 plus a README GIF, rendered locally with HyperFrames.

**Architecture:** The agent writes `launch-video/story.json`. A zero-dependency Node script validates it, stamps it into one HyperFrames template (6 scenes, CSS for a wide and a tall layout) as two projects, runs `hyperframes check` and `hyperframes render` on each, and makes the GIF with ffmpeg.

**Tech Stack:** Node 22+ (ES modules, `node:test`), HyperFrames 0.9.9 via `npx`, GSAP 3.15 (loaded by the template from jsDelivr, as HyperFrames' own scaffold does), ffmpeg/ffprobe.

**Spec:** `docs/superpowers/specs/2026-11-03-readmereel-design.md`

## Changes from the spec (decided while planning, after a working prototype)

1. **Node 22+, not 20+.** HyperFrames needs Node 22.
2. **Validation is a JS function, not a JSON Schema file.** `validateStory()` keeps the skill at zero npm dependencies; its error messages name the field and the rule.
3. **Story values are written into the generated project as variable defaults** instead of passing `--variables` at render time. `hyperframes check` then tests the real text, and the editable project opens in HyperFrames Studio with the user's story.
4. **One template file with two CSS layouts** (`body.wide` / `body.tall`) instead of sub-compositions. The prototype passed `check` with no errors in both layouts.
5. **Chrome is not checked separately.** `npx hyperframes browser ensure` installs the Chrome it needs.
6. **Paths in story.json are relative to the folder the render script runs in** (the repo root).
7. **Example MP4s are not committed.** Each example commits `story.json`, `video.gif` and `poster.png`; the MP4s are attached to the GitHub release.
8. **`install` limit is 48 characters, not 70, and `url` gets a 60-character limit.** The command is one line in a terminal card; 48 monospace characters is the most that fits the vertical video at the 28 px minimum. The template also shrinks the name, install line and URL to fit their width (never below 28 px).

## Global Constraints

- Node `>=22`. No npm runtime dependencies. Tests use `node:test` and `node:assert/strict`.
- HyperFrames is always run as `npx --yes hyperframes@0.9.9 …`.
- Outputs: `video-16x9.mp4` (1920×1080), `video-9x16.mp4` (1080×1920), `video.gif`. 30 fps. Length 25 s (accepted 24.5–25.5 s).
- Scene times: hook 0–3 s, title 3–6 s, features 6–10, 10–14, 14–18 s, install + CTA 18–25 s.
- Field limits: `name` 24, `promise` 60, `problem` 70, feature `title` 40, feature `detail` 80, `install` 48, `url` 60 characters. Exactly 3 features.
- `stars` is shown only when ≥ 10.
- GIF: from the 16:9 MP4, 960 px wide, 12 fps, two-pass palette, under 8 MB; if larger, cut to the first 12 s.
- End card text, exactly: `made with readmereel`. On unless `endCard` is `false`.
- Fonts: Inter (text) and JetBrains Mono (terminal), both bundled with HyperFrames. No text under 28 px.
- Never invent screenshots: a feature without a real image shows a large text card.
- Licence MIT. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

```
package.json, .gitignore, LICENSE, README.md, CHANGELOG.md
.claude-plugin/plugin.json, .claude-plugin/marketplace.json
.github/workflows/ci.yml
skills/readmereel/
  SKILL.md
  template/index.html, template/hyperframes.json, template/assets/blank.png
  scripts/render.mjs
  scripts/lib/story.mjs   validateStory, LIMITS, DEFAULT_ACCENT
  scripts/lib/build.mjs   buildProject, variablesFor, musicTag, LAYOUTS, DURATION, TEMPLATE_DIR
  scripts/lib/tools.mjs   checkTools, commandExists
  scripts/lib/hf.mjs      runHf, ensureBrowser, checkProject, renderProject, HF
  scripts/lib/gif.mjs     makeGif, gifArgs, GIF
tests/
  helpers.mjs, story.test.mjs, build.test.mjs, tools.test.mjs, hf.test.mjs, gif.test.mjs, manifest.test.mjs
  render.integration.mjs   (slow: real renders; run with npm run test:render)
examples/<repo>/story.json, video.gif, poster.png, assets
```

---

### Task 1: Project setup and story validation

**Files:**
- Create: `package.json`, `.gitignore`, `LICENSE`, `skills/readmereel/scripts/lib/story.mjs`, `tests/helpers.mjs`, `tests/story.test.mjs`

**Interfaces:**
- Produces: `validateStory(story: object, baseDir: string) -> string[]` (empty when valid), `LIMITS`, `DEFAULT_ACCENT = "#22c55e"`; `tests/helpers.mjs` exports `validStory()` (a fresh valid story object with no image paths) and `tmpDir()` (a new temp folder).

- [ ] **Step 1: Create the project files**

`package.json`:
```json
{
  "name": "readmereel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Turn your README into a launch video.",
  "license": "MIT",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:render": "node --test --test-timeout=900000 tests/render.integration.mjs"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
launch-video/
examples/*/wide/
examples/*/tall/
examples/*/*.mp4
examples/*/render.log
.hyperframes/
renders/
```

`LICENSE`: the standard MIT License text, first line `MIT License`, copyright line `Copyright (c) 2026 Taufique Khan`.

- [ ] **Step 2: Write the failing tests**

`tests/helpers.mjs`:
```js
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tmpDir() {
  return mkdtempSync(join(tmpdir(), "readmereel-"));
}

export function validStory() {
  return {
    name: "agencyrecap",
    promise: "Monthly client reports that send themselves",
    problem: "Client reporting tools charge you more for every client you win",
    features: [
      { title: "Branded PDF every month", detail: "Your logo and colour, emailed to each client on the day you pick" },
      { title: "One dashboard", detail: "See which reports went out and send again in one click" },
      { title: "Never sends twice", detail: "Holds and retries when Google or email fails, then tells you" },
    ],
    install: "docker compose up -d",
    url: "github.com/taufiquebuilds/agencyrecap",
    stars: null,
    accent: "#0f766e",
  };
}
```

`tests/story.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, validateStory } from "../skills/readmereel/scripts/lib/story.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

test("a valid story has no errors", () => {
  assert.deepEqual(validateStory(validStory(), tmpDir()), []);
});

test("rejects a non-object", () => {
  assert.deepEqual(validateStory([], tmpDir()), ["story.json must be a JSON object"]);
});

test("each text field has a length limit", () => {
  const story = validStory();
  story.name = "x".repeat(LIMITS.name + 1);
  story.features[1].detail = "y".repeat(LIMITS.featureDetail + 1);
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes(`name: ${LIMITS.name + 1} characters, the limit is ${LIMITS.name}`));
  assert.ok(errors.includes(`features[2].detail: ${LIMITS.featureDetail + 1} characters, the limit is ${LIMITS.featureDetail}`));
});

test("text at exactly the limit is fine", () => {
  const story = validStory();
  story.problem = "p".repeat(LIMITS.problem);
  assert.deepEqual(validateStory(story, tmpDir()), []);
});

test("required text and one line", () => {
  const story = validStory();
  story.promise = "";
  story.install = "npm i\nnpm start";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("promise: required text"));
  assert.ok(errors.includes("install: must be one line"));
});

test("exactly three features", () => {
  const story = validStory();
  story.features.pop();
  assert.deepEqual(validateStory(story, tmpDir()), ["features: must be a list of exactly 3"]);
});

test("image files must exist and be images", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, "shot.png"), "png");
  const story = validStory();
  story.features[0].image = "shot.png";
  story.features[1].image = "missing.png";
  story.features[2].image = "notes.txt";
  const errors = validateStory(story, dir);
  assert.deepEqual(errors, [
    "features[2].image: file not found: missing.png",
    "features[3].image: must be a path to an image (png, jpg, gif, svg, webp) file",
  ]);
});

test("logo must be png or svg, music must be audio", () => {
  const story = validStory();
  story.logo = "logo.jpg";
  story.music = "song.txt";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("logo: must be a path to a PNG or SVG file"));
  assert.ok(errors.includes("music: must be a path to an audio (mp3, m4a, wav, ogg) file"));
});

test("accent, stars, endCard and url rules", () => {
  const story = validStory();
  story.accent = "teal";
  story.stars = -3;
  story.endCard = "no";
  story.url = "not a url";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("accent: must be a hex colour like #0f766e"));
  assert.ok(errors.includes("stars: must be a whole number or null"));
  assert.ok(errors.includes("endCard: must be true or false"));
  assert.ok(errors.includes("url: must be a web address like github.com/you/repo"));
});

test("unknown fields are reported so typos are caught", () => {
  const story = validStory();
  story.promis = "typo";
  assert.deepEqual(validateStory(story, tmpDir()), ["promis: unknown field"]);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL with `Cannot find module …/skills/readmereel/scripts/lib/story.mjs`

- [ ] **Step 4: Write the implementation**

`skills/readmereel/scripts/lib/story.mjs`:
```js
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const LIMITS = { name: 24, promise: 60, problem: 70, featureTitle: 40, featureDetail: 80, install: 48, url: 60 };
export const DEFAULT_ACCENT = "#22c55e";

const KNOWN = ["name", "promise", "problem", "features", "install", "url", "stars", "logo", "accent", "music", "endCard"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_LIKE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
const LOGO = /\.(png|svg)$/i;
const AUDIO = /\.(mp3|m4a|wav|ogg)$/i;

function text(errors, label, value, max) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label}: required text`);
  else if (/[\r\n]/.test(value)) errors.push(`${label}: must be one line`);
  else if (value.length > max) errors.push(`${label}: ${value.length} characters, the limit is ${max}`);
}

function file(errors, label, value, baseDir, pattern, kind) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${label}: must be a path to ${kind} file`);
  } else if (!existsSync(resolve(baseDir, value))) {
    errors.push(`${label}: file not found: ${value}`);
  }
}

export function validateStory(story, baseDir) {
  if (story === null || typeof story !== "object" || Array.isArray(story)) return ["story.json must be a JSON object"];
  const errors = [];
  for (const key of Object.keys(story)) if (!KNOWN.includes(key)) errors.push(`${key}: unknown field`);
  text(errors, "name", story.name, LIMITS.name);
  text(errors, "promise", story.promise, LIMITS.promise);
  text(errors, "problem", story.problem, LIMITS.problem);
  if (!Array.isArray(story.features) || story.features.length !== 3) {
    errors.push("features: must be a list of exactly 3");
  } else {
    story.features.forEach((f, i) => {
      const label = `features[${i + 1}]`;
      if (f === null || typeof f !== "object") return errors.push(`${label}: must be an object`);
      text(errors, `${label}.title`, f.title, LIMITS.featureTitle);
      text(errors, `${label}.detail`, f.detail, LIMITS.featureDetail);
      file(errors, `${label}.image`, f.image, baseDir, IMAGE, "an image (png, jpg, gif, svg, webp)");
    });
  }
  text(errors, "install", story.install, LIMITS.install);
  if (typeof story.url !== "string" || !URL_LIKE.test(story.url)) errors.push("url: must be a web address like github.com/you/repo");
  else if (story.url.length > LIMITS.url) errors.push(`url: ${story.url.length} characters, the limit is ${LIMITS.url}`);
  if (story.stars !== undefined && story.stars !== null && !(Number.isInteger(story.stars) && story.stars >= 0)) {
    errors.push("stars: must be a whole number or null");
  }
  file(errors, "logo", story.logo, baseDir, LOGO, "a PNG or SVG");
  if (story.accent !== undefined && !(typeof story.accent === "string" && HEX.test(story.accent))) {
    errors.push("accent: must be a hex colour like #0f766e");
  }
  file(errors, "music", story.music, baseDir, AUDIO, "an audio (mp3, m4a, wav, ogg)");
  if (story.endCard !== undefined && typeof story.endCard !== "boolean") errors.push("endCard: must be true or false");
  return errors;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test`
Expected: `# pass 10`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore LICENSE skills/readmereel/scripts/lib/story.mjs tests/helpers.mjs tests/story.test.mjs
git commit -m "Add project setup and story validation" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Video template and project builder

**Files:**
- Create: `skills/readmereel/template/index.html`, `skills/readmereel/template/hyperframes.json`, `skills/readmereel/template/assets/blank.png`, `skills/readmereel/scripts/lib/build.mjs`, `tests/build.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_ACCENT` (Task 1); `validStory()`, `tmpDir()` (Task 1 helpers).
- Produces: `LAYOUTS = { wide: {width:1920,height:1080,video:"video-16x9.mp4"}, tall: {width:1080,height:1920,video:"video-9x16.mp4"} }`, `DURATION = 25`, `TEMPLATE_DIR`, `variablesFor(story, assets) -> Array<{id,type,label,default}>`, `musicTag(rel: string) -> string`, `buildProject(story, layout: "wide"|"tall", { baseDir, outDir, templateDir? }) -> projectDir` (writes `<outDir>/<layout>/`).
- Template variable ids (used by Task 5's SKILL.md): `name, promise, problem, f1Title, f1Detail, f1Image, f2Title, f2Detail, f2Image, f3Title, f3Detail, f3Image, install, url, stars, logo, accent, endCard`.

- [ ] **Step 1: Write the failing tests**

`tests/build.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject, LAYOUTS, musicTag, variablesFor } from "../skills/readmereel/scripts/lib/build.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

function variables(html) {
  const raw = html.match(/data-composition-variables='([^']*)'/)[1];
  return Object.fromEntries(
    JSON.parse(raw.replaceAll("&#39;", "'").replaceAll("&amp;", "&")).map((v) => [v.id, v]),
  );
}

test("layouts and output names", () => {
  assert.deepEqual(LAYOUTS.wide, { width: 1920, height: 1080, video: "video-16x9.mp4" });
  assert.deepEqual(LAYOUTS.tall, { width: 1080, height: 1920, video: "video-9x16.mp4" });
});

test("variables carry the story with defaults", () => {
  const story = validStory();
  delete story.accent;
  const vars = Object.fromEntries(variablesFor(story, { logo: "", f1Image: "assets/f1.png", f2Image: "", f3Image: "" }).map((v) => [v.id, v]));
  assert.equal(vars.name.default, "agencyrecap");
  assert.equal(vars.f1Title.default, "Branded PDF every month");
  assert.equal(vars.f1Image.default, "assets/f1.png");
  assert.equal(vars.f2Image.default, "");
  assert.deepEqual(vars.accent, { id: "accent", type: "color", label: "accent", default: "#22c55e" });
  assert.deepEqual(vars.stars, { id: "stars", type: "number", label: "stars", default: 0 });
  assert.deepEqual(vars.endCard, { id: "endCard", type: "boolean", label: "endCard", default: true });
});

test("builds a wide project with sizes, layout and copied images", () => {
  const base = tmpDir();
  writeFileSync(join(base, "shot.png"), "png-bytes");
  const story = validStory();
  story.features[0].image = "shot.png";
  story.name = "it's & co";
  const out = tmpDir();
  const dir = buildProject(story, "wide", { baseDir: base, outDir: out });
  assert.equal(dir, join(out, "wide"));
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(html.includes('data-width="1920"') && html.includes('data-height="1080"'));
  assert.ok(html.includes('<body class="wide">'));
  assert.ok(!/__[A-Z]+__/.test(html), "every placeholder is replaced");
  const vars = variables(html);
  assert.equal(vars.name.default, "it's & co");
  assert.equal(vars.f1Image.default, "assets/f1.png");
  assert.equal(readFileSync(join(dir, "assets/f1.png"), "utf8"), "png-bytes");
  assert.ok(existsSync(join(dir, "hyperframes.json")));
  assert.ok(!html.includes('<audio id="music"'));
});

test("builds a tall project with music and a logo", () => {
  const base = tmpDir();
  writeFileSync(join(base, "song.mp3"), "mp3");
  writeFileSync(join(base, "logo.svg"), "<svg/>");
  const story = { ...validStory(), music: "song.mp3", logo: "logo.svg", endCard: false };
  const dir = buildProject(story, "tall", { baseDir: base, outDir: tmpDir() });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(html.includes('data-width="1080"') && html.includes('data-height="1920"'));
  assert.ok(html.includes('<body class="tall">'));
  assert.ok(html.includes(musicTag("assets/music.mp3")));
  const vars = variables(html);
  assert.equal(vars.logo.default, "assets/logo.svg");
  assert.equal(vars.endCard.default, false);
});

test("rebuilding replaces the old project", () => {
  const out = tmpDir();
  const dir = buildProject(validStory(), "wide", { baseDir: tmpDir(), outDir: out });
  writeFileSync(join(dir, "stale.txt"), "old");
  buildProject(validStory(), "wide", { baseDir: tmpDir(), outDir: out });
  assert.ok(!existsSync(join(dir, "stale.txt")));
});

test("music fades in and out over the whole video", () => {
  const tag = musicTag("assets/music.mp3");
  assert.ok(tag.startsWith('<audio id="music" src="assets/music.mp3" data-start="0" data-duration="25"'));
  assert.ok(tag.includes('{"t":1,"v":0.6}') && tag.includes('{"t":25,"v":0}'));
  assert.equal(musicTag(""), "");
});

test("unknown layout is an error", () => {
  assert.throws(() => buildProject(validStory(), "square", { baseDir: tmpDir(), outDir: tmpDir() }), /unknown layout: square/);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL with `Cannot find module …/scripts/lib/build.mjs`

- [ ] **Step 3: Create the template**

`skills/readmereel/template/hyperframes.json`:
```json
{
  "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
  "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  "paths": { "blocks": "compositions", "components": "compositions/components", "assets": "assets" },
  "media": { "autoProxy": true }
}
```

`skills/readmereel/template/assets/blank.png` (a 1×1 transparent PNG):
```bash
mkdir -p skills/readmereel/template/assets
node -e 'require("fs").writeFileSync("skills/readmereel/template/assets/blank.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"))'
```

`skills/readmereel/template/index.html` (prototype rendered and checked in both layouts on 2026-11-03):
```html
<!doctype html>
<html lang="en" data-composition-variables='__VARIABLES__'>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__WIDTH__, height=__HEIGHT__" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: __WIDTH__px; height: __HEIGHT__px; overflow: hidden; background: #0b0d10; }
      #root { width: 100%; height: 100%; position: relative; font-family: "Inter", sans-serif; color: #f4f5f7;
        --accent: #22c55e; }
      #bg { position: absolute; inset: 0;
        background: radial-gradient(1200px 800px at 85% 10%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), #0b0d10; }
      .scene { position: absolute; inset: 0; display: flex; }
      .mono { font-family: "JetBrains Mono", monospace; }

      /* 1 Hook */
      #s1 { align-items: center; justify-content: flex-start; }
      #s1 .wrap { padding: 0 160px; }
      #s1-text { font-weight: 900; font-size: 104px; line-height: 1.04; letter-spacing: -0.03em; max-width: 1500px; }
      #s1-bar { height: 14px; width: 0; background: var(--accent); margin-top: 40px; border-radius: 7px; }

      /* 2 Title */
      #s2 { align-items: center; justify-content: center; text-align: center; flex-direction: column; }
      #s2-logo { width: 140px; height: 140px; object-fit: contain; margin-bottom: 40px; }
      #s2-name { font-weight: 900; font-size: 168px; letter-spacing: -0.04em; line-height: 1; }
      #s2-promise { font-weight: 400; font-size: 52px; color: #b7bdc6; margin-top: 30px; max-width: 1400px; line-height: 1.25; }

      /* 3-5 Features */
      .feature { align-items: center; padding: 0 140px; gap: 90px; }
      .feature .text { flex: 0 0 640px; }
      .feature .num { font-weight: 900; font-size: 40px; color: var(--accent); }
      .feature .title { font-weight: 900; font-size: 76px; line-height: 1.05; letter-spacing: -0.02em; margin-top: 18px; }
      .feature .detail { font-size: 38px; line-height: 1.35; color: #b7bdc6; margin-top: 26px; }
      .feature .frame { flex: 1; height: 760px; border-radius: 28px; background: #161a20; border: 2px solid #252b33;
        overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 40px 120px rgba(0,0,0,0.5); }
      .feature .dots { height: 52px; flex: none; display: flex; gap: 12px; align-items: center; padding: 0 22px; background: #1d2229; }
      .feature .dots i { width: 14px; height: 14px; border-radius: 50%; background: #3a414b; display: block; }
      .feature .shot { flex: 1; min-height: 0; width: 100%; object-fit: contain; background: #0f1216; }
      .feature.noimg { justify-content: center; }
      .feature.noimg .frame { display: none; }
      .feature.noimg .text { flex: 0 1 1400px; text-align: center; }
      .feature.noimg .title { font-size: 104px; }
      .feature.noimg .detail { font-size: 50px; }

      /* 6 Install + CTA */
      #s6 { flex-direction: column; align-items: center; justify-content: center; gap: 60px; }
      #s6-term { width: 1400px; border-radius: 26px; background: #161a20; border: 2px solid #252b33; overflow: hidden; }
      #s6-term .dots { height: 52px; display: flex; gap: 12px; align-items: center; padding: 0 22px; background: #1d2229; }
      #s6-term .dots i { width: 14px; height: 14px; border-radius: 50%; background: #3a414b; display: block; }
      #s6-line { padding: 46px 50px; font-size: 44px; white-space: nowrap; display: flex; }
      #s6-prompt { color: var(--accent); margin-right: 24px; }
      #s6-cmd { display: inline-block; overflow: hidden; white-space: nowrap; width: 0; }
      #s6-cursor { display: inline-block; width: 22px; background: var(--accent); margin-left: 6px; }
      #s6-cta { text-align: center; }
      #s6-star { display: inline-flex; align-items: center; gap: 18px; font-weight: 900; font-size: 64px;
        background: var(--accent); color: #0b0d10; padding: 24px 46px; border-radius: 999px; }
      #s6-stars { font-weight: 700; font-size: 40px; opacity: 0.8; }
      #s6-url { font-size: 40px; color: #b7bdc6; margin-top: 30px; }
      #s6-made { position: absolute; bottom: 60px; left: 0; right: 0; text-align: center; font-size: 28px; color: #6b7380; }

      /* Tall layout (1080 x 1920) */
      .tall #s1 .wrap { padding: 0 90px; }
      .tall #s1-text { font-size: 96px; max-width: 900px; }
      .tall #s2-name { font-size: 132px; }
      .tall #s2-promise { font-size: 50px; max-width: 900px; }
      .tall .feature { flex-direction: column; justify-content: center; padding: 0 80px; gap: 70px; }
      .tall .feature .text { flex: none; width: 920px; }
      .tall .feature .frame { flex: none; width: 920px; height: 900px; }
      .tall .feature.noimg .text { width: 920px; }
      .tall .feature.noimg .title { font-size: 96px; }
      .tall #s6-term { width: 960px; }
      .tall #s6-line { font-size: 30px; padding: 40px 36px; }
      .tall #s6-cursor { width: 16px; }
      .tall #s6-star { font-size: 56px; }
      .tall #s6-url { font-size: 34px; }
    </style>
  </head>
  <body class="__LAYOUT__">
    <div id="root" data-composition-id="main" data-start="0" data-duration="25" data-width="__WIDTH__" data-height="__HEIGHT__">
      <div id="bg" class="clip" data-start="0" data-duration="25" data-track-index="0"></div>

      <section id="s1" class="scene clip" data-start="0" data-duration="3" data-track-index="1">
        <div class="wrap">
          <div id="s1-text" data-var-text="problem">Every AI deck looks the same</div>
          <div id="s1-bar"></div>
        </div>
      </section>

      <section id="s2" class="scene clip" data-start="3" data-duration="3" data-track-index="1">
        <img id="s2-logo" data-var-src="logo" src="assets/blank.png" alt="" />
        <div id="s2-name" data-var-text="name">readmereel</div>
        <div id="s2-promise" data-var-text="promise">Turn your README into a launch video</div>
      </section>

      <section id="s3" class="scene feature clip" data-start="6" data-duration="4" data-track-index="1">
        <div class="text">
          <div class="num">01</div>
          <div class="title" data-var-text="f1Title">Feature one</div>
          <div class="detail" data-var-text="f1Detail">What it does for you</div>
        </div>
        <div class="frame"><div class="dots"><i></i><i></i><i></i></div><img class="shot" data-var-src="f1Image" src="assets/blank.png" alt="" /></div>
      </section>

      <section id="s4" class="scene feature clip" data-start="10" data-duration="4" data-track-index="1">
        <div class="text">
          <div class="num">02</div>
          <div class="title" data-var-text="f2Title">Feature two</div>
          <div class="detail" data-var-text="f2Detail">What it does for you</div>
        </div>
        <div class="frame"><div class="dots"><i></i><i></i><i></i></div><img class="shot" data-var-src="f2Image" src="assets/blank.png" alt="" /></div>
      </section>

      <section id="s5" class="scene feature clip" data-start="14" data-duration="4" data-track-index="1">
        <div class="text">
          <div class="num">03</div>
          <div class="title" data-var-text="f3Title">Feature three</div>
          <div class="detail" data-var-text="f3Detail">What it does for you</div>
        </div>
        <div class="frame"><div class="dots"><i></i><i></i><i></i></div><img class="shot" data-var-src="f3Image" src="assets/blank.png" alt="" /></div>
      </section>

      <section id="s6" class="scene clip" data-start="18" data-duration="7" data-track-index="1">
        <div id="s6-term">
          <div class="dots"><i></i><i></i><i></i></div>
          <div id="s6-line" class="mono"><span id="s6-prompt">$</span><span id="s6-cmd" data-var-text="install">npx readmereel</span><span id="s6-cursor">&nbsp;</span></div>
        </div>
        <div id="s6-cta">
          <div id="s6-star">★ Star on GitHub <span id="s6-stars"></span></div>
          <div id="s6-url" data-var-text="url">github.com/you/repo</div>
        </div>
        <div id="s6-made">made with readmereel</div>
      </section>
      __MUSIC__
    </div>
    <script>
      const v = window.__hyperframes.getVariables();
      const root = document.getElementById("root");
      root.style.setProperty("--accent", v.accent);
      if (!v.logo) document.getElementById("s2-logo").style.display = "none";
      ["f1Image", "f2Image", "f3Image"].forEach((k, i) => {
        if (!v[k]) document.getElementById("s" + (i + 3)).classList.add("noimg");
      });
      if (v.stars >= 10) document.getElementById("s6-stars").textContent = "· " + Number(v.stars).toLocaleString("en-US");
      if (!v.endCard) document.getElementById("s6-made").style.display = "none";
      const chars = v.install.length;
      // Shrink one-line text to fit its width (k = average glyph width in em), never below 28 px.
      const wide = document.body.classList.contains("wide");
      const fit = (max, width, n, k) => Math.max(28, Math.min(max, Math.floor(width / (n * k)))) + "px";
      document.getElementById("s2-name").style.fontSize = fit(wide ? 168 : 132, wide ? 1600 : 920, v.name.length, 0.7);
      document.getElementById("s6-line").style.fontSize = fit(wide ? 44 : 30, wide ? 1250 : 860, chars + 2, 0.62);
      document.getElementById("s6-url").style.fontSize = fit(wide ? 40 : 34, wide ? 1600 : 960, v.url.length, 0.55);

      const tl = gsap.timeline({ paused: true });
      // 1 Hook
      tl.fromTo("#s1-text", { opacity: 1, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 0)
        .to("#s1-bar", { width: 260, duration: 0.6, ease: "power2.out" }, 0.4)
        .to("#s1 .wrap", { opacity: 0, y: -40, duration: 0.3, ease: "power2.in" }, 2.65);
      // 2 Title
      tl.fromTo("#s2-logo", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.6)" }, 3.0)
        .fromTo("#s2-name", { opacity: 0, y: 50 }, { opacity: 1, y: 0, duration: 0.55, ease: "power3.out" }, 3.1)
        .fromTo("#s2-promise", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 3.45)
        .to("#s2 > *", { opacity: 0, duration: 0.3 }, 5.65);
      // 3-5 Features
      [["#s3", 6], ["#s4", 10], ["#s5", 14]].forEach(([s, t]) => {
        tl.fromTo(s + " .num", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.4, ease: "power2.out" }, t)
          .fromTo(s + " .title", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, t + 0.1)
          .fromTo(s + " .detail", { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, t + 0.3)
          .fromTo(s + " .frame", { opacity: 0, y: 80, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "power3.out" }, t + 0.2)
          .to(s + " .shot", { scale: 1.04, duration: 3, ease: "none" }, t + 0.6)
          .to(s + " > *", { opacity: 0, duration: 0.3 }, t + 3.65);
      });
      // 6 Install + CTA
      tl.fromTo("#s6-term", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, 18)
        .to("#s6-cmd", { width: chars + "ch", duration: Math.min(2.2, chars * 0.05), ease: "steps(" + chars + ")" }, 18.5)
        .fromTo("#s6-cta", { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 0.6, ease: "power3.out" }, 21.2)
        .fromTo("#s6-star", { scale: 0.85 }, { scale: 1, duration: 0.6, ease: "back.out(1.8)" }, 21.2)
        .fromTo("#s6-made", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 22.2)
        .to("#s6-cursor", { opacity: 0, duration: 0.01, repeat: 9, yoyo: true, repeatDelay: 0.4 }, 20.8);
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
```

- [ ] **Step 4: Write the builder**

`skills/readmereel/scripts/lib/build.mjs`:
```js
import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ACCENT } from "./story.mjs";

export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../template");
export const DURATION = 25;
export const LAYOUTS = {
  wide: { width: 1920, height: 1080, video: "video-16x9.mp4" },
  tall: { width: 1080, height: 1920, video: "video-9x16.mp4" },
};

function typeOf(id, value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return id === "accent" ? "color" : "string";
}

export function variablesFor(story, assets) {
  const values = { name: story.name, promise: story.promise, problem: story.problem };
  story.features.forEach((f, i) => {
    values[`f${i + 1}Title`] = f.title;
    values[`f${i + 1}Detail`] = f.detail;
    values[`f${i + 1}Image`] = assets[`f${i + 1}Image`] ?? "";
  });
  Object.assign(values, {
    install: story.install,
    url: story.url,
    stars: story.stars ?? 0,
    logo: assets.logo ?? "",
    accent: story.accent ?? DEFAULT_ACCENT,
    endCard: story.endCard ?? true,
  });
  return Object.entries(values).map(([id, value]) => ({ id, type: typeOf(id, value), label: id, default: value }));
}

export function musicTag(rel) {
  if (!rel) return "";
  const fade = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: 1, v: 0.6 }, { t: DURATION - 2, v: 0.6 }, { t: DURATION, v: 0 }] }] };
  return `<audio id="music" src="${rel}" data-start="0" data-duration="${DURATION}" data-track-index="2" data-volume="0.6" data-automation='${JSON.stringify(fade)}'></audio>`;
}

function copyAsset(src, baseDir, projectDir, stem) {
  if (!src) return "";
  const rel = `assets/${stem}${extname(src).toLowerCase()}`;
  copyFileSync(resolve(baseDir, src), join(projectDir, rel));
  return rel;
}

function attr(json) {
  return json.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

export function buildProject(story, layout, { baseDir, outDir, templateDir = TEMPLATE_DIR }) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`unknown layout: ${layout}`);
  const projectDir = join(outDir, layout);
  rmSync(projectDir, { recursive: true, force: true });
  cpSync(templateDir, projectDir, { recursive: true });
  const assets = { logo: copyAsset(story.logo, baseDir, projectDir, "logo") };
  story.features.forEach((f, i) => {
    assets[`f${i + 1}Image`] = copyAsset(f.image, baseDir, projectDir, `f${i + 1}`);
  });
  const music = copyAsset(story.music, baseDir, projectDir, "music");
  const html = readFileSync(join(projectDir, "index.html"), "utf8")
    .replaceAll("__VARIABLES__", attr(JSON.stringify(variablesFor(story, assets))))
    .replaceAll("__WIDTH__", String(size.width))
    .replaceAll("__HEIGHT__", String(size.height))
    .replaceAll("__LAYOUT__", layout)
    .replace("__MUSIC__", musicTag(music));
  writeFileSync(join(projectDir, "index.html"), html);
  return projectDir;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test`
Expected: `# pass 17`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add skills/readmereel/template skills/readmereel/scripts/lib/build.mjs tests/build.test.mjs
git commit -m "Add video template and project builder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tool checks, HyperFrames runner and GIF

**Files:**
- Create: `skills/readmereel/scripts/lib/tools.mjs`, `skills/readmereel/scripts/lib/hf.mjs`, `skills/readmereel/scripts/lib/gif.mjs`, `tests/tools.test.mjs`, `tests/hf.test.mjs`, `tests/gif.test.mjs`

**Interfaces:**
- Produces:
  - `checkTools({ nodeVersion?, has? }) -> string[]` (one message per missing tool); `commandExists(cmd) -> boolean`.
  - `HF = ["--yes", "hyperframes@0.9.9"]`; `runHf(args, { cwd?, log?, run? }) -> {status, stdout, stderr}`; `ensureBrowser({ log, run? })` throws on failure; `checkProject(projectDir, { log, run? }) -> string[]` (error findings only, as `"<section>: <code>: <message>"`); `renderProject(projectDir, output, { log, quality?, run? })` throws on failure. `run` defaults to `spawnSync` and exists so tests can fake it.
  - `GIF = { width: 960, fps: 12, maxBytes: 8388608, fallbackSeconds: 12 }`; `gifArgs(mp4, gif, seconds?) -> string[]`; `makeGif(mp4, gif, { run?, size? }) -> number` (final size in bytes).

- [ ] **Step 1: Write the failing tests**

`tests/tools.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTools } from "../skills/readmereel/scripts/lib/tools.mjs";

test("all tools present", () => {
  assert.deepEqual(checkTools({ nodeVersion: "22.4.0", has: () => true }), []);
});

test("old Node and missing ffmpeg are reported with how to fix them", () => {
  const missing = checkTools({ nodeVersion: "20.11.1", has: (cmd) => cmd !== "ffmpeg" });
  assert.equal(missing.length, 2);
  assert.match(missing[0], /Node\.js 22 or newer is needed \(you have 20\.11\.1\)/);
  assert.match(missing[1], /ffmpeg is needed.*brew install ffmpeg/);
});
```

`tests/hf.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProject, HF, renderProject, runHf } from "../skills/readmereel/scripts/lib/hf.mjs";
import { tmpDir } from "./helpers.mjs";

function fakeRun(result, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return { status: 0, stdout: "", stderr: "", ...result };
  };
}

test("runs the pinned HyperFrames version and logs the output", () => {
  const log = join(tmpDir(), "render.log");
  const calls = [];
  runHf(["info"], { cwd: "/p", log, run: fakeRun({ stdout: "hello" }, calls) });
  assert.deepEqual(HF, ["--yes", "hyperframes@0.9.9"]);
  assert.deepEqual(calls[0], { cmd: "npx", args: ["--yes", "hyperframes@0.9.9", "info"], cwd: "/p" });
  assert.match(readFileSync(log, "utf8"), /\$ npx --yes hyperframes@0\.9\.9 info\nhello/);
});

test("check returns only error findings", () => {
  const report = {
    ok: false,
    lint: { errorCount: 0, findings: [{ severity: "warning", code: "film_silent", message: "no sound" }] },
    layout: { errorCount: 1, findings: [{ severity: "error", code: "text_overflow", message: "#s1-text overflows" }] },
  };
  const problems = checkProject("/p", { log: join(tmpDir(), "l"), run: fakeRun({ stdout: JSON.stringify(report) }) });
  assert.deepEqual(problems, ["layout: text_overflow: #s1-text overflows"]);
});

test("check output that is not JSON is an error", () => {
  assert.throws(
    () => checkProject("/p", { log: "/tmp/readmereel-x.log", run: fakeRun({ stdout: "boom" }) }),
    /HyperFrames check did not return JSON\. See \/tmp\/readmereel-x\.log/,
  );
});

test("render passes quality and output, and fails loudly", () => {
  const calls = [];
  renderProject("/p", "/out/v.mp4", { log: join(tmpDir(), "l"), quality: "draft", run: fakeRun({}, calls) });
  assert.deepEqual(calls[0].args.slice(2), ["render", "--quality", "draft", "--quiet", "--output", "/out/v.mp4"]);
  assert.throws(
    () => renderProject("/p", "/out/v.mp4", { log: "/tmp/r.log", run: fakeRun({ status: 1 }) }),
    /Render failed for \/p\. See \/tmp\/r\.log/,
  );
});
```

`tests/gif.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIF, gifArgs, makeGif } from "../skills/readmereel/scripts/lib/gif.mjs";

test("GIF settings", () => {
  assert.deepEqual(GIF, { width: 960, fps: 12, maxBytes: 8 * 1024 * 1024, fallbackSeconds: 12 });
  const args = gifArgs("in.mp4", "out.gif");
  assert.ok(args.join(" ").includes("fps=12,scale=960:-1"));
  assert.ok(args.join(" ").includes("palettegen") && args.join(" ").includes("paletteuse"));
  assert.ok(!args.includes("-t"));
  assert.deepEqual(gifArgs("in.mp4", "out.gif", 12).slice(3, 5), ["-t", "12"]);
});

test("a GIF over 8 MB is remade from the first 12 seconds", () => {
  const calls = [];
  const sizes = [9 * 1024 * 1024, 5 * 1024 * 1024];
  const final = makeGif("in.mp4", "out.gif", {
    run: (cmd, args) => { calls.push(args); return { status: 0, stderr: "" }; },
    size: () => sizes.shift(),
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("-t"));
  assert.equal(final, 5 * 1024 * 1024);
});

test("ffmpeg failure is an error", () => {
  assert.throws(
    () => makeGif("in.mp4", "out.gif", { run: () => ({ status: 1, stderr: "bad input" }), size: () => 0 }),
    /ffmpeg could not make the GIF: bad input/,
  );
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npm test`
Expected: FAIL with `Cannot find module …/scripts/lib/tools.mjs` (and hf.mjs, gif.mjs)

- [ ] **Step 3: Write the implementations**

`skills/readmereel/scripts/lib/tools.mjs`:
```js
import { spawnSync } from "node:child_process";

export function commandExists(cmd) {
  return spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;
}

export function checkTools({ nodeVersion = process.versions.node, has = commandExists } = {}) {
  const missing = [];
  if (Number(nodeVersion.split(".")[0]) < 22) {
    missing.push(`Node.js 22 or newer is needed (you have ${nodeVersion}). Install it from https://nodejs.org`);
  }
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (!has(tool)) missing.push(`${tool} is needed. Install it: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)`);
  }
  return missing;
}
```

`skills/readmereel/scripts/lib/hf.mjs`:
```js
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const HF = ["--yes", "hyperframes@0.9.9"];

export function runHf(args, { cwd, log, run = spawnSync } = {}) {
  const full = [...HF, ...args];
  const result = run("npx", full, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (log) appendFileSync(log, `$ npx ${full.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}\n`);
  return result;
}

export function ensureBrowser({ log, run } = {}) {
  if (runHf(["browser", "ensure"], { log, run }).status !== 0) {
    throw new Error(`Could not set up Chrome for rendering. See ${log}`);
  }
}

export function checkProject(projectDir, { log, run } = {}) {
  const result = runHf(["check", "--json"], { cwd: projectDir, log, run });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`HyperFrames check did not return JSON. See ${log}`);
  }
  const problems = [];
  for (const [section, value] of Object.entries(report)) {
    if (!value || typeof value !== "object" || !Array.isArray(value.findings)) continue;
    for (const f of value.findings) if (f.severity === "error") problems.push(`${section}: ${f.code}: ${f.message}`);
  }
  return problems;
}

export function renderProject(projectDir, output, { log, quality = "looks", run } = {}) {
  const result = runHf(["render", "--quality", quality, "--quiet", "--output", output], { cwd: projectDir, log, run });
  if (result.status !== 0) throw new Error(`Render failed for ${projectDir}. See ${log}`);
}
```

`skills/readmereel/scripts/lib/gif.mjs`:
```js
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

export const GIF = { width: 960, fps: 12, maxBytes: 8 * 1024 * 1024, fallbackSeconds: 12 };

export function gifArgs(mp4, gif, seconds) {
  const trim = seconds ? ["-t", String(seconds)] : [];
  const filter = `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos,split[a][b];` +
    "[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4";
  return ["-v", "error", "-y", ...trim, "-i", mp4, "-filter_complex", filter, "-loop", "0", gif];
}

export function makeGif(mp4, gif, { run = spawnSync, size = (p) => statSync(p).size } = {}) {
  const once = (seconds) => {
    const result = run("ffmpeg", gifArgs(mp4, gif, seconds), { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`ffmpeg could not make the GIF: ${result.stderr}`);
    return size(gif);
  };
  const bytes = once();
  return bytes > GIF.maxBytes ? once(GIF.fallbackSeconds) : bytes;
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npm test`
Expected: `# pass 26`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add skills/readmereel/scripts/lib/tools.mjs skills/readmereel/scripts/lib/hf.mjs skills/readmereel/scripts/lib/gif.mjs tests/tools.test.mjs tests/hf.test.mjs tests/gif.test.mjs
git commit -m "Add tool checks, HyperFrames runner and GIF maker" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Render command and end-to-end render tests

**Files:**
- Create: `skills/readmereel/scripts/render.mjs`, `tests/render.integration.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `main(argv: string[], { cwd? }) -> number` (exit code). CLI: `node <skill>/scripts/render.mjs [path/to/story.json] [--draft]`, default path `launch-video/story.json`, run from the repo root. Outputs land next to `story.json`: `video-16x9.mp4`, `video-9x16.mp4`, `video.gif`, `render.log`, and the editable projects `wide/` and `tall/`.

- [ ] **Step 1: Write the failing integration test**

`tests/render.integration.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { GIF } from "../skills/readmereel/scripts/lib/gif.mjs";
import { checkProject, ensureBrowser } from "../skills/readmereel/scripts/lib/hf.mjs";
import { LIMITS } from "../skills/readmereel/scripts/lib/story.mjs";
import { main } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

function probe(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }).stdout;
  const data = JSON.parse(out);
  return { ...data.streams[0], duration: Number(data.format.duration) };
}

test("renders both videos and the GIF from a story", () => {
  const repo = tmpDir();
  mkdirSync(join(repo, "docs"));
  spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x334155:s=1600x1000", "-frames:v", "1", join(repo, "docs/shot.png")]);
  const story = validStory();
  story.features[0].image = "docs/shot.png";
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(story, null, 2));

  assert.equal(main(["--draft"], { cwd: repo }), 0);

  const wide = probe(join(repo, "launch-video/video-16x9.mp4"));
  assert.deepEqual([wide.width, wide.height, wide.r_frame_rate], [1920, 1080, "30/1"]);
  assert.ok(wide.duration >= 24.5 && wide.duration <= 25.5, `wide duration ${wide.duration}`);
  const tall = probe(join(repo, "launch-video/video-9x16.mp4"));
  assert.deepEqual([tall.width, tall.height, tall.r_frame_rate], [1080, 1920, "30/1"]);
  assert.ok(tall.duration >= 24.5 && tall.duration <= 25.5, `tall duration ${tall.duration}`);
  const gif = statSync(join(repo, "launch-video/video.gif")).size;
  assert.ok(gif > 0 && gif <= GIF.maxBytes, `gif size ${gif}`);
});

test("the longest allowed text fits both layouts", () => {
  const story = validStory();
  story.name = "N".repeat(LIMITS.name);
  story.promise = "Promise ".repeat(8).slice(0, LIMITS.promise);
  story.problem = "Problem ".repeat(9).slice(0, LIMITS.problem);
  story.install = "npx --yes some-long-package-name@1.2.3 init my-new-project --tpl x".slice(0, LIMITS.install);
  story.url = ("github.com/" + "a".repeat(80)).slice(0, LIMITS.url);
  for (const f of story.features) {
    f.title = "Title words ".repeat(4).slice(0, LIMITS.featureTitle);
    f.detail = "Detail words ".repeat(7).slice(0, LIMITS.featureDetail);
  }
  const out = tmpDir();
  const log = join(out, "check.log");
  ensureBrowser({ log });
  for (const layout of ["wide", "tall"]) {
    const dir = buildProject(story, layout, { baseDir: out, outDir: out });
    assert.deepEqual(checkProject(dir, { log }), [], `${layout} layout has problems; see ${log}`);
  }
});

test("a bad story renders nothing and exits 1", () => {
  const repo = tmpDir();
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify({ ...validStory(), name: "" }));
  assert.equal(main([], { cwd: repo }), 1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm run test:render`
Expected: FAIL with `Cannot find module …/scripts/render.mjs`

- [ ] **Step 3: Write the render command**

`skills/readmereel/scripts/render.mjs`:
```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildProject, LAYOUTS } from "./lib/build.mjs";
import { GIF, makeGif } from "./lib/gif.mjs";
import { checkProject, ensureBrowser, renderProject } from "./lib/hf.mjs";
import { validateStory } from "./lib/story.mjs";
import { checkTools } from "./lib/tools.mjs";

function readStory(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? `No story file at ${path}` : `${path} is not valid JSON: ${err.message}`);
  }
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const quality = argv.includes("--draft") ? "draft" : "looks";
  const storyPath = resolve(cwd, argv.find((a) => !a.startsWith("--")) ?? "launch-video/story.json");
  const outDir = dirname(storyPath);
  const show = (p) => relative(cwd, p) || ".";
  try {
    const missing = checkTools();
    if (missing.length) {
      missing.forEach((m) => console.error(`✗ ${m}`));
      return 1;
    }
    const story = readStory(storyPath);
    const errors = validateStory(story, cwd);
    if (errors.length) {
      console.error(`✗ ${show(storyPath)} has problems:`);
      errors.forEach((e) => console.error(`  - ${e}`));
      return 1;
    }
    const log = join(outDir, "render.log");
    writeFileSync(log, "");
    console.log("Getting Chrome ready…");
    ensureBrowser({ log });
    for (const layout of Object.keys(LAYOUTS)) {
      const dir = buildProject(story, layout, { baseDir: cwd, outDir });
      const problems = checkProject(dir, { log });
      if (problems.length) {
        console.error(`✗ The ${layout} video has layout problems:`);
        problems.forEach((p) => console.error(`  - ${p}`));
        return 1;
      }
      console.log(`Rendering ${LAYOUTS[layout].video}…`);
      renderProject(dir, join(outDir, LAYOUTS[layout].video), { log, quality });
    }
    const gif = join(outDir, "video.gif");
    const bytes = makeGif(join(outDir, LAYOUTS.wide.video), gif);
    if (bytes > GIF.maxBytes) console.warn(`! ${show(gif)} is ${(bytes / 1048576).toFixed(1)} MB, over 8 MB even after cutting it to 12 s.`);
    console.log(`✓ Done:\n  ${show(join(outDir, LAYOUTS.wide.video))}\n  ${show(join(outDir, LAYOUTS.tall.video))}\n  ${show(gif)}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
```

- [ ] **Step 4: Run the render tests and the unit tests**

Run: `npm run test:render`
Expected: `# pass 3`, `# fail 0` (takes about 3–5 minutes; the first run downloads Chrome)

Run: `npm test`
Expected: `# pass 26`, `# fail 0`

- [ ] **Step 5: Watch the fixture video**

Run the first test's steps by hand in a temp folder, or keep its folder by printing `repo` in the test temporarily, and open `video-16x9.mp4` and `video-9x16.mp4`. Check every scene shows its text, the feature 1 frame shows the grey image, features 2 and 3 show large text cards, the install command types out and "made with readmereel" appears at the end. Remove any temporary print before committing.

- [ ] **Step 6: Commit**

```bash
git add skills/readmereel/scripts/render.mjs tests/render.integration.mjs
git commit -m "Add render command and end-to-end render tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Skill instructions and plugin manifests

**Files:**
- Create: `skills/readmereel/SKILL.md`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `tests/manifest.test.mjs`

**Interfaces:**
- Consumes: the story fields and limits (Task 1), the render CLI (Task 4).

- [ ] **Step 1: Write the failing test**

`tests/manifest.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LIMITS } from "../skills/readmereel/scripts/lib/story.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("plugin manifest points at the skill", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "readmereel");
  assert.deepEqual(plugin.skills, ["./skills/readmereel"]);
  assert.ok(existsSync(new URL("../skills/readmereel/SKILL.md", import.meta.url)));
  const market = JSON.parse(read(".claude-plugin/marketplace.json"));
  assert.equal(market.plugins[0].name, "readmereel");
  assert.equal(market.plugins[0].source, "./");
});

test("SKILL.md has front matter and states the real limits", () => {
  const skill = read("skills/readmereel/SKILL.md");
  assert.match(skill, /^---\nname: readmereel\ndescription: .+\n/);
  for (const [key, max] of Object.entries(LIMITS)) assert.ok(skill.includes(`${max}`), `limit for ${key} (${max}) is in SKILL.md`);
  assert.ok(skill.includes("scripts/render.mjs"));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test`
Expected: FAIL with `ENOENT … .claude-plugin/plugin.json`

- [ ] **Step 3: Write the manifests**

`.claude-plugin/plugin.json`:
```json
{
  "name": "readmereel",
  "description": "Turn your README into a launch video: a 25-second MP4 in 16:9 and 9:16 plus a GIF, rendered locally for free.",
  "version": "0.1.0",
  "author": { "name": "Taufique Khan", "url": "https://github.com/taufiquebuilds" },
  "homepage": "https://github.com/taufiquebuilds/readmereel",
  "repository": "https://github.com/taufiquebuilds/readmereel",
  "license": "MIT",
  "keywords": ["video", "launch", "readme", "motion-design", "hyperframes", "marketing", "open-source", "gif"],
  "skills": ["./skills/readmereel"]
}
```

`.claude-plugin/marketplace.json`:
```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "readmereel",
  "owner": { "name": "taufiquebuilds", "url": "https://github.com/taufiquebuilds" },
  "description": "Install readmereel as a Claude plugin.",
  "plugins": [
    {
      "name": "readmereel",
      "source": "./",
      "description": "Turn your README into a launch video.",
      "license": "MIT",
      "keywords": ["video", "launch", "readme", "motion-design", "hyperframes", "gif"]
    }
  ]
}
```

- [ ] **Step 4: Write SKILL.md**

`skills/readmereel/SKILL.md`:
````markdown
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
- real screenshots, GIFs or diagrams (`docs/`, `assets/`, `.github/`, `images/`, `screenshots/`, image links in the README that point to files in the repo)
- a logo (PNG or SVG) and a brand colour (from the logo, the README badges or the CSS)
- the GitHub URL (from `git remote get-url origin`) and, if `gh` works, the star count: `gh repo view --json stargazerCount -q .stargazerCount`

## 2. Write launch-video/story.json

Create the folder `launch-video/` at the repo root and write `launch-video/story.json`. Paths are relative to the repo root. Fields, with hard limits the script enforces:

| Field | Limit | Write it as |
| --- | --- | --- |
| `name` | 24 characters | The product name exactly as the README writes it |
| `problem` | 70 characters | The user's pain, not the product: "Every AI deck looks the same" |
| `promise` | 60 characters | The outcome the user gets: "Slides that look designed by a person" |
| `features` | exactly 3 | Each `{ "title", "detail", "image" }` |
| feature `title` | 40 characters | A result, not a component name: "Never sends a month twice" |
| feature `detail` | 80 characters | One plain sentence on how or why |
| feature `image` | optional | Path to a real screenshot or GIF in the repo that shows this feature. Leave it out if there is none. Never make or fetch one. |
| `install` | 48 characters | One command, one line, exactly as the README gives it; if it is longer, use the shortest real first command |
| `url` | 60 characters | `github.com/owner/repo` (no `https://`) |
| `stars` | | The star count, or `null`. Shown only when 10 or more |
| `logo` | optional | Path to a PNG or SVG logo |
| `accent` | | Hex colour like `#0f766e`; the brand colour, else leave it out |
| `music` | optional | Only if the user gives you an audio file |
| `endCard` | | Leave it out (true). Set `false` only if the user asks for no "made with readmereel" line |

Example:

```json
{
  "name": "agencyrecap",
  "problem": "Client reporting tools charge you more for every client you win",
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

Copy rules: short words, no hype ("revolutionary", "supercharge", "seamless", "unlock"), no emoji, no exclamation marks, sentence case, numbers as digits. Every claim must be something the repo shows.

## 3. Show the user the scenes and wait

Before rendering, show the six scenes as a numbered list and ask for "ok" or changes:

1. Hook (3 s): `problem`
2. Title (3 s): `name`, `promise`
3. Feature 1 (4 s): title, detail, image file or "text card"
4. Feature 2 (4 s): same
5. Feature 3 (4 s): same
6. Install + star (7 s): `install`, "Star on GitHub", `url`

## 4. Render

From the repo root run (the path is this skill's folder):

```bash
node <path-to-this-skill>/scripts/render.mjs launch-video/story.json
```

It needs Node 22+ and ffmpeg and prints how to install either if missing. It takes 1–3 minutes. If it prints story problems or layout problems, fix `story.json` (shorten the named text) and run it again. If a render fails, read the end of `launch-video/render.log`.

## 5. Hand over

Tell the user what was made:

- `launch-video/video-16x9.mp4`: README, Product Hunt, Show HN, YouTube
- `launch-video/video-9x16.mp4`: X, LinkedIn, Instagram Reels, TikTok
- `launch-video/video.gif`: paste at the top of the README with `![<name> launch video](launch-video/video.gif)`
- `launch-video/wide/` and `launch-video/tall/`: editable HyperFrames projects (`npx hyperframes preview` inside either)

To change words later, edit `story.json` and run the same command again. Suggest adding `launch-video/wide/`, `launch-video/tall/` and `launch-video/render.log` to `.gitignore`. If no feature had a real image, say that adding a screenshot to the repo makes the video stronger.
````

- [ ] **Step 5: Run the tests to see them pass**

Run: `npm test`
Expected: `# pass 28`, `# fail 0`

- [ ] **Step 6: Commit**

```bash
git add skills/readmereel/SKILL.md .claude-plugin tests/manifest.test.mjs
git commit -m "Add skill instructions and plugin manifests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg
      - run: npm test
      - run: npm run test:render
```

- [ ] **Step 2: Check the YAML parses**

Run: `node -e 'const s=require("fs").readFileSync(".github/workflows/ci.yml","utf8"); if(!s.includes("npm run test:render")) process.exit(1); console.log("ok")'`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Add CI that runs unit and render tests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Four real examples and the README

**Files:**
- Create: `examples/agencyrecap/`, `examples/nopurple/`, `examples/repoheat/`, `examples/launchday/` (each: `story.json`, copied images, `video.gif`, `poster.png`), `README.md`, `CHANGELOG.md`

The four source repos are on this machine:
- `/Users/taufiquekhan/client repo` (agencyrecap)
- `/Users/taufiquekhan/gihub repo public/nopurple`
- `/Users/taufiquekhan/gihub repo public/repoheat`
- `/Users/taufiquekhan/gihub repo public/launchday`

- [ ] **Step 1: Write each example story by following SKILL.md**

For each repo: read it as SKILL.md section 1 says, copy the real images you choose into `examples/<repo>/` (keep the original file name), and write `examples/<repo>/story.json` with image paths relative to the readmereel repo root, for example `examples/agencyrecap/dashboard.png`. Follow every copy rule in SKILL.md. Get star counts with `gh repo view taufiquebuilds/<repo> --json stargazerCount -q .stargazerCount`.

- [ ] **Step 2: Render each example**

Run from the readmereel repo root, once per repo:
```bash
node skills/readmereel/scripts/render.mjs examples/agencyrecap/story.json
node skills/readmereel/scripts/render.mjs examples/nopurple/story.json
node skills/readmereel/scripts/render.mjs examples/repoheat/story.json
node skills/readmereel/scripts/render.mjs examples/launchday/story.json
```
Expected: each ends with `✓ Done:` and three paths.

- [ ] **Step 3: Make a poster frame and watch every video**

```bash
for r in agencyrecap nopurple repoheat launchday; do
  ffmpeg -v error -y -ss 8 -i examples/$r/video-16x9.mp4 -frames:v 1 -vf scale=960:-1 examples/$r/poster.png
done
```
Open all eight MP4s and check: no text cut off, every image is the intended screenshot, the install command matches the repo's README, and the URL is right. Fix the story and re-render any that fail.

- [ ] **Step 4: Write CHANGELOG.md**

```markdown
# Changelog

## 0.1.0 - 2026-11-03

- First release: turn a README into a 25-second launch video in 16:9 and 9:16 plus a GIF, rendered locally with HyperFrames.
```

- [ ] **Step 5: Write README.md**

Structure, in this order (follow nopurple's README style: plain words, short sections, tables):

1. Centered header: `# readmereel`, bold one-liner **Turn your README into a launch video.**, CI badge (`https://github.com/taufiquebuilds/readmereel/actions/workflows/ci.yml/badge.svg`) and MIT badge, then `examples/agencyrecap/video.gif` with alt text describing it.
2. One paragraph: you ask your agent "make a launch video for this repo"; it reads the README, writes the six scenes, shows them to you, and renders a wide video, a vertical video and a GIF on your machine. Free, no API keys, no AI video model.
3. Install block:
   ```
   /plugin marketplace add taufiquebuilds/readmereel
   /plugin install readmereel@readmereel
   ```
   Then: **"make a launch video for this repo"**. For Codex, Cursor and other agents: copy `skills/readmereel` into the agent's skills folder.
4. `## Examples`: a 2×2 table of the four `poster.png` images, each linking to the repo it shows, with a line under the table saying the MP4s are on the release page.
5. `## What you get`: a table of the three output files and where to post each.
6. `## The six scenes`: the scene table from SKILL.md step 3 with times.
7. `## Requirements`: Node 22+, ffmpeg; Chrome is fetched by HyperFrames on first run; renders take 1–3 minutes.
8. `## Edit and re-render`: edit `launch-video/story.json`, run `node <skill>/scripts/render.mjs`; or open `launch-video/wide` in HyperFrames Studio with `npx hyperframes preview`.
9. `## How it works`: story.json → template → `hyperframes check` → `hyperframes render` ×2 → ffmpeg GIF; built on [HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0) and GSAP.
10. `## Licence`: MIT; the "made with readmereel" line can be turned off with `"endCard": false`.

- [ ] **Step 6: Run all tests and commit**

Run: `npm test` → `# fail 0`

```bash
git add examples README.md CHANGELOG.md
git status --short   # no .mp4, wide/ or tall/ files should be staged
git commit -m "Add four real examples and the README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Publish (needs the owner's go-ahead)

Do not run this task without the owner confirming in chat.

- [ ] **Step 1:** `gh repo create readmereel --public --source=. --remote=origin --push --description "Turn your README into a launch video. An agent skill that renders a 16:9 and 9:16 launch video plus a GIF from your repo, locally and free."`
- [ ] **Step 2:** Check CI passes: `gh run watch` (or `gh run list --limit 1`).
- [ ] **Step 3:** Release with the MP4s: `git tag v0.1.0 && git push origin v0.1.0`, then `gh release create v0.1.0 examples/*/video-16x9.mp4 examples/*/video-9x16.mp4 --title "v0.1.0" --notes-file CHANGELOG.md`. MP4 file names repeat across examples, so first copy each to `release/<repo>-16x9.mp4` and `release/<repo>-9x16.mp4` and upload those.
