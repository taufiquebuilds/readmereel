# readmereel v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace readmereel's fixed 25-second template with a scene library (8 scene types, 5 transitions, 3 styles, sound effects) that produces 15–35 second launch films at the level of the agencyrecap prototype.

**Architecture:** `story.json` v2 lists 5–8 scenes. `plan.mjs` turns it into a film plan (pure data: per-scene start, length, transition in/out, ground colours, action times, sound cues). `build.mjs` writes a HyperFrames project: a root `index.html` that mounts one sub-composition per scene (scenes overlap by the transition length) plus `<audio>` cues; each scene file is a template from `template/scenes/` with its data and the shared runtime (`template/runtime.js`) stamped in. Transitions are built inside the scenes (outgoing exit + incoming entrance), so no timeline crosses a sub-composition boundary.

**Tech Stack:** Node 22+ (ES modules, `node:test`, zero npm dependencies), HyperFrames 0.9.9 via npx, GSAP 3.15, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-04-readmereel-v2-design.md`
**Visual reference:** `docs/superpowers/reference/agencyrecap-prototype.html` (the approved prototype: copy its motion values, sizes and feel).

## Facts verified before planning (spike on 2026-11-04)

- Two sub-composition hosts can overlap in time; the later one (higher `z-index` on the host) paints over the earlier; a `clip-path` entrance on the later scene's `#root` reveals over the earlier scene. Scene timelines use scene-local time.
- **Each scene must read its data from inside its own root**: `const R = document.querySelector('[data-composition-id="sN"]'); R.querySelector('.scene-data')`. Searching from a parent finds another scene's data.
- `hyperframes check --json` passes for this structure; `render` works.

## Changes from the spec (decided while planning)

1. **Scene templates are specified, not pre-written, except `hook` and `end`.** The plan gives complete code for the engine (story, plan, sanitize, build, sound, runtime) and for the `hook` and `end` scenes as the pattern; every other scene gets an exact contract (data shape, DOM, sizes, motion times, transition hooks, acceptance frames). Scene templates are visual design work done against the prototype by a capable implementer and gated by the longest-text check plus frame review.
2. **Rebuilt HTML screens are scoped**: the sanitizer prefixes the screen's CSS selectors with the screen's own class so two scenes never share styles; screens must not use `@media`, `@keyframes`, `@font-face` or `@import` (rejected with a message).
3. **Sound cues come from the plan** (same action times the scenes animate on), so picture and sound cannot drift.

## Global Constraints

- Node `>=22`; zero npm runtime dependencies; tests `node:test` + `node:assert/strict`; HyperFrames always `npx --yes hyperframes@0.9.9`, run from a private temp folder with `HYPERFRAMES_NO_TELEMETRY=1` (keep v1's `hf.mjs` behaviour).
- 30 fps; wide 1920×1080, tall 1080×1920; film length 15–35 s; transition overlap `T = 0.35` s.
- Text limits (characters): `name` 24; `url` 60 (no `.git`); `install` 48 (one line, no `<placeholder>`); hook line 22 and ≤ 4 words (1–3 lines); `promise` 60; ui `label` 28, `caption` 32, 1–3 focus boxes, ≤ 8 states ≥ 0.4 s apart; terminal `command` 48, 1–12 output lines ≤ 64; counter 1–3 items, `label` 20, `suffix` 3, `note` 24; compare side `label` 24, `points` 1–3 × 40; list exactly 3 × 32.
- Scenes: 5–8; first `hook`, last `end`; `title` at most once; others at most twice.
- Readability: a line holds `0.5 + 0.3 × words` s after it lands; no scene text under 28 px.
- Transitions: kinds `whip`, `zoom`, `flood`, `blur`, `carry`; 3–5 distinct kinds when there are ≥ 4 boundaries; never the same kind twice in a row; `blur` on at most a third of boundaries; deterministic per story.
- Styles `midnight` (default), `paper`, `signal`; fonts Inter + JetBrains Mono only.
- Never invent screenshots, numbers or output: every image, number and output line comes from the repo or from running its command.
- Repo ships no audio files; effects resolved at build time with `npx --yes hyperframes@0.9.9 media-use resolve --type sfx --local-only`.
- Outputs: `video-16x9.mp4`, `video-9x16.mp4`, `video.gif` (≤ 8 MB, cut to 12 s if larger), `poster.png`, `contact.png`, `render.log`, `wide/`, `tall/`.
- End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

```
skills/readmereel/
  SKILL.md                                   rewritten (Task 10)
  scripts/render.mjs                         v2 flow (Task 9)
  scripts/lib/story.mjs                      v2 validation + v1 conversion (Task 1)
  scripts/lib/plan.mjs                       timing, transitions, grounds, cues (Task 2)
  scripts/lib/sanitize.mjs                   HTML screen cleaner + CSS scoper (Task 3)
  scripts/lib/build.mjs                      plan → HyperFrames project (Task 4)
  scripts/lib/sound.mjs                      resolve effects + music (Task 8)
  scripts/lib/hf.mjs, gif.mjs, tools.mjs     kept; hf gate extended (Task 9)
  template/root.html                         root shell (Task 4)
  template/runtime.js                        shared scene runtime (Task 4)
  template/scenes/{hook,end}.html            (Task 4)
  template/scenes/{title,list,counter}.html  (Task 5)
  template/scenes/ui.html                    (Task 6)
  template/scenes/{terminal,compare}.html    (Task 7)
tests/  story2, plan, sanitize, build2, sound, render2 integration, fixtures/
examples/<repo>/                             re-made (Task 11)
```

The v1 files `template/index.html` and `template/hyperframes.json` are replaced: `hyperframes.json` moves to `template/hyperframes.json` unchanged, `template/index.html` is deleted in Task 4.

---

### Task 1: story.json v2 validation and v1 conversion

**Files:** Modify `skills/readmereel/scripts/lib/story.mjs`; Create `tests/story2.test.mjs`; Modify `tests/story.test.mjs` (v1 tests now go through conversion), `tests/helpers.mjs` (add `validStory2()`).

**Interfaces:**
- Produces: `LIMITS` (v2 keys below), `STYLES = ["midnight","paper","signal"]`, `SCENE_TYPES = ["hook","title","ui","terminal","counter","compare","list","end"]`, `DEFAULT_ACCENT = "#22c55e"`, `validateStory(story, baseDir) -> string[]` (accepts v1 or v2; v1 is converted first, errors refer to v2 paths), `toV2(story) -> object` (identity for v2), `isV1(story) -> boolean`.
- `tests/helpers.mjs` adds `validStory2()` returning the story in Step 1.

- [ ] **Step 1: Write the failing tests** — `tests/story2.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, toV2, validateStory } from "../skills/readmereel/scripts/lib/story.mjs";
import { tmpDir, validStory, validStory2 } from "./helpers.mjs";

const errs = (s, dir = tmpDir()) => validateStory(s, dir);

test("a valid v2 story has no errors", () => {
  assert.deepEqual(errs(validStory2()), []);
});

test("scene order and counts", () => {
  const s = validStory2();
  s.scenes = s.scenes.slice(1);
  assert.ok(errs(s).includes("scenes: the first scene must be a hook"));
  const t = validStory2();
  t.scenes.push({ type: "list", items: ["a", "b", "c"] });
  assert.ok(errs(t).includes("scenes: the last scene must be end"));
  const u = validStory2();
  u.scenes.splice(1, 0, { type: "title", promise: "Again" });
  assert.ok(errs(u).includes("scenes: title can appear at most once"));
  const v = validStory2();
  v.scenes = [v.scenes[0], v.scenes.at(-1)];
  assert.ok(errs(v).includes("scenes: use 5 to 8 scenes (you have 2)"));
});

test("hook rules", () => {
  const s = validStory2();
  s.scenes[0] = { type: "hook", lines: ["one two three four five"], count: { line: 0, to: 40 } };
  const e = errs(s);
  assert.ok(e.includes("scenes[0].lines[0]: at most 4 words"));
  assert.ok(e.includes("scenes[0].count: line 0 must contain the number 40"));
});

test("ui needs exactly one of image or html, and boxes are numbers", () => {
  const s = validStory2();
  s.scenes[2] = { type: "ui", focus: [{ box: [1, 2, 3] }] };
  const e = errs(s);
  assert.ok(e.includes("scenes[2]: give either image or html"));
  assert.ok(e.includes("scenes[2].focus[0].box: must be [x, y, width, height] in pixels"));
});

test("ui states are spaced at least 0.4 s apart", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, "s"));
  writeFileSync(join(dir, "s/screen.html"), "<div></div>");
  const s = validStory2();
  s.scenes[2] = { type: "ui", html: "s/screen.html", focus: [{ box: [0, 0, 100, 100] }],
    states: [{ at: 1, selector: "#a", set: "on" }, { at: 1.2, selector: "#b", set: "on" }] };
  assert.ok(errs(s, dir).includes("scenes[2].states[1].at: states must be at least 0.4 s apart"));
});

test("terminal, counter, compare, list limits", () => {
  const s = validStory2();
  s.scenes.splice(1, 3,
    { type: "terminal", command: "x".repeat(LIMITS.command + 1), output: [] },
    { type: "counter", items: [{ value: "12", label: "Stars" }] },
    { type: "compare", before: { label: "A", points: ["a"] }, after: { label: "B" } });
  const e = errs(s);
  assert.ok(e.includes(`scenes[1].command: ${LIMITS.command + 1} characters, the limit is ${LIMITS.command}`));
  assert.ok(e.includes("scenes[1].output: 1 to 12 lines"));
  assert.ok(e.includes("scenes[2].items[0].value: must be a real number"));
  assert.ok(e.includes("scenes[3].after: give either image or points"));
});

test("install placeholders and unknown fields are rejected", () => {
  const s = validStory2();
  s.install = "repoheat --user <your-username>";
  s.scenes[0].colour = "red";
  const e = errs(s);
  assert.ok(e.includes("install: use a real value, not a placeholder like <your-username>"));
  assert.ok(e.includes("scenes[0].colour: unknown field"));
});

test("v1 stories convert to v2 and validate", () => {
  const v2 = toV2(validStory());
  assert.equal(v2.version, 2);
  assert.equal(v2.scenes[0].type, "hook");
  assert.equal(v2.scenes[1].type, "title");
  assert.equal(v2.scenes.at(-1).type, "end");
  assert.ok(v2.scenes.length >= 5);
  assert.deepEqual(validateStory(validStory(), tmpDir()), []);
});
```

- [ ] **Step 2: Add `validStory2()` to `tests/helpers.mjs`:**

```js
export function validStory2() {
  return {
    version: 2,
    name: "agencyrecap",
    url: "github.com/taufiquebuilds/agencyrecap",
    install: "docker compose up -d",
    accent: "#1f7a4d",
    style: "midnight",
    scenes: [
      { type: "hook", lines: ["40 clients.", "40 reports.", "Every single month."], accentWords: ["single", "month."], count: { line: 0, to: 40 } },
      { type: "title", promise: "Monthly client reports that send themselves" },
      { type: "list", items: ["Branded PDF every month", "Never sends twice", "Free to self-host"] },
      { type: "counter", items: [{ value: 4812, label: "Sessions", note: "up 10%" }] },
      { type: "end" },
    ],
  };
}
```

- [ ] **Step 3: Run tests — expect FAIL** (`npm test`): missing exports / wrong messages.

- [ ] **Step 4: Implement `story.mjs` v2.** Keep v1 helpers (`text`, `file`). Rules exactly as the Global Constraints and the spec's "Scene types" section; error strings exactly as in the tests. `LIMITS = { name: 24, url: 60, install: 48, hookLine: 22, hookWords: 4, promise: 60, label: 28, caption: 32, command: 48, outputLine: 64, counterLabel: 20, suffix: 3, note: 24, sideLabel: 24, point: 40, listItem: 32 }`. Placeholder check: `/<[^>]+>/`. Box: array of 4 finite numbers, w and h > 0. `count.line` must index a line whose text contains `String(count.to)`. Counter `value`: finite number, integers ≤ 9,999,999 or one decimal place. `music`: audio path, `"heygen"` or null. Top-level unknown keys and per-scene unknown keys rejected (each scene type has its own allowed key list, always including `type`).

`toV2(v1)`: `{ version: 2, name, url, install, accent, logo, music: v1.music ?? null, sfx: true, endCard: v1.endCard ?? true, style: "midnight", scenes: [ { type: "hook", lines: splitHook(problem) }, { type: "title", promise }, ...features.map(f => f.image ? { type: "ui", image: f.image, focus: [{ box: [0, 0, W, H], label: f.title.slice(0, 28) }], caption: shorten(f.detail, 32) } : { type: "list"… }), { type: "end" } ] }` where: `splitHook` breaks the problem into ≤ 3 lines of ≤ 4 words / ≤ 22 chars (greedy by words; if that needs more than 3 lines, use the first 3); image features become `ui` scenes with one focus box covering the whole image (`W`/`H` read from the PNG/JPEG header — implement `imageSize(path)` for PNG (IHDR) and JPEG (SOF0/2) and SVG (`width`/`height` or `viewBox`); unknown → `[0,0,1600,1000]`); text-only features are gathered into one `list` scene of their titles (pad to exactly 3 by including image-feature titles if needed). Ensure 5–8 scenes by adding the `list` scene if the count is below 5.

- [ ] **Step 5: Update `tests/story.test.mjs`** so v1 validation tests still pass (they go through `validateStory`, which converts first; v1-specific messages for v1-only fields stay as they are: validate v1 shape first with the v1 rules, then convert and validate v2).

- [ ] **Step 6: Run `npm test` — expect PASS; commit** `Add story.json v2 validation and v1 conversion`.

---

### Task 2: Film plan — timing, transitions, grounds, cues

**Files:** Create `skills/readmereel/scripts/lib/plan.mjs`, `tests/plan.test.mjs`.

**Interfaces:**
- Consumes: v2 story (validated).
- Produces: `T = 0.35`; `hold(text) -> seconds`; `sceneLength(scene, story) -> seconds`; `sceneBeats(scene, story) -> { lineStarts?, focusStarts?, stateTimes?, itemStarts?, typeStart?, outputStart?, wipeStart?, landTimes? }` (scene-local seconds, used by both the scene template and the sound cues); `GROUNDS(style, accent) -> { [type]: hex }`; `pickTransitions(scenes, grounds, seed) -> string[]` (length n−1); `planFilm(story) -> { duration, scenes: [{ id: "s1", index, type, start, duration, in, out, ground, nextGround, beats, data }], cues: [{ t, sound }] }`; throws `Error("Too much to read in 35 s: remove a scene or shorten text in scenes[i] (<type>)")` naming the longest scene.

- [ ] **Step 1: Write the failing tests** — `tests/plan.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { hold, pickTransitions, planFilm, sceneLength, T } from "../skills/readmereel/scripts/lib/plan.mjs";
import { validStory2 } from "./helpers.mjs";

test("hold follows the readability rule", () => {
  assert.equal(hold("Sent. By itself."), 0.5 + 0.3 * 3);
});

test("film length is clamped to 15–35 s and scenes overlap by T", () => {
  const p = planFilm(validStory2());
  assert.ok(p.duration >= 15 && p.duration <= 35, `duration ${p.duration}`);
  for (let i = 1; i < p.scenes.length; i++) {
    const prev = p.scenes[i - 1];
    assert.ok(Math.abs(p.scenes[i].start - (prev.start + prev.duration - T)) < 1e-9);
  }
  const last = p.scenes.at(-1);
  assert.ok(Math.abs(last.start + last.duration - p.duration) < 1e-9);
});

test("a story that cannot fit in 35 s names a scene", () => {
  const s = validStory2();
  const long = "one two three four five six";
  const counter = { type: "counter", items: [1, 2, 3].map((v) => ({ value: v, label: "four word label here", note: "and a four word note" })) };
  s.scenes = [
    { type: "hook", lines: ["One two three four", "Five six seven eight", "Nine ten eleven twelve"] },
    { type: "title", promise: "one two three four five six seven eight nine ten" },
    { type: "list", items: [long, long, long] },
    { type: "list", items: [long, long, long] },
    counter,
    counter,
    { type: "terminal", command: "npm test", output: ["ok"] },
    { type: "end" },
  ];
  assert.throws(() => planFilm(s), /Too much to read in 35 s: remove a scene or shorten text in scenes\[2\] \(list\)/);
});

function randomScenes(rand) {
  const middle = ["title", "ui", "terminal", "counter", "compare", "list"];
  const n = 5 + Math.floor(rand() * 4);
  const scenes = [{ type: "hook" }];
  while (scenes.length < n - 1) {
    const t = middle[Math.floor(rand() * middle.length)];
    if (t === "title" && scenes.some((x) => x.type === "title")) continue;
    if (scenes.filter((x) => x.type === t).length >= 2) continue;
    scenes.push({ type: t });
  }
  scenes.push({ type: "end" });
  return scenes;
}

test("transition rules hold for 1,000 random films", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const grounds = { hook: "#08090b", title: "#08090b", ui: "#e9edf1", terminal: "#08090b", counter: "#08090b", compare: "#e9edf1", list: "#08090b", end: "#08090b" };
  for (let k = 0; k < 1000; k++) {
    const scenes = randomScenes(rand);
    const kinds = pickTransitions(scenes, grounds, `seed-${k}`);
    assert.equal(kinds.length, scenes.length - 1);
    for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1], `repeat at ${i}`);
    if (kinds.length >= 4) {
      const distinct = new Set(kinds).size;
      assert.ok(distinct >= 3 && distinct <= 5, `distinct ${distinct}`);
    }
    assert.ok(kinds.filter((x) => x === "blur").length <= Math.ceil(kinds.length / 3));
    kinds.forEach((kind, i) => {
      if (kind === "zoom") assert.ok(["ui", "counter", "title"].includes(scenes[i].type));
      if (kind === "carry") assert.ok(["ui", "compare"].includes(scenes[i].type));
      if (kind === "flood") assert.notEqual(grounds[scenes[i].type], grounds[scenes[i + 1].type]);
    });
    assert.deepEqual(pickTransitions(scenes, grounds, `seed-${k}`), kinds, "deterministic");
  }
});

test("cues follow transitions and actions", () => {
  const p = planFilm(validStory2());
  const whooshes = p.cues.filter((c) => c.sound.startsWith("whoosh"));
  const moving = p.scenes.slice(1).filter((s) => ["whip", "zoom", "carry"].includes(s.in));
  assert.equal(whooshes.length, moving.length);
  for (let i = 1; i < whooshes.length; i++) assert.notEqual(whooshes[i].sound, whooshes[i - 1].sound, "takes rotate");
  assert.ok(p.cues.some((c) => c.sound === "impact-bass-1"), "end card impact");
});

test("sceneLength grows with text", () => {
  const story = validStory2();
  assert.ok(sceneLength({ type: "list", items: ["a b c d e f", "g", "h"] }, story) > sceneLength({ type: "list", items: ["a", "g", "h"] }, story));
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `plan.mjs`.**
  - `words(s)` = count of whitespace-separated tokens; `hold(s) = 0.5 + 0.3 × words(s)`.
  - `sceneBeats` and `sceneLength` per type (scene-local, entrance starts at 0 and includes the incoming transition):
    - `hook`: `lineStarts[k] = Σ_{j<k}(0.35 + hold(lines[j]))`; length = `lineStarts.at(-1) + 0.35 + hold(last) + 0.2`.
    - `title`: `landTimes = [0.15 (logo), 0.35 (name), 0.8 (promise)]`; length = `0.8 + 0.2 + hold(promise) + 0.2`.
    - `ui`: establish 0.8; `focusStarts[k] = 0.8 + Σ_{j<k}(0.6 + hold(label_j) )`; `stateTimes` = states' `at` values; caption lands at `captionAt = max(focus end, last state + 0.5)`; length = `captionAt + hold(caption ?? "") + 0.35`.
    - `terminal`: `typeStart = 0.35`; typing `min(1.6, 0.05 × command.length)`; `outputStart = typeStart + typing + 0.15`; line k at `outputStart + 0.075k`; length = `outputStart + 0.075 × output.length + 1.2 + 0.6`.
    - `counter`: `itemStarts[k] = 0.35 + 0.12k`; counts last 1.0; length = `0.35 + 0.12(n−1) + 1.0 + max_k hold(label_k + " " + (note_k ?? ""))`.
    - `compare`: `wipeStart = 0.6 + hold(before.label)`; wipe 0.8; length = `wipeStart + 0.8 + hold(after.label + " " + (after.points ?? []).join(" ")) + 0.2`.
    - `list`: `itemStarts[k] = Σ_{j<k}(0.25 + hold(items[j]))`; length = `itemStarts[2] + 0.25 + hold(items[2])`.
    - `end`: `landTimes = [0.1 logo, 0.25 name, 0.6 tagline/url, 0.75 install starts typing]`; typing `0.03 × install.length`; length = `max(0.75 + typing + 2.5, 3.2)`.
  - Raw total = `Σ length − T × (n−1)`. If < 15: add `(15 − total) / n` to every scene length (stretching holds). If > 35: throw, naming the scene with the largest length.
  - `GROUNDS(style, accent)`: midnight → dark `#08090b` for hook/title/terminal/counter/list/end, light `#e9edf1` for ui/compare; paper → `#f6f5f1` everywhere except ui/compare `#e9edf1`; signal → accent for hook/list/end, `#08090b` for title/terminal/counter, `#e9edf1` for ui/compare.
  - `pickTransitions(scenes, grounds, seed)`: seeded PRNG (FNV-1a hash of `seed` → mulberry32). For boundary i: allowed = `["whip","blur"]` + `"zoom"` if `scenes[i].type ∈ {ui,counter,title}` + `"carry"` if `∈ {ui,compare}` + `"flood"` if grounds differ; remove the previous kind; remove `"blur"` if already at `ceil(n/3)`. Prefer an allowed kind not used yet while the distinct count < 5 (pick uniformly among those), otherwise uniform among allowed. After the pass, if boundaries ≥ 4 and distinct < 3, retry with seed + `#1`, `#2`, … (up to 200); if still failing, force the third kind at the first boundary where an unused allowed kind exists. Deterministic: same scenes + grounds + seed → same result.
  - `planFilm(story)`: seed = `JSON.stringify(story.scenes)`; build `scenes` with ids `s1…sN`, `start`, `duration`, `in` (kind of boundary before, `null` for the first), `out` (kind after, `null` for the last), `ground`, `nextGround`, `beats`, `data` = the scene's fields plus top-level `name`, `install`, `url`, `logo` (for title/end), `accent`, `style`, `endCard`.
  - `cues`: for each scene with `in ∈ {whip,zoom,carry}` → `{ t: start, sound: alternating "whoosh" / "whoosh-short" }` (first one `whoosh`); `ui`: each focus start → `click-soft` at `start + focusStarts[k] + 0.6`, each state → alternating `pop` / `click-soft` at `start + at`; `counter`: each item → `pop` at `start + itemStarts[k] + 1.0`; `terminal`: `key-press` at `start + typeStart`; `end`: `impact-bass-1` at `start + 0.1`; also `key-press` at `start + 0.75`. Each cue time is shifted by `+1/30` (sound one frame after picture). Sorted by `t`.

- [ ] **Step 4: Run — expect PASS; commit** `Add the film planner: timing, transitions and sound cues`.

---

### Task 3: HTML screen sanitizer and CSS scoper

**Files:** Create `skills/readmereel/scripts/lib/sanitize.mjs`, `tests/sanitize.test.mjs`.

**Interfaces:** `sanitizeScreen(html, scopeClass) -> { html, css, images: string[], removed: string[] }` — `html` is the body markup (no `<style>`), `css` the scoped CSS, `images` the local `src` values to copy; throws `Error("screen: <rule>")` for `@media`, `@keyframes`, `@font-face`, `@import`. `scopeCss(css, scopeClass) -> string`.

- [ ] **Step 1: Write the failing tests** — `tests/sanitize.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeScreen, scopeCss } from "../skills/readmereel/scripts/lib/sanitize.mjs";

const evil = `<html><head><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="https://x/a.css"><base href="https://x/">
<style>body{background:url(https://x/t.png)} .a,.b > i{color:red} :root{--c:1px}</style></head>
<body onload="alert(1)"><script>alert(1)</script><iframe src="https://x"></iframe><object data="x"></object><embed src="x">
<form action="https://x"><input></form><a href="javascript:alert(1)" onclick="x()">a</a><img src="https://x/p.png"><img src="shots/ok.png" onerror="x()">
<div style="background-image:url('//x/p.png')">ok</div><svg><script>alert(1)</script><a xlink:href="javascript:x"></a></svg></body></html>`;

test("removes active content and outside URLs", () => {
  const out = sanitizeScreen(evil, "screen-s3");
  for (const bad of ["<script", "<iframe", "<object", "<embed", "<form", "<link", "<meta", "<base", "onload", "onclick", "onerror", "javascript:", "https://", "//x/"]) {
    assert.ok(!out.html.includes(bad) && !out.css.includes(bad), `still has ${bad}`);
  }
  assert.ok(out.html.includes(">ok<"));
  assert.deepEqual(out.images, ["shots/ok.png"]);
  assert.ok(out.removed.length >= 10);
});

test("scopes every selector to the screen", () => {
  assert.equal(scopeCss(".a,.b > i{color:red}", "screen-s3"), ".screen-s3 .a,.screen-s3 .b > i{color:red}");
  assert.equal(scopeCss("body{margin:0} html{x:1} :root{--c:1px}", "screen-s3"), ".screen-s3{margin:0} .screen-s3{x:1} .screen-s3{--c:1px}");
});

test("rejects at-rules the screen may not use", () => {
  assert.throws(() => sanitizeScreen("<style>@media (max-width:1px){a{b:c}}</style>", "s"), /screen: @media is not allowed/);
  assert.throws(() => sanitizeScreen("<style>@import url(x.css);</style>", "s"), /screen: @import is not allowed/);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** with plain string/regex processing (no dependencies): extract `<style>` blocks into `css`; take the inner HTML of `<body>` if present; remove `script|iframe|object|embed|form|noscript|template` elements with content, and `link|meta|base|input` tags; strip `\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)`; for `href|src|srcset|action|xlink:href|data` attribute values starting with `javascript:`, `vbscript:`, `data:` (except `data:image/(png|jpeg|gif|webp);base64,`), `http:`, `https:` or `//` → drop the attribute; in `style` attributes and in `css`, replace `url(...)` whose target is outside (`http`, `//`, `javascript:`, `data:` other than images) with `none`; reject the four at-rules; collect remaining `<img src>` values (relative, no `..` segments; otherwise drop the `<img>`); record a human-readable entry in `removed` for each removal. `scopeCss`: split top-level rules on `}`; for each `selectors{body}`, split selectors on commas, map `body|html|:root` → `.scope`, everything else → `.scope ` + selector; keep bodies unchanged.
- [ ] **Step 4: Run — expect PASS; commit** `Add the HTML screen sanitizer`.

---

### Task 4: Runtime, root shell, project builder, and the `hook` and `end` scenes

**Files:** Create `skills/readmereel/template/root.html`, `template/runtime.js`, `template/scenes/hook.html`, `template/scenes/end.html`; Rewrite `skills/readmereel/scripts/lib/build.mjs`; Delete `template/index.html`; Create `tests/build2.test.mjs`; delete `tests/build.test.mjs` (v1 builder tests) after porting the cases that still apply (escaping, `$&` safety, placeholders replaced, rebuild clears old project).

**Interfaces:**
- Consumes: `planFilm` (Task 2), `sanitizeScreen` (Task 3, used for `ui` html in Task 6 — wire the call now, behind `scene.type === "ui" && scene.html`).
- Produces: `LAYOUTS` (as v1), `TEMPLATE_DIR`, `buildProject(story, layout, { baseDir, outDir, plan, sfxDir? }) -> projectDir` writing `index.html`, `compositions/sN-<type>.html`, `assets/` (logo, images, screens' images, sfx files if `sfxDir` given), `hyperframes.json`.

**The scene contract (every scene file follows it; Tasks 5–7 rely on it):**
- File shape: `<!doctype html><html><head><meta charset="UTF-8" /></head><body><template> <style>…</style> <div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__" class="__LAYOUT__ style-__STYLE__"> …markup… <script type="application/json" class="scene-data">__DATA__</script> </div> <script>__RUNTIME__ (() => { const S = RR.scene("__ID__"); …; S.done(); })();</script> </template></body></html>`.
- `RR.scene(id)` returns `{ R, D, tl, q, qa, W, H, wide }`: `R` = the root, `D` = parsed data (the plan scene: `data`, `beats`, `duration`, `in`, `out`, `ground`, `nextGround`), `tl` = a paused GSAP timeline, `q`/`qa` = `R.querySelector(All)`. `S.done()` applies the transitions (`RR.transIn`, `RR.transOut`) and registers `window.__timelines[id] = tl`.
- CSS classes are prefixed with the scene type (`.hook-…`, `.end-…`) so different scene types never collide; style the root as `#root` only.
- Every text element that holds readable copy has `data-field="<story path>"` (e.g. `data-field="scenes[0].lines[1]"`) so gate problems map to story fields.
- The scene's ground is `#root { background: var(--ground) }` with `--ground` set from `D.ground`; ink colour from the style.
- Transition hooks: an element with class `hero` (the scene's main card/word) and an optional `data-zoom-target` element (the point a `zoom` exit dives into; default: the hero's centre).

- [ ] **Step 1: Write the failing tests** — `tests/build2.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { tmpDir, validStory2 } from "./helpers.mjs";

function onlyHookAndEnd() {
  const s = validStory2();
  s.scenes = [s.scenes[0], { type: "hook", lines: ["Second hook."] }, { type: "hook", lines: ["Third one."] }, { type: "hook", lines: ["Fourth."] }, { type: "end" }];
  return s;
}

test("builds a root with one host per scene, overlapping by T", () => {
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(root.includes(`data-duration="${plan.duration}"`));
  plan.scenes.forEach((s) => {
    assert.ok(root.includes(`data-composition-id="${s.id}"`));
    assert.ok(root.includes(`data-composition-src="compositions/${s.id}-${s.type}.html"`));
    assert.ok(root.includes(`data-start="${s.start}"`));
  });
  assert.deepEqual(readdirSync(join(dir, "compositions")).sort(), plan.scenes.map((s) => `${s.id}-${s.type}.html`).sort());
});

test("each scene file carries its own data inside its root, safely escaped", () => {
  const story = onlyHookAndEnd();
  story.scenes[1].lines = ["</script> $& it's"];
  const plan = planFilm(story);
  const dir = buildProject(story, "tall", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const html = readFileSync(join(dir, "compositions/s2-hook.html"), "utf8");
  const rootStart = html.indexOf('data-composition-id="s2"');
  const dataAt = html.indexOf('class="scene-data"');
  assert.ok(rootStart > 0 && dataAt > rootStart, "data inside the root");
  assert.ok(!html.includes("</script> $&"), "closing tag escaped");
  assert.ok(html.includes("<\\/script> $& it's"));
  assert.ok(html.includes('data-width="1080"') && html.includes('data-height="1920"'));
  assert.ok(!/__[A-Z]+__/.test(html));
});

test("rebuilding replaces the old project", () => {
  const story = onlyHookAndEnd();
  const out = tmpDir();
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: out, plan: planFilm(story) });
  assert.ok(existsSync(join(dir, "hyperframes.json")));
  buildProject(story, "wide", { baseDir: tmpDir(), outDir: out, plan: planFilm(story) });
  assert.ok(existsSync(join(dir, "index.html")));
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Write `template/runtime.js`** (complete; scenes in Tasks 5–7 use only these helpers plus GSAP):

```js
/* readmereel scene runtime: inlined into every scene file. Deterministic: no timers, clocks or randomness. */
var RR = (window.RR = window.RR || (function () {
  const T = 0.35;
  function scene(id) {
    const R = document.querySelector('[data-composition-id="' + id + '"]');
    const D = JSON.parse(R.querySelector(".scene-data").textContent);
    const tl = gsap.timeline({ paused: true });
    const W = Number(R.dataset.width), H = Number(R.dataset.height);
    R.style.setProperty("--ground", D.ground);
    R.style.setProperty("--accent", D.data.accent);
    const S = { id, R, D, tl, W, H, wide: W > H, q: (s) => R.querySelector(s), qa: (s) => Array.from(R.querySelectorAll(s)) };
    S.done = function () { transIn(S); transOut(S); window.__timelines[id] = tl; tl.seek(0); };
    return S;
  }
  // Split an element's text into word spans (keeps accent words marked).
  function words(el, accentWords) {
    const acc = new Set(accentWords || []);
    const parts = el.textContent.split(/(\s+)/);
    el.textContent = "";
    parts.forEach((p) => {
      if (/^\s+$/.test(p)) { el.appendChild(document.createTextNode(p)); return; }
      const s = document.createElement("span");
      s.className = "w" + (acc.has(p) ? " acc" : "");
      s.textContent = p;
      el.appendChild(s);
    });
    return Array.from(el.querySelectorAll(".w"));
  }
  function blurIn(tl, els, t, o) {
    o = o || {};
    tl.fromTo(els, { opacity: o.from ?? 0, filter: "blur(" + (o.blur ?? 8) + "px)" },
      { opacity: 1, filter: "blur(0px)", duration: o.duration ?? 0.14, stagger: o.stagger ?? 0.08, ease: "power2.out" }, t);
  }
  function roll(tl, el, from, to, t, dur, decimals) {
    const o = { v: from };
    const fmt = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
    el.textContent = fmt(from);
    tl.to(o, { v: to, duration: dur, ease: "power3.out", onUpdate: () => { el.textContent = fmt(decimals ? o.v : Math.round(o.v)); } }, t);
  }
  // Shrink one-line text to fit width w (k = average glyph width in em), never below 28 px.
  function fit(el, max, w, k) {
    const n = Math.max(1, el.textContent.length);
    el.style.fontSize = Math.max(28, Math.min(max, Math.floor(w / (n * k)))) + "px";
  }
  function type(tl, el, t, perChar) {
    const n = el.textContent.length;
    el.style.display = "inline-block"; el.style.overflow = "hidden"; el.style.whiteSpace = "nowrap"; el.style.verticalAlign = "bottom";
    tl.fromTo(el, { width: 0 }, { width: n + "ch", duration: Math.min(1.6, n * perChar), ease: "steps(" + n + ")" }, t);
  }
  function content(S) { return S.qa("#root > :not(.scene-data):not(.ground)"); }
  function transIn(S) {
    const { tl, R, D, H, W, wide } = S;
    switch (D.in) {
      case "whip":
        tl.fromTo(R, wide ? { yPercent: 100 } : { xPercent: 100 }, wide ? { yPercent: 0, duration: T, ease: "expo.out" } : { xPercent: 0, duration: T, ease: "expo.out" }, 0);
        tl.fromTo(content(S), { filter: "blur(16px)" }, { filter: "blur(0px)", duration: T, ease: "power2.out" }, 0);
        break;
      case "flood":
        tl.fromTo(R, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(120% at 50% 50%)", duration: 0.4, ease: "power2.inOut" }, 0);
        break;
      case "zoom":
        tl.set(R, { opacity: 0 }, 0).set(R, { opacity: 1 }, T - 0.01);
        break;
      case "carry":
      case "blur":
        tl.fromTo(R, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power2.out" }, D.in === "carry" ? 0.15 : 0);
        tl.fromTo(content(S), { filter: "blur(8px)" }, { filter: "blur(0px)", duration: 0.2, ease: "power2.out" }, 0.1);
        break;
      default: break; // first scene: no entrance transition
    }
  }
  function transOut(S) {
    const { tl, R, D, W, H, wide } = S;
    const end = D.duration;
    const hero = S.q(".hero") || content(S)[0];
    switch (D.out) {
      case "whip":
        tl.to(content(S), wide ? { yPercent: -60, filter: "blur(18px)", duration: 0.22, ease: "power3.in" } : { xPercent: -60, filter: "blur(18px)", duration: 0.22, ease: "power3.in" }, end - T);
        break;
      case "blur":
        tl.to(content(S), { opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in" }, end - T);
        break;
      case "carry":
        tl.to(hero, { scale: 0.6, xPercent: -45, opacity: 0, filter: "blur(6px)", duration: 0.38, ease: "power3.in" }, end - 0.4);
        break;
      case "zoom": {
        const target = S.q("[data-zoom-target]") || hero;
        const r = target.getBoundingClientRect(), rr = R.getBoundingClientRect();
        const cx = r.left - rr.left + r.width / 2, cy = r.top - rr.top + r.height / 2;
        const dot = document.createElement("div");
        dot.className = "zoom-dot";
        Object.assign(dot.style, { position: "absolute", left: cx - 30 + "px", top: cy - 30 + "px", width: "60px", height: "60px", borderRadius: "50%", background: D.nextGround, opacity: "0", zIndex: "50" });
        R.appendChild(dot);
        const cam = S.q(".cam") || R;
        tl.to(cam, { scale: 3, transformOrigin: cx + "px " + cy + "px", duration: 0.45, ease: "power3.in" }, end - 0.45)
          .set(dot, { opacity: 1 }, end - 0.3)
          .to(dot, { scale: Math.ceil((Math.hypot(W, H) / 30) * 1.1), duration: 0.3, ease: "power3.in" }, end - 0.3);
        break;
      }
      default: break; // flood, or the last scene: hold
    }
  }
  return { T, scene, words, blurIn, roll, fit, type };
})());
```

- [ ] **Step 4: Write `template/root.html`:**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=__W__, height=__H__" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: __W__px; height: __H__px; overflow: hidden; background: __BG__; }
      #root { width: 100%; height: 100%; position: relative; overflow: hidden; font-family: "Inter", sans-serif; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="__DURATION__" data-width="__W__" data-height="__H__" data-motion-blur="on">
__HOSTS__
__AUDIO__
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
```

Each host: `<div id="h-sN" data-composition-id="sN" data-composition-src="compositions/sN-<type>.html" data-start="<start>" data-duration="<duration>" data-track-index="<index>" data-width="__W__" data-height="__H__" data-track-kind="graphics" style="z-index:<index+1>"></div>`. Each cue: `<audio id="sfx-<k>" src="assets/sfx/<sound>.mp3" data-start="<t>" data-duration="<min(file length, 2)>" data-track-index="<20+k>" data-volume="0.55"></audio>` (whoosh 0.6, pop 0.5, click-soft 0.7, key-press 0.5, impact-bass-1 0.75 with a fade over its last 0.4 s via `data-automation`); music (Task 8) on track 99. Numbers are written with `Number(x.toFixed(3))`.

- [ ] **Step 5: Write `template/scenes/hook.html`** (complete):

```html
<!doctype html>
<html><head><meta charset="UTF-8" /></head><body><template>
<style>
  #root { position: absolute; inset: 0; overflow: hidden; background: var(--ground); display: flex; align-items: center; justify-content: center; }
  .style-midnight, .style-signal { --ink: #f5f6f8; }
  .style-paper { --ink: #111418; }
  .hook-line { position: absolute; left: 0; right: 0; text-align: center; font-weight: 900; color: var(--ink); letter-spacing: -0.045em; line-height: 1; white-space: nowrap; padding: 0 6%; }
  .hook-line .w { display: inline-block; }
  .hook-line .acc { color: var(--accent); }
  .style-signal .hook-line .acc { color: var(--ink); text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.12em; }
  .hook-num { font-variant-numeric: tabular-nums; }
</style>
<div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__" class="__LAYOUT__ style-__STYLE__">
  __LINES__
  <script type="application/json" class="scene-data">__DATA__</script>
</div>
<script>
__RUNTIME__
(() => {
  const S = RR.scene("__ID__");
  const { tl, D, qa, W, wide } = S;
  const lines = qa(".hook-line");
  const starts = D.beats.lineStarts;
  lines.forEach((el, k) => {
    RR.fit(el, wide ? 240 : 170, W * 0.88, 0.56);
    const ws = RR.words(el, D.data.accentWords);
    const t = starts[k];
    if (k === 0) {
      tl.fromTo(ws, { opacity: 0.25, filter: "blur(10px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.18, stagger: 0.07, ease: "power2.out" }, t);
    } else {
      tl.set(el, { opacity: 1 }, t).fromTo(el, { yPercent: 120, filter: "blur(18px)" }, { yPercent: 0, filter: "blur(0px)", duration: 0.32, ease: "expo.out" }, t);
    }
    if (D.data.count && D.data.count.line === k) {
      const num = ws.find((w) => w.textContent.includes(String(D.data.count.to)));
      if (num) { num.classList.add("hook-num"); RR.roll(tl, num, 1, D.data.count.to, t, 0.45); }
    }
    if (k < lines.length - 1) tl.to(el, { yPercent: -120, filter: "blur(18px)", duration: 0.2, ease: "power3.in" }, starts[k + 1] - 0.12);
  });
  lines.slice(1).forEach((el) => tl.set(el, { opacity: 0 }, 0));
  lines.at(-1).classList.add("hero");
  S.done();
})();
</script>
</template></body></html>
```

`__LINES__` = one `<div class="hook-line" data-field="scenes[i].lines[k]">TEXT</div>` per line (HTML-escaped).

- [ ] **Step 6: Write `template/scenes/end.html`** (complete):

```html
<!doctype html>
<html><head><meta charset="UTF-8" /></head><body><template>
<style>
  #root { position: absolute; inset: 0; overflow: hidden; background: var(--ground); display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .style-midnight, .style-signal { --ink: #f5f6f8; --muted: #a3aab5; --card: #15181d; --line: #262b33; }
  .style-paper { --ink: #111418; --muted: #5b6470; --card: #ffffff; --line: #dfe3e1; }
  .end-mark { display: flex; align-items: center; gap: 34px; }
  .tall .end-mark { flex-direction: column; gap: 28px; }
  .end-badge { width: 132px; height: 132px; border-radius: 34px; background: var(--accent); display: grid; place-items: center; overflow: hidden; }
  .end-badge img { width: 96px; height: 96px; object-fit: contain; }
  .end-badge .glyph { width: 64px; height: 76px; background: var(--ground); border-radius: 8px; clip-path: polygon(0 0, 70% 0, 100% 22%, 100% 100%, 0 100%); }
  .end-name { font-weight: 900; font-size: 168px; letter-spacing: -0.05em; color: var(--ink); white-space: nowrap; }
  .end-name span { display: inline-block; }
  .end-url { font-size: 40px; color: var(--muted); margin-top: 26px; font-weight: 500; }
  .end-cta { margin-top: 48px; font-family: "JetBrains Mono", monospace; font-size: 42px; color: var(--ink); background: var(--card); border: 2px solid var(--line); border-radius: 18px; padding: 26px 44px; white-space: nowrap; }
  .end-cta .p { color: var(--accent); margin-right: 22px; }
  .end-star { margin-top: 34px; display: inline-flex; align-items: center; gap: 14px; font-weight: 900; font-size: 46px; background: var(--accent); color: #fff; padding: 18px 38px; border-radius: 999px; }
  .end-made { position: absolute; bottom: 60px; left: 0; right: 0; text-align: center; font-size: 28px; color: var(--muted); }
</style>
<div id="root" data-composition-id="__ID__" data-width="__W__" data-height="__H__" class="__LAYOUT__ style-__STYLE__">
  <div class="end-mark hero"><div class="end-badge">__LOGO__</div><div class="end-name" data-field="name">__NAME__</div></div>
  <div class="end-cta"><span class="p">$</span><span class="end-cmd" data-field="install">__INSTALL__</span></div>
  <div class="end-star">★ Star on GitHub</div>
  <div class="end-url" data-field="url">__URL__</div>
  <div class="end-made">made with readmereel</div>
  <script type="application/json" class="scene-data">__DATA__</script>
</div>
<script>
__RUNTIME__
(() => {
  const S = RR.scene("__ID__");
  const { tl, D, q, qa, W, wide } = S;
  const [tLogo, tName, tUrl, tType] = D.beats.landTimes;
  const name = q(".end-name");
  RR.fit(name, wide ? 168 : 132, wide ? W * 0.62 : W * 0.86, 0.58);
  const letters = name.textContent.split("");
  name.textContent = "";
  letters.forEach((c) => { const s = document.createElement("span"); s.textContent = c; name.appendChild(s); });
  RR.fit(q(".end-cta"), wide ? 42 : 34, wide ? W * 0.7 : W * 0.84, 0.62);
  RR.fit(q(".end-url"), wide ? 40 : 34, W * 0.86, 0.55);
  tl.fromTo(q(".end-badge"), { scale: 0.2, rotation: -30, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.5, ease: "back.out(1.7)" }, tLogo)
    .fromTo(qa(".end-name span"), { opacity: 0.25, filter: "blur(6px)" }, { opacity: 1, filter: "blur(0px)", duration: 0.2, stagger: 0.035, ease: "power2.out" }, tName)
    .fromTo([q(".end-url"), q(".end-star")], { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.35, stagger: 0.08, ease: "expo.out" }, tUrl)
    .fromTo(q(".end-cta"), { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }, tType - 0.1);
  RR.type(tl, q(".end-cmd"), tType, 0.03);
  if (!D.data.endCard) q(".end-made").style.display = "none";
  else tl.fromTo(q(".end-made"), { opacity: 0 }, { opacity: 1, duration: 0.4 }, tType + 0.4);
  S.done();
})();
</script>
</template></body></html>
```

`__LOGO__` = `<img src="assets/logo.<ext>" alt="">` when a logo exists, else `<i class="glyph"></i>`. Rule for every scene: pass GSAP elements found with `q`/`qa`, never global selector strings, because two scenes of the same type can be mounted at once.

- [ ] **Step 7: Write `build.mjs`.** `buildProject(story, layout, { baseDir, outDir, plan, sfxDir })`: clear `<outDir>/<layout>`, copy `template/hyperframes.json`, create `assets/`, copy the logo to `assets/logo.<ext>`; write each scene from `template/scenes/<type>.html` by replacing (with function replacers, data last) `__ID__`, `__W__`, `__H__`, `__LAYOUT__`, `__STYLE__`, `__RUNTIME__` (contents of `runtime.js`), the scene-specific slots (`__LINES__`, `__NAME__`, `__INSTALL__`, `__URL__`, `__LOGO__`, and those Tasks 5–7 add), then `__DATA__` = `JSON.stringify(planScene).replaceAll("<", "\\u003c")` — note the test expects the literal `<\/script>`; use `.replaceAll("</", "<\\/")` instead so the JSON stays parseable and readable. HTML-escape every text slot (`& < > " '`). Write the root from `root.html` with `__BG__` = first scene's ground, `__DURATION__`, `__HOSTS__`, `__AUDIO__` (cues whose sound file exists in `sfxDir`; copy those files into `assets/sfx/`, plus `CREDITS.md` if present). Return the project dir. Keep `LAYOUTS`, `TEMPLATE_DIR` exports.

- [ ] **Step 8: Run unit tests — expect PASS.** Then render a smoke film of 5 scenes made only of `hook` and `end` (the `onlyHookAndEnd()` story) in both layouts with `--quality draft` through a scratch script, run `check --json --samples 25` (no errors), extract frames at every scene midpoint and every boundary, and look at them. Fix until the hook lines and end card look like the prototype's (`docs/superpowers/reference/agencyrecap-prototype.html`).

- [ ] **Step 9: Commit** `Add the v2 scene runtime, root shell, builder, hook and end scenes`.

---

### Task 5: `title`, `list` and `counter` scenes

**Files:** Create `template/scenes/title.html`, `list.html`, `counter.html`; extend `build.mjs` slots; add per-scene cases to `tests/build2.test.mjs`.

All three follow the scene contract (Task 4) and the prototype's motion values. Each must pass the longest-text gate in Task 9 in both layouts.

**`title`** — data `{ promise }` + top-level `name`, `logo`. DOM: `.title-badge` (logo img or glyph, 150 px, radius 38 px, accent), `.title-name` (`data-field="name"`, Inter 900, 200 px wide / 150 px tall, fitted to 80% width), `.title-promise` (`data-field="scenes[i].promise"`, 52 px wide / 48 px tall, muted ink, max width 1400 / 920, `text-wrap: balance`). Motion (beats.landTimes): badge springs in (`back.out(1.7)`, from scale 0.2 rotation −30) at 0.15; name letters sharpen 0.035 s apart from 0.35; promise words blur in (`RR.blurIn`, stagger 0.07) at 0.8. Then dead still. Hero = `.title-name`; zoom target = the badge.

**`list`** — data `{ items[3] }`. Each item is its own beat: `.list-index` ("01"–"03", JetBrains Mono, accent, 44 px) and `.list-item` (`data-field="scenes[i].items[k]"`, Inter 900, 150 px wide / 112 px tall, fitted, `text-wrap: balance`, centred). Item k enters at `beats.itemStarts[k]` with a vertical whip (from `yPercent: 110`, blur 16 → 0, 0.3 s `expo.out`) while item k−1 whips out upward (0.2 s `power3.in`); the index rolls with a slot-machine flick (0.1 s per roll). The last item stays until the scene ends. Hero = the last item.

**`counter`** — data `{ items[1–3] }`. Layout wide: items in a row, equal columns, each `.counter-value` (Inter 900, 180 px for 1 item / 150 px for 2 / 128 px for 3, tabular numbers, accent for the first item's value only) with `.counter-suffix` (60% size), `.counter-label` (`data-field`, 36 px, muted, uppercase tracking 0.12em) and `.counter-note` (`data-field`, 32 px, accent). Tall: stacked. Motion: item k at `beats.itemStarts[k]`: label fades/blur-in, value rolls from 0 to `value` over 1.0 s `power3.out` (`RR.roll`, decimals from the value), note blur-in at +0.9. Hero = the first item; zoom target = the first value.

- [ ] **Steps:** for each scene: write a build test asserting its slots are filled and `data-field` paths are present; implement; render a 5-scene story using the scene twice in both layouts (draft), check (no errors), look at frames at each beat; commit once all three pass: `Add title, list and counter scenes`.

---

### Task 6: `ui` scene (image and HTML modes)

**Files:** Create `template/scenes/ui.html`; extend `build.mjs` (copy the image, or sanitize + scope + copy the screen and its images); add build tests.

Contract (the prototype's scene 2 is the reference for every value):
- A `.ui-stage` with a subtle grid (64 px, `#d6dce3` lines at 55% opacity on `#e9edf1`, or the paper ground in `paper`) and a `.cam` wrapper (transform-origin `0 0`) containing `.ui-win` (window: radius 22 px, shadow `0 50px 140px rgba(15,23,42,.28)`, a 54 px chrome bar with three dots and a URL pill showing the repo's `url` host) sized **1460×860** in wide and **960×1500** in tall, centred.
- Image mode: `<img class="ui-shot">` filling the window body with `object-fit: contain` on white. The focus `box` is in the image's pixels: the build reads the image size (reuse Task 1's `imageSize`) and passes `scale = displayed width / image width` plus offsets in the scene data, so the runtime can convert boxes to window coordinates.
- HTML mode: the sanitized screen markup goes inside `.ui-win .ui-body` wrapped in `<div class="screen-sN">`; its scoped CSS goes into the scene's `<style>`; screen images are copied to `assets/screens/sN-<k>.<ext>` and their `src` rewritten. The screen renders at 1460×(860−54) CSS px in both layouts (tall scales the whole window by 960/1460 and uses the extra height for the caption). `states`: at `at` (scene-local) add class `set` to every element matching `selector` inside the screen; animate the change: elements inside that match `.was` blur out (0.14 s), `.now` blur in (0.26 s `expo.out`), `.tick`/`[data-pop]` children scale from 0 (`back.out(2.2)`, 0.34 s). Document in the scene file that the screen's CSS defines `.set` appearance.
- Camera: 0–0.55 s the window rises (from `y: 520`, scale 1.08, blur 14 → 0, `expo.out`); establish until 0.8 s; then for each focus k at `beats.focusStarts[k]`: move `.cam` so the box's centre lands at the frame centre with the box filling ≤ 80% of the frame width (scale clamped to 1.2–2.6), 0.6 s `power2.inOut`; a `.ui-chip` with the focus `label` (`data-field`, 40 px, dark pill with an accent dot, placed in the frame's top-right action-safe corner in wide, top-centre in tall) springs in at +0.35. Before the caption the camera eases back 10%. Caption `.ui-caption` (`data-field`, Inter 900, 110 px wide / 84 px tall, ink `#0b0d10`, words with accent on the last two words) blurs in word by word at `beats.captionAt`, bottom-centre, never overlapping the window's focused content (place it over the bottom 22% of the frame with a soft ground fade behind it).
- Transition hooks: hero = `.ui-win`; zoom target = the last focus box's centre (an invisible `data-zoom-target` element positioned there), or, in HTML mode, the last state's first matching `.tick`/`[data-pop]` if any (the green-tick move).
- Acceptance: the agencyrecap dashboard screen (Task 11 rebuilds it) must look like the prototype frames at 2.5, 3.2, 4.0, 5.0 and 5.95 s.

- [ ] **Steps:** build tests (image size → scale data; sanitized screen inside `.screen-sN`; images copied; states in data); implement; render a test story with one image `ui` (a 1600×1000 PNG made with ffmpeg plus two focus boxes) and one HTML `ui` (a fixture screen with 4 rows and states) in both layouts; check; look at frames at every focus, state and the zoom exit; commit `Add the ui scene with camera, focus chips, states and HTML screens`.

---

### Task 7: `terminal` and `compare` scenes

**Files:** Create `template/scenes/terminal.html`, `compare.html`; extend `build.mjs`; build tests.

**`terminal`** — a `.term` card (wide 1500×760, tall 980×1300; `#0d1015` on dark styles, `#111418` on paper; radius 24 px; 54 px title bar with dots and the repo `name`), JetBrains Mono. Prompt `$` in accent, `command` (`data-field`) typed with `RR.type` from `beats.typeStart` (0.05 s/char); output lines (`data-field="scenes[i].output[k]"`, 30 px wide / 26 px tall — below 28 px is allowed here only in tall layout because terminal output is product UI; mark lines with `data-ui-text` so the gate treats them as UI text) stream in at `beats.outputStart + 0.075k` (opacity 0 → 1, y 8 → 0, 0.12 s). Highlighted lines get a 6 px accent bar on the left and a faint accent background, popping in 0.3 s after they appear. The camera (`.cam`) pushes 1.0 → 1.15 towards the first highlighted line after output finishes (0.6 s `power2.inOut`). Hero = `.term`; zoom target = the first highlighted line.

**`compare`** — two panels on one stage: `before` underneath, `after` on top revealed by a wipe (`clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)` in wide, `inset(0 0 100% 0)` → `inset(0)` in tall) from `beats.wipeStart` over 0.8 s `power2.inOut`, with a 6 px accent wipe edge line travelling with it. Each panel: an image (contain, on white, radius 18 px) or `points` (Inter 700, 56 px wide / 48 px tall, `data-field`), plus a label chip (`data-field`, 34 px, before: muted grey; after: accent). The before label shows first; the after label pops when the wipe passes 60%. Hero = the after panel; zoom target = its centre.

- [ ] **Steps:** build tests; implement; render a story with both scenes (images and points variants) in both layouts; check; look at frames before, during and after the wipe and at each terminal beat; commit `Add terminal and compare scenes`.

---

### Task 8: Sound — effects and music

**Files:** Create `skills/readmereel/scripts/lib/sound.mjs`, `tests/sound.test.mjs`; wire into `build.mjs` (cues → `<audio>`), `render.mjs` (Task 9).

**Interfaces:** `SOUNDS = ["whoosh","whoosh-short","pop","click-soft","key-press","impact-bass-1"]`; `resolveEffects(projectDir, { log, run? }) -> sfxDir` — for each sound runs `npx --yes hyperframes@0.9.9 media-use resolve --type sfx --intent <sound> --local-only --project <dir> --json` (via `runHf`) and returns the folder holding the resolved files named `<sound>.mp3`; if a sound cannot be resolved, it is skipped with a warning (the film renders without that cue); `musicTag(rel, duration)` — fade in 0–1 s, out over the last 2 s, `data-volume="0.35"`, track 99; `resolveMusic(story, projectDir, { log, run })` → `null` when `music` is null, the copied path for a file, or for `"heygen"`: `media-use resolve --type bgm --intent "<feel>" --project <dir> --json` where feel = `"confident minimal pulse, 110–124 bpm, builds to a bright end"`; on failure (HeyGen not signed in) return `null` and log `Music skipped: sign in to HeyGen (heygen auth login --oauth) or give a music file.`

- [ ] **Step 1: Tests** with a fake `run`: resolve is called once per sound with `--local-only`; a failed sound is skipped and reported; `music: "heygen"` failure returns `null` with the message; `musicTag` fade points `{t:0,v:0},{t:1,v:0.35},{t:D-2,v:0.35},{t:D,v:0}`.
- [ ] **Step 2:** Implement; verify for real once that `media-use resolve --type sfx --intent whoosh --local-only --json` returns a file path (read its JSON shape and parse the path from it — adjust the parser to the real output and add that real JSON as a test fixture).
- [ ] **Step 3:** In `render.mjs`, after building each project and before checking, resolve effects into a shared cache folder (`<outDir>/.sfx/`) once per run and pass `sfxDir` to `buildProject`. If `story.sfx === false`, skip.
- [ ] **Step 4:** Commit `Add sound effects and music`.

---

### Task 9: Render flow v2, stricter gate, poster and contact sheet

**Files:** Modify `skills/readmereel/scripts/render.mjs`, `scripts/lib/hf.mjs`; Create `tests/render2.integration.mjs` (replaces `tests/render.integration.mjs`; keep its symlink/bad-story/negative-control cases, ported to v2); `tests/fixtures/all-scenes/` (a story using all 8 scene types with fixture images made by ffmpeg in the test and a fixture HTML screen).

- [ ] Flow: tools → read + validate (v1 converts) → `planFilm` (its error message printed as-is) → delete stale outputs → ensure browser → resolve sound → build wide + tall → check both (gate) → render both → GIF → poster (16:9 frame at the `title` scene midpoint, or the first `ui`'s, 960 px) → contact sheet (`contact.png`: for each scene its midpoint frame from both videos, wide row on top, tall row below scaled to the same height, labelled `s1 hook` … with ffmpeg `drawtext` using a bundled font file only if available, else unlabeled) → print outputs.
- [ ] Gate (`hf.mjs`): `CHECK_SAMPLES = max(25, ceil(duration))` passed from the plan; in addition to error findings, treat as problems: `line_unread`, `text_below_floor` and `contrast_aa_failure` warnings whose selector does **not** resolve inside a `.screen-sN`, `.ui-shot` or `[data-ui-text]` element (match by the selector path containing `screen-s`, `ui-shot` or by the finding's element having `data-ui-text`; if HyperFrames' selector cannot be classified, treat it as ours). Map problems to story fields via `data-field` (HyperFrames prints the element's selector; the builder adds `id="f-<hash of field>"` alongside `data-field`, and `render.mjs` keeps a map `id → field`).
- [ ] Integration tests: the all-scenes fixture renders in both sizes; ffprobe size/fps and duration = plan duration ± 0.1 s; longest-text stories (every scene type, every field at its limit) pass the gate in both layouts; the negative control (inject an overflowing element) is caught; a bad story renders nothing; symlinked script still runs; poster and contact sheet exist.
- [ ] Commit `Render v2 films with a stricter gate, poster and contact sheet`.

---

### Task 10: SKILL.md v2, README, CHANGELOG

- [ ] Rewrite `skills/readmereel/SKILL.md` for v2: how to read the repo; choosing 5–8 scenes (a rule of thumb per repo kind: web app → `hook, title, ui (html or image), ui or compare, counter or list, end`; CLI → `hook, title, terminal, terminal or compare, list, end`; library → `hook, title, terminal (usage), compare, counter, end`); every field and limit (all numbers from `LIMITS` must appear — keep the manifest test); real material only (run the CLI to capture output; numbers only from the repo; screenshots only real; rebuilt screens copy markup and CSS from the repo's real templates with real labels and `.example` data, no `@media/@keyframes/@font-face/@import`, states defined in the screen's CSS with `.set`); focus boxes measured in image pixels (tell the agent how: `file`/`sips -g pixelWidth` or reading the PNG); showing the shot list and waiting; rendering with a ≥ 15 min timeout or in the background; **reading `launch-video/contact.png` and fixing anything wrong before handing over**; hand-over (files, exact absolute re-render command, music hint).
- [ ] README: new hero (the v2 readmereel film), what's new in v2 (scene table), styles, sound note (effects bundled by HyperFrames at render time; music via your file or HeyGen), requirements, examples grid (v2 GIFs).
- [ ] CHANGELOG `## 0.2.0 - <date>`.
- [ ] Update `tests/manifest.test.mjs` for the v2 limits; commit `Document readmereel v2`.

---

### Task 11: Re-make the five examples with the v2 skill

- [ ] For each of readmereel, agencyrecap, nopurple, repoheat, launchday: follow SKILL.md v2 as the agent (source repos are read-only), write `examples/<repo>/story.json` (v2) with real material; agencyrecap uses a rebuilt dashboard screen (`examples/agencyrecap/screens/dashboard.html`) copied from `clientreport/templates/dashboard.html` + `base.html` CSS with the four `.example` clients and states flipping them to Sent, then a `zoom` into a `counter` or `ui` of the report; repoheat uses `terminal` with real `repoheat` output (run it if installed, else the README's own sample output); render each; read `contact.png`; fix and re-render until clean; poster + GIF ≤ 8 MB each.
- [ ] Commit `Re-make the examples with readmereel v2` (no MP4s, wide/, tall/, .sfx/ or render.log; extend `.gitignore` for `examples/*/.sfx/` and `examples/*/contact.png` if not wanted — keep `contact.png` out of git).

---

### Task 12: Publish v0.2.0 (owner's go-ahead required)

- [ ] Merge `v2` into `main`, push, wait for CI green, tag `v0.2.0`, release with the ten MP4s (`<repo>-16x9.mp4`, `<repo>-9x16.mp4`) and CHANGELOG notes, check the live README.
